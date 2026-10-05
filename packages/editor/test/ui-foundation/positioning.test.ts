import { describe, expect, it } from "vitest"
import { TOOLTIP_DELAY, tooltipDelay } from "../../src/ui/primitives/Tooltip"
import { Typeahead, moveIndex, navMoveFor, typeaheadIndex } from "../../src/ui/primitives/menuNav"
import { computePlacement } from "../../src/ui/primitives/position"
import { pauseAfter, pushToast, removeToast } from "../../src/ui/primitives/toastQueue"

const viewport = { width: 1000, height: 800 }
const trayButton = { x: 480, y: 740, width: 40, height: 40 }

describe("computePlacement", () => {
  it("opens upward from the tray by default, centred on the anchor", () => {
    const p = computePlacement({ anchor: trayButton, size: { width: 200, height: 120 }, viewport })
    expect(p.side).toBe("top")
    expect(p.y).toBe(740 - 8 - 120)
    expect(p.x).toBe(400)
  })

  it("flips to the other side when the preferred one has no room", () => {
    const topButton = { x: 900, y: 10, width: 40, height: 40 }
    const p = computePlacement({
      anchor: topButton,
      size: { width: 200, height: 300 },
      viewport,
      side: "top",
    })
    expect(p.side).toBe("bottom")
    expect(p.y).toBe(58)
  })

  it("keeps the box on-screen horizontally", () => {
    const edge = { x: 980, y: 400, width: 20, height: 20 }
    const p = computePlacement({ anchor: edge, size: { width: 300, height: 100 }, viewport })
    expect(p.x + 300).toBeLessThanOrEqual(viewport.width - 8)
    const left = computePlacement({
      anchor: { x: 0, y: 400, width: 20, height: 20 },
      size: { width: 300, height: 100 },
      viewport,
    })
    expect(left.x).toBe(8)
  })

  it("caps the height to the roomier side when neither side fits", () => {
    const mid = { x: 480, y: 380, width: 40, height: 40 }
    const p = computePlacement({ anchor: mid, size: { width: 200, height: 2000 }, viewport, side: "top" })
    expect(p.maxHeight).toBe(380 - 8 - 8)
    expect(p.y).toBeGreaterThanOrEqual(8)
  })

  it("places beside an anchor for left and right, and at a point for context menus", () => {
    const r = computePlacement({
      anchor: { x: 100, y: 100, width: 40, height: 40 },
      size: { width: 100, height: 50 },
      viewport,
      side: "right",
      align: "start",
    })
    expect(r).toMatchObject({ side: "right", x: 148, y: 100 })
    const pt = computePlacement({
      anchor: { x: 990, y: 790, width: 0, height: 0 },
      size: { width: 180, height: 200 },
      viewport,
      side: "bottom",
      align: "start",
      offset: 0,
    })
    expect(pt.side).toBe("top")
    expect(pt.x + 180).toBeLessThanOrEqual(992)
  })
})

describe("computePlacement at a point (context menus)", () => {
  const tall = { width: 1440, height: 900 }
  const menu = { width: 220, height: 700 }

  it("slides a menu up until it fits instead of capping it to the room below the press", () => {
    const p = computePlacement({
      anchor: { x: 600, y: 380, width: 0, height: 0 },
      size: menu,
      viewport: tall,
      side: "bottom",
      align: "start",
      offset: 2,
      slide: true,
    })
    expect(p.y).toBe(900 - 8 - 700)
    expect(p.y + 700).toBeLessThanOrEqual(900 - 8)
    expect(p.maxHeight).toBe(900 - 16)
    expect(p.x).toBe(600)
  })

  it("keeps a menu that fits where it was opened", () => {
    const p = computePlacement({
      anchor: { x: 600, y: 100, width: 0, height: 0 },
      size: { width: 220, height: 300 },
      viewport: tall,
      side: "bottom",
      align: "start",
      offset: 2,
      slide: true,
    })
    expect(p).toMatchObject({ x: 600, y: 102, side: "bottom" })
  })

  it("scrolls only a menu taller than the window, from the top edge", () => {
    const p = computePlacement({
      anchor: { x: 100, y: 450, width: 0, height: 0 },
      size: { width: 220, height: 1200 },
      viewport: tall,
      side: "bottom",
      align: "start",
      slide: true,
    })
    expect(p.y).toBe(8)
    expect(p.maxHeight).toBe(884)
  })

  it("opens to the left of a press near the right edge", () => {
    const p = computePlacement({
      anchor: { x: 1400, y: 100, width: 0, height: 0 },
      size: { width: 220, height: 300 },
      viewport: tall,
      side: "bottom",
      align: "start",
      slide: true,
    })
    expect(p.x).toBe(1400 - 220)
  })
})

