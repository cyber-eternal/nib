import { newElement } from "@nib/core"
import { describe, expect, it, vi } from "vitest"
import { shallowEqual } from "../../src/hooks/useEditor"
import type { ShellDialogsApi } from "../../src/ui/shell/ShellDialogs"
import { selectionAnnouncement } from "../../src/ui/shell/announce"
import { RequestQueue, cancelAnswer, dropChoiceRequest } from "../../src/ui/shell/choiceQueue"
import { chromeMode, chromeParts, zenReveal } from "../../src/ui/shell/chrome"
import { displayName, renamedTo } from "../../src/ui/shell/docName"
import { applyPickedColor, sampleColor } from "../../src/ui/shell/eyedropper"
import { gridMove } from "../../src/ui/shell/gridNav"
import { inAppDialogs, withInAppDialogs } from "../../src/ui/shell/inAppDialogs"
import { themeRowMove } from "../../src/ui/shell/menuRow"
import { CHROME_INSETS, fitWithin } from "../../src/ui/shell/viewport"
import { createFakePlatform } from "../fakePlatform"

describe("inline rename of the document", () => {
  it("shows the name without its extension", () => {
    expect(displayName("Plan.nibd")).toBe("Plan")
    expect(displayName("Plan.NIBD")).toBe("Plan")
    expect(displayName("Old plan.txt")).toBe("Old plan.txt")
    expect(displayName("diagram.excalidraw")).toBe("diagram")
    expect(displayName("")).toBe("Untitled")
  })

  it("keeps the extension, trims, and drops empty or unchanged edits", () => {
    expect(renamedTo("Plan.nibd", "  Roadmap ")).toBe("Roadmap.nibd")
    expect(renamedTo("Untitled", "Notes")).toBe("Notes")
    expect(renamedTo("Plan.nibd", "   ")).toBeNull()
    expect(renamedTo("Plan.nibd", "Plan")).toBeNull()
    expect(renamedTo("Plan", "a/b:c")).toBe("a-b-c")
  })

  it("a name with a pipe stays whole", () => {
    expect(displayName("A | B.nibd")).toBe("A | B")
  })
})

describe("in-app questions come one at a time", () => {
  it("answers resolve in order and later questions wait", async () => {
    const q = new RequestQueue()
    const a = q.ask({ kind: "prompt", title: "One", label: "x" })
    const b = q.ask({ kind: "prompt", title: "Two", label: "y" })
    expect(q.size).toBe(2)
    expect(q.current?.request.title).toBe("One")
    q.answer(q.current!.id, "first")
    expect(q.current?.request.title).toBe("Two")
    q.answer(q.current!.id, null)
    await expect(a).resolves.toBe("first")
    await expect(b).resolves.toBeNull()
    expect(q.current).toBeNull()
  })

  it("Escape answers the request's cancel choice", () => {
    expect(cancelAnswer(dropChoiceRequest({ name: "x", canvasEmpty: false }))).toBe("cancel")
    expect(cancelAnswer({ kind: "prompt", title: "", label: "" })).toBeNull()
  })
})

describe("Insert / Open / Cancel for a dropped drawing", () => {
  it("defaults to Insert on a board with work on it", () => {
    const r = dropChoiceRequest({ name: "Flow", canvasEmpty: false })
    expect(r.defaultId).toBe("insert")
    expect(r.choices.map((c) => c.id)).toEqual(["cancel", "open", "insert"])
    expect(r.choices.find((c) => c.id === "insert")?.variant).toBe("primary")
    expect(r.title).toContain("Flow")
  })

  it("defaults to Open on an empty board", () => {
    const r = dropChoiceRequest({ name: "Flow", canvasEmpty: true })
    expect(r.defaultId).toBe("open")
    expect(r.choices.find((c) => c.id === "open")?.variant).toBe("primary")
  })
})

describe("in-app dialogs for the browser", () => {
  const api = (answer: string | null): ShellDialogsApi => ({
    choose: vi.fn(async () => answer),
    prompt: vi.fn(async () => answer),
    confirm: vi.fn(async () => answer === "ok"),
  })

  it("askSave maps the three buttons and treats Escape as cancel", async () => {
    await expect(inAppDialogs(api("save")).askSave("Plan")).resolves.toBe("save")
    await expect(inAppDialogs(api("discard")).askSave("Plan")).resolves.toBe("discard")
    await expect(inAppDialogs(api(null)).askSave("Plan")).resolves.toBe("cancel")
  })

  it("only the browser's dialogs are replaced; the rest of the platform is untouched", () => {
    const browser = createFakePlatform({ name: "browser" })
    const wrapped = withInAppDialogs(browser, api("ok"))
    expect(wrapped.dialogs).not.toBe(browser.dialogs)
    expect(wrapped.fs).toBe(browser.fs)
    expect(wrapped.prefs).toBe(browser.prefs)
    const desktop = createFakePlatform({ name: "tauri" })
    expect(withInAppDialogs(desktop, api("ok"))).toBe(desktop)
  })
})

