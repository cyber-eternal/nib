import type { PlatformPrefs } from "@nib/platform"
import {
  DEFAULT_THEME_ID,
  MATCH_SYSTEM,
  SYSTEM_THEMES,
  THEME_PREF_KEY,
  type ThemeDef,
  type ThemeId,
  getTheme,
  isThemeId,
  matchSystemTheme,
} from "../../theme/themes"

export const MATCH_SYSTEM_PREF_KEY = "nib.matchSystem"

export interface ThemeChoice {
  /** The theme picked by hand; null until the user picks one. */
  themeId: ThemeId | null
  /** Follow prefers-color-scheme with Whiteboard (light) and Graphite (dark). */
  matchSystem: boolean
}

const truthy = (v: string | null): boolean | null => {
  if (v === null) return null
  if (v === "1" || v === "true") return true
  if (v === "0" || v === "false") return false
  return null
}

/** An older "nib.theme" = "system" pref means Match system; a first launch opens on the default theme. */
export const readThemeChoice = (prefs: Pick<PlatformPrefs, "get">): ThemeChoice => {
  const raw = prefs.get(THEME_PREF_KEY)
  const themeId = isThemeId(raw) ? raw : null
  const match = truthy(prefs.get(MATCH_SYSTEM_PREF_KEY))
  return { themeId, matchSystem: match ?? raw === MATCH_SYSTEM }
}

export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): ThemeDef =>
  choice.matchSystem ? matchSystemTheme(prefersDark) : getTheme(choice.themeId ?? DEFAULT_THEME_ID)

/** Picking a theme by hand turns Match system off. */
export const pickTheme = (prefs: PlatformPrefs, id: ThemeId): ThemeChoice => {
  prefs.set(THEME_PREF_KEY, id)
  prefs.set(MATCH_SYSTEM_PREF_KEY, "0")
  return { themeId: id, matchSystem: false }
}

/** Turning Match system off keeps whatever is showing, so the board doesn't change under the user. */
export const setMatchSystem = (
  prefs: PlatformPrefs,
  choice: ThemeChoice,
  on: boolean,
  showing: ThemeId,
): ThemeChoice => {
  prefs.set(MATCH_SYSTEM_PREF_KEY, on ? "1" : "0")
  if (on) return { ...choice, matchSystem: true }
  prefs.set(THEME_PREF_KEY, showing)
  return { themeId: showing, matchSystem: false }
}

/**
 * The theme ⇧⌥D flips to: the last theme used in the other mode during this session, else that mode's
 * Match system pair.
 */
export const oppositeTheme = (
  current: ThemeDef,
  lastByMode: Partial<Record<ThemeDef["mode"], ThemeId>> = {},
): ThemeId => {
  const other = current.mode === "light" ? "dark" : "light"
  return lastByMode[other] ?? SYSTEM_THEMES[other]
}
