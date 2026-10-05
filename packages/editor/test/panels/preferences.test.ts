import type { PlatformPrefs } from "@nib/platform"
import { describe, expect, it } from "vitest"
import {
  PENCIL_DEFAULT_PREF,
  REDUCE_MOTION_PREF,
  REOPEN_TABS_PREF,
  applyMotionPreference,
  pencilHintsEnabled,
  pencilIsDefault,
  readBoolPref,
  reduceMotionForced,
  reopensTabs,
  writeBoolPref,
} from "../../src/ui/panels/preferences"

const memoryPrefs = (): PlatformPrefs & { store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    get: (k) => store.get(k) ?? null,
    set: (k, v) => (v === null ? store.delete(k) : store.set(k, v)) && undefined,
  }
}

describe("preference values", () => {
  it("reads lenient booleans and falls back", () => {
    const prefs = memoryPrefs()
    expect(readBoolPref(prefs, "x", true)).toBe(true)
    prefs.set("x", "0")
    expect(readBoolPref(prefs, "x", true)).toBe(false)
    prefs.set("x", "pencil")
    expect(readBoolPref(prefs, "x", false)).toBe(true)
    prefs.set("x", "garbage")
    expect(readBoolPref(prefs, "x", false)).toBe(false)
  })

  it("defaults: the pen stays raw, hints on, motion follows the system", () => {
    const prefs = memoryPrefs()
    expect(pencilIsDefault(prefs)).toBe(false)
    expect(pencilHintsEnabled(prefs)).toBe(true)
    expect(reduceMotionForced(prefs)).toBe(false)
    writeBoolPref(prefs, PENCIL_DEFAULT_PREF, true)
    writeBoolPref(prefs, REDUCE_MOTION_PREF, true)
    expect(prefs.store.get(PENCIL_DEFAULT_PREF)).toBe("true")
    expect(pencilIsDefault(prefs)).toBe(true)
    expect(reduceMotionForced(prefs)).toBe(true)
  })
})

describe("reopen tabs on launch", () => {
  it("is on until switched off, under the key the desktop shell reads at launch", () => {
    const prefs = memoryPrefs()
    expect(REOPEN_TABS_PREF).toBe("nib.reopenTabs")
    expect(reopensTabs(prefs)).toBe(true)
    writeBoolPref(prefs, REOPEN_TABS_PREF, false)
    expect(prefs.store.get(REOPEN_TABS_PREF)).toBe("false")
    expect(reopensTabs(prefs)).toBe(false)
  })
})

describe("reduced-motion override", () => {
  it("zeroes the motion tokens on the root and restores them", () => {
    const props = new Map<string, string>()
    const root = {
      style: {
        setProperty: (k: string, v: string) => props.set(k, v),
        removeProperty: (k: string) => props.delete(k),
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement
    applyMotionPreference(root, true)
    expect(props.get("--dur")).toBe("0ms")
    expect(props.get("--lift")).toBe("0px")
    expect(root.dataset.nibMotion).toBe("reduce")
    applyMotionPreference(root, false)
    expect(props.size).toBe(0)
    expect(root.dataset.nibMotion).toBeUndefined()
  })
})
