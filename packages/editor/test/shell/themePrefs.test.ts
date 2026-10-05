import { describe, expect, it } from "vitest"
import { MATCH_SYSTEM, THEME_PREF_KEY, getTheme } from "../../src/theme/themes"
import {
  MATCH_SYSTEM_PREF_KEY,
  oppositeTheme,
  pickTheme,
  readThemeChoice,
  resolveTheme,
  setMatchSystem,
} from "../../src/ui/shell/themePrefs"
import { memoryPrefs } from "./helpers"

describe("reading the theme choice", () => {
  it("first launch opens on Clay Dark whatever the OS does", () => {
    const choice = readThemeChoice(memoryPrefs())
    expect(choice).toEqual({ themeId: null, matchSystem: false })
    expect(resolveTheme(choice, false).id).toBe("clay")
    expect(resolveTheme(choice, true).id).toBe("clay")
  })

  it("a picked theme sticks whatever the OS does", () => {
    const prefs = memoryPrefs({ [THEME_PREF_KEY]: "kraft", [MATCH_SYSTEM_PREF_KEY]: "0" })
    const choice = readThemeChoice(prefs)
    expect(choice).toEqual({ themeId: "kraft", matchSystem: false })
    expect(resolveTheme(choice, true).id).toBe("kraft")
  })

  it("an older pref of 'system' means Match system", () => {
    expect(readThemeChoice(memoryPrefs({ [THEME_PREF_KEY]: MATCH_SYSTEM })).matchSystem).toBe(true)
  })

  it("a theme id with no match flag is a hand pick", () => {
    expect(readThemeChoice(memoryPrefs({ [THEME_PREF_KEY]: "mint" }))).toEqual({
      themeId: "mint",
      matchSystem: false,
    })
  })

  it("an unknown or stale id falls back to the default theme", () => {
    const choice = readThemeChoice(memoryPrefs({ [THEME_PREF_KEY]: "neon", [MATCH_SYSTEM_PREF_KEY]: "0" }))
    expect(choice.themeId).toBeNull()
    expect(resolveTheme(choice, false).id).toBe("clay")
  })

  it("Match system on wins over a stored theme", () => {
    const prefs = memoryPrefs({ [THEME_PREF_KEY]: "sakura", [MATCH_SYSTEM_PREF_KEY]: "1" })
    expect(resolveTheme(readThemeChoice(prefs), false).id).toBe("whiteboard")
  })
})

describe("persisting the theme choice", () => {
  it("picking a theme stores it and turns Match system off", () => {
    const prefs = memoryPrefs({ [MATCH_SYSTEM_PREF_KEY]: "1" })
    const choice = pickTheme(prefs, "blueprint")
    expect(choice).toEqual({ themeId: "blueprint", matchSystem: false })
    expect(prefs.get(THEME_PREF_KEY)).toBe("blueprint")
    expect(prefs.get(MATCH_SYSTEM_PREF_KEY)).toBe("0")
    expect(readThemeChoice(prefs)).toEqual(choice)
  })

  it("turning Match system off keeps the theme that was showing", () => {
    const prefs = memoryPrefs()
    const on = readThemeChoice(prefs)
    const off = setMatchSystem(prefs, on, false, "graphite")
    expect(off).toEqual({ themeId: "graphite", matchSystem: false })
    expect(readThemeChoice(prefs)).toEqual(off)
  })

  it("turning Match system on remembers the hand pick for later", () => {
    const prefs = memoryPrefs()
    const picked = pickTheme(prefs, "legalpad")
    const on = setMatchSystem(prefs, picked, true, "legalpad")
    expect(on).toEqual({ themeId: "legalpad", matchSystem: true })
    expect(prefs.get(THEME_PREF_KEY)).toBe("legalpad")
    expect(readThemeChoice(prefs).matchSystem).toBe(true)
  })
})

describe("⇧⌥D flips light and dark", () => {
  it("goes to the system pair of the other mode", () => {
    expect(oppositeTheme(getTheme("kraft"))).toBe("clay")
    expect(oppositeTheme(getTheme("midnight"))).toBe("whiteboard")
  })

  it("prefers the last theme used in the other mode", () => {
    expect(oppositeTheme(getTheme("mint"), { dark: "blackboard" })).toBe("blackboard")
    expect(oppositeTheme(getTheme("blueprint"), { light: "sakura", dark: "blueprint" })).toBe("sakura")
  })
})
