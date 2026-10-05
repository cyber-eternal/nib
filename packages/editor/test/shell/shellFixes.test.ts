import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { EditorCore, type LibraryItem, type NibElement, createLibraryItem, newElement } from "@nib/core"
import { describe, expect, it, vi } from "vitest"
import { isImeKey } from "../../src/hooks/useShortcuts"
import type { ShellDialogsApi } from "../../src/ui/shell/ShellDialogs"
import { confirmRequest } from "../../src/ui/shell/choiceQueue"
import { chromeParts, contextMenuLabel } from "../../src/ui/shell/chrome"
import { type DecodeSource, whenDecoded } from "../../src/ui/shell/crop"
import { pathLabel } from "../../src/ui/shell/docName"
import { inAppDialogs } from "../../src/ui/shell/inAppDialogs"
import { exportedMessage, importIntoLibrary, refusedLinkMessage, throttle } from "../../src/ui/shell/notices"
import { selectionWithFrames } from "../../src/ui/shell/selectionExport"
import { pastePoint, rectsOverlap, selectionScreenRect } from "../../src/ui/shell/viewport"

const withScene = (els: NibElement[]): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() })
  return core
}

describe("copying a selected frame (T2-01b)", () => {
  it("brings the frame's contents and their labels, in scene order", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 400, height: 300 })
    const box = newElement("rectangle", { x: 20, y: 20, width: 100, height: 60, frameId: frame.id })
    const label = newElement("text", { x: 30, y: 40, width: 40, height: 20, text: "Hi", containerId: box.id })
    const boxed = { ...box, boundElements: [{ id: label.id, type: "text" as const }] }
    const outside = newElement("ellipse", { x: 600, y: 0, width: 50, height: 50 })
    const core = withScene([frame, boxed, label, outside])
    core.selectElements([frame.id])
    expect(selectionWithFrames(core).map((e) => e.id)).toEqual([frame.id, box.id, label.id])
  })

  it("is empty with nothing selected", () => {
    expect(selectionWithFrames(new EditorCore())).toEqual([])
  })
})

describe("paste lands where the pointer rests today", () => {
  it("reads a resting pointer through the current viewport, so a scroll moves the paste with it", () => {
    const core = new EditorCore()
    core.setViewportSize(1000, 800)
    const at = pastePoint(core, [500, 400])
    core.setAppState({
      viewport: { ...core.appState.viewport, scrollY: core.appState.viewport.scrollY - 3000 },
    })
    const after = pastePoint(core, [500, 400])
    expect(after[1] - at[1]).toBeCloseTo(3000)
  })

  it("uses the middle of the view when the pointer is off the board or over the chrome", () => {
    const core = new EditorCore()
    core.setViewportSize(1000, 800)
    expect(pastePoint(core, null)).toEqual(core.viewportCenter())
  })
})

describe("the hint steps aside for the selection", () => {
  it("measures the selection on screen and tells when it meets the hint", () => {
    const rect = newElement("rectangle", { x: 100, y: 500, width: 300, height: 200 })
    const core = withScene([rect])
    expect(selectionScreenRect(core)).toBeNull()
    core.selectElements([rect.id])
    const r = selectionScreenRect(core)!
    expect(r.left).toBeLessThanOrEqual(100)
    expect(r.bottom).toBeGreaterThanOrEqual(700)
    expect(rectsOverlap(r, { left: 300, top: 650, right: 700, bottom: 680 })).toBe(true)
    expect(rectsOverlap(r, { left: 500, top: 650, right: 900, bottom: 680 })).toBe(false)
  })
})

describe("presentations show only the slides", () => {
  it("drops the side sheets, stats and the context menu while presenting", () => {
    expect(chromeParts("present").panels).toBe(false)
    for (const mode of ["full", "zen", "view"] as const) expect(chromeParts(mode).panels).toBe(true)
  })
})

describe("the context menu's name", () => {
  it("names each set, never as the top-right Board actions", () => {
    const names = (["element", "canvas", "locked", "view"] as const).map(contextMenuLabel)
    expect(names).toEqual(["Shape actions", "Canvas actions", "Locked shape actions", "View mode actions"])
    expect(names).not.toContain("Board actions")
  })
})

