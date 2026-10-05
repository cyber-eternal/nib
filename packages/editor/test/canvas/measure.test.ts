import { afterEach, describe, expect, it, vi } from "vitest"

const fresh = async () => {
  vi.resetModules()
  return import("../../src/canvas/measure")
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("canvas font loading", () => {
  it("asks for every bundled face and re-measures once they are in", async () => {
    const asked: string[] = []
    vi.stubGlobal("document", {
      fonts: {
        load: (font: string) => {
          asked.push(font)
          return Promise.resolve([{}])
        },
        addEventListener: () => {},
      },
    })
    const m = await fresh()
    const changed = vi.fn()
    m.onCanvasFontsChange(changed)
    const before = m.canvasFontsVersion()
    await m.canvasFontsReady()
    expect(asked).toHaveLength(m.CANVAS_FONT_FACES.length)
    expect(asked.some((f) => f.includes("Shantell Sans"))).toBe(true)
    expect(asked.some((f) => f.includes("Nunito"))).toBe(true)
    expect(asked.some((f) => f.includes("Cascadia Code"))).toBe(true)
    expect(changed).toHaveBeenCalled()
    expect(m.canvasFontsVersion()).toBeGreaterThan(before)
  })

  it("does not hold the first document back when a face never arrives", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("document", {
      fonts: { load: () => new Promise(() => {}), addEventListener: () => {} },
    })
    const m = await fresh()
    let done = false
    void m.canvasFontsReady().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(m.FONT_WAIT_MS + 10)
    expect(done).toBe(true)
  })

  it("resolves at once without a font loading API", async () => {
    vi.stubGlobal("document", {})
    const m = await fresh()
    await expect(m.canvasFontsReady()).resolves.toBeUndefined()
  })
})
