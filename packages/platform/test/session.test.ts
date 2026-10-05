import { describe, expect, it } from "vitest"
import { isRecoverySlot, newRecoverySlot, readRestoredSession, recoveryFiles, sanitizeViewport } from "../src"

describe("per-tab recovery copies", () => {
  it("names each tab's copy after its slot", () => {
    expect(recoveryFiles("t1759750000000-3")).toEqual({
      file: "recovery/t1759750000000-3.nibd",
      meta: "recovery/t1759750000000-3.meta.json",
    })
  })

  it("keeps the single-document name of earlier versions where there is no slot", () => {
    expect(recoveryFiles()).toEqual({ file: "recovery/current.nibd", meta: "recovery/current.meta.json" })
  })

  it("never lets a slot name leave the recovery folder", () => {
    for (const bad of ["../prefs", "a/b", "", "x".repeat(65), ".hidden"]) {
      expect(isRecoverySlot(bad)).toBe(false)
      expect(recoveryFiles(bad).file).toBe("recovery/current.nibd")
    }
  })

  it("makes a new, valid slot every time", () => {
    const slots = new Set(Array.from({ length: 50 }, () => newRecoverySlot(1_759_750_000_000)))
    expect(slots.size).toBe(50)
    for (const s of slots) expect(isRecoverySlot(s)).toBe(true)
  })
})

describe("restored session", () => {
  it("reads the tabs, the one in front and the notices", () => {
    expect(
      readRestoredSession({
        tabs: [
          { slot: "t1", open: "/d/a.nibd", viewport: { scrollX: -10, scrollY: 20, zoom: 1.25 } },
          { slot: "t2", open: null },
        ],
        active: 1,
        notices: ["“b.nibd” was moved or deleted, so it wasn't reopened.", 4, ""],
      }),
    ).toEqual({
      tabs: [
        { slot: "t1", open: "/d/a.nibd", viewport: { scrollX: -10, scrollY: 20, zoom: 1.25 } },
        { slot: "t2", open: null, viewport: null },
      ],
      active: 1,
      notices: ["“b.nibd” was moved or deleted, so it wasn't reopened."],
    })
  })

  it("drops bad and repeated tabs and keeps the front tab in range", () => {
    const s = readRestoredSession({
      tabs: [{ slot: "../x" }, { slot: "t1", viewport: "far" }, { slot: "t1" }, "junk"],
      active: 7,
    })
    expect(s).toEqual({ tabs: [{ slot: "t1", open: null, viewport: null }], active: 0, notices: [] })
  })

  it("is null when there is nothing to restore", () => {
    for (const raw of [undefined, null, "x", {}, { tabs: [] }]) expect(readRestoredSession(raw)).toBeNull()
  })

  it("drops views the editor could not show", () => {
    expect(sanitizeViewport({ scrollX: 0, scrollY: 0, zoom: 0.01 })).toBeNull()
    expect(sanitizeViewport({ scrollX: Number.NaN, scrollY: 0, zoom: 1 })).toBeNull()
    expect(sanitizeViewport({ scrollX: 1, scrollY: 2, zoom: 30 })).toEqual({
      scrollX: 1,
      scrollY: 2,
      zoom: 30,
    })
  })
})
