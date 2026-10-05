import { DEFAULT_APP_STATE, type NibElement, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  LINK_BADGE_OFFSET,
  linkBadgeAt,
  linkBadgeCenter,
  linkToFollow,
  pressHitsHandle,
  resolveContextTarget,
} from "../../src/canvas/hitTargets"

const filled = (id: string, x: number, extra: Partial<NibElement> = {}) =>
  ({
    ...newElement("rectangle", {
      x,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    }),
    id,
    ...extra,
  }) as NibElement

const state = (selected: string[] = [], viewMode = false) => ({
  selectedElementIds: Object.fromEntries(selected.map((id) => [id, true as const])),
  editingGroupId: null,
  viewMode,
})

describe("resolveContextTarget", () => {
  const a = filled("a", 0)
  const b = filled("b", 200)
  const locked = filled("l", 400, { locked: true })
  const els = [a, b, locked]

  it("selects the element under the pointer when it is not selected", () => {
    const r = resolveContextTarget(els, [50, 50], 1, state(["b"]))
    expect(r.element?.id).toBe("a")
    expect(r.selection).toEqual({ kind: "select", id: "a" })
  })

  it("keeps the selection when the element under the pointer is part of it", () => {
    const r = resolveContextTarget(els, [250, 50], 1, state(["a", "b"]))
    expect(r.element?.id).toBe("b")
    expect(r.selection).toEqual({ kind: "keep" })
  })

  it("clears the selection on empty board so board items are reachable", () => {
    const r = resolveContextTarget(els, [150, 500], 1, state(["b"]))
    expect(r.element).toBeNull()
    expect(r.selection).toEqual({ kind: "clear" })
    expect(resolveContextTarget(els, [150, 500], 1, state()).selection).toEqual({ kind: "keep" })
  })

  it("reports a locked element (for Unlock) without selecting it", () => {
    const r = resolveContextTarget(els, [450, 50], 1, state(["a"]))
    expect(r.element?.id).toBe("l")
    expect(r.selection).toEqual({ kind: "clear" })
  })

  it("never changes the selection in view mode", () => {
    const r = resolveContextTarget(els, [50, 50], 1, state([], true))
    expect(r.element?.id).toBe("a")
    expect(r.selection).toEqual({ kind: "keep" })
  })
})

describe("link badge hit testing", () => {
  const linked = filled("k", 0, { link: "https://example.com" })

  it("finds the badge at the top-right corner, a constant screen distance away", () => {
    const at1 = linkBadgeCenter(linked, 1)
    expect(at1).toEqual([100 + LINK_BADGE_OFFSET, -LINK_BADGE_OFFSET])
    const at2 = linkBadgeCenter(linked, 2)
    expect(at2).toEqual([100 + LINK_BADGE_OFFSET / 2, -LINK_BADGE_OFFSET / 2])
    expect(linkBadgeAt([linked], at1, 1)?.id).toBe("k")
    expect(linkBadgeAt([linked], [50, 50], 1)).toBeNull()
  })

  it("follows the element's rotation", () => {
    const turned = { ...linked, angle: Math.PI }
    const c = linkBadgeCenter(turned, 1)
    // a half turn about the centre (50, 50) puts the top-right corner badge at the bottom-left
    expect(c[0]).toBeCloseTo(-LINK_BADGE_OFFSET)
    expect(c[1]).toBeCloseTo(100 + LINK_BADGE_OFFSET)
  })

  it("follows a body click only with ⌘/Ctrl or in view mode", () => {
    const app = { ...DEFAULT_APP_STATE }
    expect(linkToFollow([linked], [50, 50], 1, app, false)).toBeNull()
    expect(linkToFollow([linked], [50, 50], 1, app, true)).toBe("https://example.com")
    expect(linkToFollow([linked], [50, 50], 1, { ...app, viewMode: true }, false)).toBe("https://example.com")
    expect(linkToFollow([linked], linkBadgeCenter(linked, 1), 1, app, false)).toBe("https://example.com")
  })
})

describe("the link badge and the NE resize handle", () => {
  const linked = filled("k", 0, { link: "https://example.com" })
  const app = { ...DEFAULT_APP_STATE }
  // inside the NE handle square (centred 6px out from the corner, 8px half-size) and the badge's hit circle
  const overlap: [number, number] = [100 + 12, -12]

  it("lets the handle win while the element is selected", () => {
    expect(pressHitsHandle([linked], overlap, 1)).toBe(true)
    expect(linkToFollow([linked], overlap, 1, app, false, [linked])).toBeNull()
  })

  it("still follows the badge where no handle is, or while the element is not selected", () => {
    expect(linkToFollow([linked], overlap, 1, app, false)).toBe("https://example.com")
    const clear: [number, number] = [100 + LINK_BADGE_OFFSET + 6, -LINK_BADGE_OFFSET - 6]
    expect(pressHitsHandle([linked], clear, 1)).toBe(false)
    expect(linkToFollow([linked], clear, 1, app, false, [linked])).toBe("https://example.com")
  })
})
