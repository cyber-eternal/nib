import { type NibElement, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  findMatches,
  frameDisplayName,
  matchCountLabel,
  matchIds,
  snippetOf,
  stepMatch,
} from "../../src/ui/panels/searchModel"

const text = (t: string, x: number, y: number, extra: Record<string, unknown> = {}): NibElement =>
  newElement("text", { x, y, width: 80, height: 20, text: t, originalText: t, ...extra } as never)

describe("search matching", () => {
  const box = newElement("rectangle", { x: 300, y: 0, width: 100, height: 60 })
  const label = text("Apple label", 310, 20, { containerId: box.id })
  const frame = newElement("frame", { x: 0, y: 500, width: 200, height: 200, name: "Apple orchard" } as never)
  const unnamed = newElement("frame", { x: 400, y: 500, width: 200, height: 200 } as never)
  const elements = [
    text("apple three", 0, 200),
    text("apple one", 0, 0),
    text("pear", 0, 50),
    text("apple two", 0, 100),
    box,
    label,
    frame,
    unnamed,
  ]

  it("finds text, labels and frame names, case-insensitively, in reading order", () => {
    const m = findMatches(elements, "APPLE")
    expect(m.map((x) => x.text)).toEqual([
      "apple one",
      "Apple label",
      "apple two",
      "apple three",
      "Apple orchard",
    ])
    expect(m.find((x) => x.kind === "frame")?.id).toBe(frame.id)
  })

  it("selects a label's container but highlights the label itself", () => {
    const m = findMatches(elements, "label")
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ id: label.id, targetId: box.id, kind: "label" })
    expect(matchIds(m)).toEqual([label.id])
  })

  it("matches what the canvas draws for an unnamed frame", () => {
    expect(frameDisplayName({ name: null })).toBe("Frame")
    expect(findMatches(elements, "frame").map((x) => x.id)).toEqual([unnamed.id])
  })

  it("ignores whitespace differences and deleted elements", () => {
    const wrapped = text("apple\n  pie", 0, 900)
    const gone = { ...text("apple pie", 0, 950), isDeleted: true } as NibElement
    expect(findMatches([wrapped, gone], "apple pie").map((x) => x.id)).toEqual([wrapped.id])
  })

  it("returns nothing for an empty query", () => {
    expect(findMatches(elements, "   ")).toEqual([])
  })
})

describe("search navigation", () => {
  it("the first Enter lands on the first match, not the second", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, 1)).toBe(1)
  })

  it("the first Shift+Enter lands on the last match, and both directions wrap", () => {
    expect(stepMatch(-1, 3, -1)).toBe(2)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
  })

  it("stays at -1 with no matches and recovers from a stale index", () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1)
    expect(stepMatch(7, 3, 1)).toBe(0)
  })

  it("labels the position as i of n once the user is on a match", () => {
    expect(matchCountLabel(-1, 0)).toBe("No matches")
    expect(matchCountLabel(-1, 1)).toBe("1 match")
    expect(matchCountLabel(-1, 4)).toBe("4 matches")
    expect(matchCountLabel(1, 4)).toBe("2 of 4")
  })
})

describe("result snippets", () => {
  it("keeps short text whole", () => {
    expect(snippetOf({ text: "apple one", at: 0, length: 5 })).toEqual({
      before: "",
      match: "apple",
      after: " one",
    })
  })

  it("trims long text around the hit at word gaps", () => {
    const long = "the quick brown fox jumps over the lazy dog and keeps running far away from home"
    const at = long.indexOf("lazy")
    const s = snippetOf({ text: long, at, length: 4 }, 12)
    expect(s.match).toBe("lazy")
    expect(s.before.startsWith("…")).toBe(true)
    expect(s.after.endsWith("…")).toBe(true)
    expect(s.before.length).toBeLessThanOrEqual(14)
  })
})