describe("roving focus and typeahead", () => {
  it("skips disabled entries and wraps", () => {
    const disabled = [false, true, false, false]
    expect(moveIndex(disabled, 0, "next")).toBe(2)
    expect(moveIndex(disabled, 3, "next")).toBe(0)
    expect(moveIndex(disabled, 0, "prev")).toBe(3)
    expect(moveIndex(disabled, -1, "first")).toBe(0)
    expect(moveIndex([true, false, true], -1, "last")).toBe(1)
    expect(moveIndex([true, true], 0, "next")).toBe(-1)
  })

  it("maps keys per orientation", () => {
    expect(navMoveFor("ArrowDown", "vertical")).toBe("next")
    expect(navMoveFor("ArrowRight", "vertical")).toBeNull()
    expect(navMoveFor("ArrowRight", "horizontal")).toBe("next")
    expect(navMoveFor("ArrowUp", "both")).toBe("prev")
    expect(navMoveFor("End", "horizontal")).toBe("last")
  })

  it("typeahead cycles on one letter and refines on several", () => {
    const labels = ["Save", "Save as…", "Select all", "Export image", "Stats"]
    const none = labels.map(() => false)
    expect(typeaheadIndex(labels, none, -1, "s")).toBe(0)
    expect(typeaheadIndex(labels, none, 0, "s")).toBe(1)
    expect(typeaheadIndex(labels, none, 4, "s")).toBe(0)
    expect(typeaheadIndex(labels, none, 0, "ss")).toBe(1)
    expect(typeaheadIndex(labels, none, 0, "sel")).toBe(2)
    expect(typeaheadIndex(labels, [true, true, false, false, false], -1, "s")).toBe(2)
    expect(typeaheadIndex(labels, none, 0, "zz")).toBe(-1)
  })

  it("the typeahead buffer resets after a pause", () => {
    const t = new Typeahead()
    expect(t.push("s", 0)).toBe("s")
    expect(t.push("e", 100)).toBe("se")
    expect(t.push("x", 900)).toBe("x")
  })
})

describe("tooltip timing", () => {
  it("waits 400ms when cold and opens instantly while moving between tools", () => {
    expect(tooltipDelay(10_000, { open: 0, closedAt: Number.NEGATIVE_INFINITY })).toBe(TOOLTIP_DELAY)
    expect(tooltipDelay(10_000, { open: 1, closedAt: 0 })).toBe(0)
    expect(tooltipDelay(10_000, { open: 0, closedAt: 9_900 })).toBe(0)
    expect(tooltipDelay(10_000, { open: 0, closedAt: 9_000 })).toBe(TOOLTIP_DELAY)
  })
})

describe("toast pause", () => {
  const away = { focus: false, hover: false }

  it("pauses while the pointer or focus is in the region and resumes when both leave", () => {
    let p = pauseAfter(false, { kind: "enter" })
    expect(p).toBe(true)
    p = pauseAfter(p, { kind: "leave", focus: true, hover: false })
    expect(p).toBe(true)
    p = pauseAfter(p, { kind: "blur", ...away })
    expect(p).toBe(false)
  })

  it("resumes once the focused action is gone with its toast, though no blur arrived", () => {
    const p = pauseAfter(false, { kind: "focus" })
    expect(pauseAfter(p, { kind: "changed", ...away })).toBe(false)
    expect(pauseAfter(p, { kind: "changed", focus: true, hover: false })).toBe(true)
  })

  it("clears on an action, and a new toast never pauses the timers by itself", () => {
    expect(pauseAfter(true, { kind: "acted" })).toBe(false)
    expect(pauseAfter(false, { kind: "changed", focus: true, hover: true })).toBe(false)
  })
})

describe("toast queue", () => {
  const t = (id: string, message = id) => ({ id, message, kind: "info" as const, duration: 3000 })

  it("keeps the newest few and collapses a repeated message", () => {
    let q = pushToast([], t("a"))
    q = pushToast(q, t("b"))
    q = pushToast(q, t("c"))
    q = pushToast(q, t("d"))
    expect(q.map((x) => x.id)).toEqual(["b", "c", "d"])
    q = pushToast(q, t("e", "d"))
    expect(q.map((x) => x.id)).toEqual(["b", "c", "e"])
    expect(removeToast(q, "c").map((x) => x.id)).toEqual(["b", "e"])
  })
})