describe("grid and row keys", () => {
  it("walks the 5 × 2 theme deck", () => {
    expect(gridMove(0, "ArrowRight", 5, 10)).toBe(1)
    expect(gridMove(9, "ArrowRight", 5, 10)).toBe(0)
    expect(gridMove(0, "ArrowLeft", 5, 10)).toBe(9)
    expect(gridMove(2, "ArrowDown", 5, 10)).toBe(7)
    expect(gridMove(7, "ArrowDown", 5, 10)).toBe(2)
    expect(gridMove(7, "ArrowUp", 5, 10)).toBe(2)
    expect(gridMove(2, "ArrowUp", 5, 10)).toBe(7)
    expect(gridMove(4, "Home", 5, 10)).toBe(0)
    expect(gridMove(4, "End", 5, 10)).toBe(9)
    expect(gridMove(4, "a", 5, 10)).toBeNull()
  })

  it("Left and Right walk the menu's swatch row; Up and Down leave it", () => {
    expect(themeRowMove("ArrowRight", 9, 10)).toEqual({ to: "chip", index: 0 })
    expect(themeRowMove("ArrowLeft", 0, 10)).toEqual({ to: "chip", index: 9 })
    expect(themeRowMove("ArrowDown", 3, 10)).toEqual({ to: "after" })
    expect(themeRowMove("ArrowUp", 3, 10)).toEqual({ to: "before" })
    expect(themeRowMove("Enter", 3, 10)).toBeNull()
  })
})

describe("chrome per mode", () => {
  it("a slide show wins, then zen, then view mode", () => {
    expect(chromeMode({ zenMode: true, viewMode: true, presenting: true })).toBe("present")
    expect(chromeMode({ zenMode: true, viewMode: true, presenting: false })).toBe("zen")
    expect(chromeMode({ zenMode: false, viewMode: true, presenting: false })).toBe("view")
    expect(chromeMode({ zenMode: false, viewMode: false, presenting: false })).toBe("full")
  })

  it("view mode drops the tools but keeps zoom; a slide show keeps only its own bar", () => {
    expect(chromeParts("view")).toMatchObject({ tray: false, styleBar: false, ledge: true, top: true })
    expect(chromeParts("present")).toMatchObject({
      tray: false,
      top: false,
      ledge: false,
      presentation: true,
    })
    expect(chromeParts("zen")).toMatchObject({ tray: true, top: true, presentation: false })
  })

  it("zen chrome comes back near the top and bottom edges only", () => {
    expect(zenReveal(10, 900)).toBe("top")
    expect(zenReveal(450, 900)).toBe("none")
    expect(zenReveal(860, 900)).toBe("bottom")
  })
})

describe("zoom to fit leaves room for the chrome", () => {
  it("centres content in the free part of the viewport", () => {
    const el = newElement("rectangle", { x: 0, y: 0, width: 400, height: 200 })
    const vp = fitWithin([el], 1200, 800)!
    const toScreen = (x: number, y: number) => [(x + vp.scrollX) * vp.zoom, (y + vp.scrollY) * vp.zoom]
    const [cx, cy] = toScreen(200, 100)
    const freeW = 1200 - CHROME_INSETS.left - CHROME_INSETS.right
    const freeH = 800 - CHROME_INSETS.top - CHROME_INSETS.bottom
    expect(cx).toBeCloseTo(CHROME_INSETS.left + freeW / 2, 0)
    expect(cy).toBeCloseTo(CHROME_INSETS.top + freeH / 2, 0)
    const [, bottom] = toScreen(0, 200)
    expect(bottom!).toBeLessThanOrEqual(800 - CHROME_INSETS.bottom)
  })

  it("has nothing to fit on an empty board", () => {
    expect(fitWithin([], 1200, 800)).toBeNull()
  })
})

describe("eyedropper (I)", () => {
  it("takes the stroke, or the fill for the background picker", () => {
    const el = newElement("rectangle", { x: 0, y: 0, strokeColor: "#e03131", backgroundColor: "#a5d8ff" })
    expect(sampleColor(el, "stroke")).toBe("#e03131")
    expect(sampleColor(el, "background")).toBe("#a5d8ff")
    expect(sampleColor({ ...el, backgroundColor: "transparent" }, "background")).toBeNull()
  })

  it("applies the picked colour as the next element's default when nothing is selected", async () => {
    const { EditorCore } = await import("@nib/core")
    const core = new EditorCore()
    const el = newElement("rectangle", { x: 0, y: 0, strokeColor: "#2f9e44" })
    expect(applyPickedColor(core, el, "stroke")).toBe("#2f9e44")
    expect(core.appState.currentItemStrokeColor).toBe("#2f9e44")
  })
})

describe("shallowEqual for selector snapshots", () => {
  it("compares one level of arrays and objects", () => {
    expect(shallowEqual([1, "a", true], [1, "a", true])).toBe(true)
    expect(shallowEqual([1, 2], [1, 3])).toBe(false)
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false)
  })
})

describe("the selection announcement", () => {
  const get = () => undefined
  it("names one element, counts several, and stays quiet for none", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 10, height: 10 })
    const ellipse = newElement("ellipse", { x: 0, y: 0, width: 10, height: 10 })
    expect(selectionAnnouncement([], get)).toBe("")
    expect(selectionAnnouncement([rect], get)).toBe("Rectangle selected")
    expect(selectionAnnouncement([rect, ellipse], get)).toBe("2 items selected")
  })
})
