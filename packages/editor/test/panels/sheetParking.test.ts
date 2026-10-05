import { describe, expect, it } from "vitest"
import { sheetBox, unmountedByShow } from "../../src/ui/panels/sheetParking"

type Presenting = { presentation: { frameIds: readonly string[]; index: number } | null }

describe("side sheet state across a slide show", () => {
  it("tells a show's unmount from a close", () => {
    const core: Presenting = { presentation: null }
    expect(unmountedByShow(core)).toBe(false)
    core.presentation = { frameIds: ["a"], index: 0 }
    expect(unmountedByShow(core)).toBe(true)
  })

  it("hands every mount on one core the same box, and other cores their own", () => {
    const a: Presenting = { presentation: null }
    const b: Presenting = { presentation: null }
    const first = sheetBox(a, "search", () => ({ query: "" }))
    first.current = { query: "Frame" }
    expect(sheetBox(a, "search", () => ({ query: "" })).current.query).toBe("Frame")
    expect(sheetBox(b, "search", () => ({ query: "" })).current.query).toBe("")
    expect(sheetBox(a, "library", () => 0).current).toBe(0)
  })
})