describe("cropping waits for the image", () => {
  const cache = (state: { image?: { width: number; height: number }; failed?: boolean }) => {
    const listeners = new Set<() => void>()
    const source: DecodeSource & { decode(ok: boolean): void } = {
      get: () => state.image ?? null,
      hasFailed: () => state.failed === true,
      sync: vi.fn(),
      onDecoded: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      decode: (ok) => {
        if (ok) state.image = { width: 64, height: 32 }
        else state.failed = true
        for (const l of [...listeners]) l()
      },
    }
    return { source, listeners }
  }
  const files = { f1: { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AA==", created: 0 } }

  it("crops at once when the bitmap is there", () => {
    const { source } = cache({ image: { width: 10, height: 20 } })
    const ready = vi.fn()
    whenDecoded(source, "f1", files as never, { ready, failed: vi.fn() })
    expect(ready).toHaveBeenCalledWith({ width: 10, height: 20 })
  })

  it("waits for a decode still under way, then crops", () => {
    const { source, listeners } = cache({})
    const ready = vi.fn()
    const failed = vi.fn()
    whenDecoded(source, "f1", files as never, { ready, failed })
    expect(source.sync).toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    source.decode(true)
    expect(ready).toHaveBeenCalledWith({ width: 64, height: 32 })
    expect(failed).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it("says so when the image cannot be read, now or once its decode fails", () => {
    const failedNow = vi.fn()
    whenDecoded(cache({ failed: true }).source, "f1", files as never, { ready: vi.fn(), failed: failedNow })
    expect(failedNow).toHaveBeenCalledOnce()
    const missing = vi.fn()
    whenDecoded(cache({}).source, "nope", files as never, { ready: vi.fn(), failed: missing })
    expect(missing).toHaveBeenCalledOnce()
    const { source } = cache({})
    const later = vi.fn()
    whenDecoded(source, "f1", files as never, { ready: vi.fn(), failed: later })
    source.decode(false)
    expect(later).toHaveBeenCalledOnce()
  })

  it("can be called off before the decode lands", () => {
    const { source, listeners } = cache({})
    const ready = vi.fn()
    const cancel = whenDecoded(source, "f1", files as never, { ready, failed: vi.fn() })
    cancel()
    source.decode(true)
    expect(ready).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})

describe("notices", () => {
  it("tells a deleted link target from a link Nib never opens", () => {
    expect(refusedLinkMessage("#element=abc123")).toBe("The linked element was deleted.")
    expect(refusedLinkMessage("javascript:alert(1)")).toMatch(/Only web and mail links/)
  })

  it("imports a library once: a second import of the same file adds nothing", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50 })
    const item: LibraryItem = createLibraryItem([rect], {}, "Box")
    const first = importIntoLibrary([], [item])
    expect(first.items).toHaveLength(1)
    expect(first.message).toBe("Added 1 item to the library.")
    const again = importIntoLibrary(first.items, [item])
    expect(again.added).toBe(0)
    expect(again.items).toHaveLength(1)
    expect(new Set(again.items.map((i) => i.id)).size).toBe(1)
    expect(again.message).toBe("Those items are already in your library.")
  })

  it("confirms an export in its own words", () => {
    expect(exportedMessage(true, "Plan")).toBe("Exported Plan.excalidraw.")
  })

  it("names the file the save picker wrote, not the document", () => {
    expect(exportedMessage("fsa:2aee9803-4c1b/t3-Renamed board.excalidraw", "Renamed board")).toBe(
      "Exported t3-Renamed board.excalidraw.",
    )
    expect(exportedMessage("/Users/me/Desktop/Copy.excalidraw", "Plan")).toBe("Exported Copy.excalidraw.")
    expect(exportedMessage("C:\\Users\\me\\Copy.excalidraw", "Plan")).toBe("Exported Copy.excalidraw.")
  })

  it("lets a repeating tool error through once every few seconds", () => {
    let t = 1000
    const due = throttle(4000, () => t)
    expect(due()).toBe(true)
    t += 100
    expect(due()).toBe(false)
    t += 3899
    expect(due()).toBe(false)
    t += 1
    expect(due()).toBe(true)
  })
})

describe("browser file handles in the name's tooltip", () => {
  it("shows only the file name of an fsa: handle", () => {
    expect(pathLabel("fsa:2aee9803-4c1b-4c41-a1f2-7d2f0e9a1b11/Board A.nibd")).toBe("Board A.nibd")
    expect(pathLabel("/Users/me/Board A.nibd")).toBe("/Users/me/Board A.nibd")
    expect(pathLabel(null)).toBe("Not saved yet")
  })
})

describe("the in-app confirm keeps the caller's words", () => {
  it("labels the safe answer as asked, Keep Mine for a file changed on disk", () => {
    const r = confirmRequest("Reload it?", {
      title: "File changed",
      okLabel: "Reload",
      cancelLabel: "Keep Mine",
    })
    expect(r.choices.map((c) => c.label)).toEqual(["Keep Mine", "Reload"])
    expect(r.cancelId).toBe("cancel")
    expect(confirmRequest("Sure?").choices[0]!.label).toBe("Cancel")
  })

  it("passes cancelLabel through the platform's dialogs", async () => {
    const api: ShellDialogsApi = { choose: vi.fn(), prompt: vi.fn(), confirm: vi.fn(async () => false) }
    await inAppDialogs(api).confirm("Reload it?", { okLabel: "Reload", cancelLabel: "Keep Mine" })
    expect(api.confirm).toHaveBeenCalledWith(
      "Reload it?",
      expect.objectContaining({ cancelLabel: "Keep Mine" }),
    )
  })
})

describe("IME keys (R-UI-13b)", () => {
  it("counts WebKit's 229 confirm and cancel as composing", () => {
    expect(isImeKey({ key: "Enter", keyCode: 229 })).toBe(true)
    expect(isImeKey({ key: "Escape", isComposing: true })).toBe(true)
    expect(isImeKey({ key: "Process" })).toBe(true)
    expect(isImeKey({ key: "Enter", keyCode: 13 })).toBe(false)
  })
})

describe("layer changes stay out of the shell's render", () => {
  const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

  it("the shell subscribes to no layer itself; the eyedropper bar owns its layer", () => {
    expect(source("../../src/App.tsx")).not.toMatch(/\buseLayer\(/)
    expect(source("../../src/ui/shell/BottomStack.tsx")).toMatch(/\buseLayer\(/)
  })

  it("the chrome the shell re-renders around is memoised", async () => {
    const memo = Symbol.for("react.memo")
    const { MarkerTray } = await import("../../src/ui/tray/MarkerTray")
    const { LedgeEnd } = await import("../../src/ui/shell/LedgeEnd")
    const { CornerHelp } = await import("../../src/ui/shell/CornerHelp")
    for (const c of [MarkerTray, LedgeEnd, CornerHelp])
      expect((c as unknown as { $$typeof: symbol }).$$typeof).toBe(memo)
  })
})
