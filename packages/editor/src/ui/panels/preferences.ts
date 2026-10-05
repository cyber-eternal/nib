import type { PlatformPrefs } from "@nib/platform"

/** "true" when the pen marker starts as the pencil (shape correction on); the tray writes it too. */
export const PENCIL_DEFAULT_PREF = "nib.pencilDefault"
/** "false" turns off the "Snapped to a circle" hint after a pencil correction. */
export const PENCIL_HINTS_PREF = "nib.pencilHints"
/** "false" starts the desktop app on one empty tab instead of the last session's (prefs.rs reads it too). */
export const REOPEN_TABS_PREF = "nib.reopenTabs"
/** "true" forces reduced motion even when the system allows motion. */
export const REDUCE_MOTION_PREF = "nib.reduceMotion"

const TRUE = new Set(["true", "1", "yes", "on", "pencil"])
const FALSE = new Set(["false", "0", "no", "off", "pen"])

export const readBoolPref = (
  prefs: PlatformPrefs | null | undefined,
  key: string,
  fallback: boolean,
): boolean => {
  const raw = prefs?.get(key)?.trim().toLowerCase()
  if (raw && TRUE.has(raw)) return true
  if (raw && FALSE.has(raw)) return false
  return fallback
}

export const writeBoolPref = (prefs: PlatformPrefs | null | undefined, key: string, value: boolean): void => {
  prefs?.set(key, value ? "true" : "false")
}

/** The pen stays raw freehand until the user asks it to correct shapes like the pencil. */
export const pencilIsDefault = (prefs: PlatformPrefs | null | undefined): boolean =>
  readBoolPref(prefs, PENCIL_DEFAULT_PREF, false)

export const pencilHintsEnabled = (prefs: PlatformPrefs | null | undefined): boolean =>
  readBoolPref(prefs, PENCIL_HINTS_PREF, true)

export const reopensTabs = (prefs: PlatformPrefs | null | undefined): boolean =>
  readBoolPref(prefs, REOPEN_TABS_PREF, true)

export const reduceMotionForced = (prefs: PlatformPrefs | null | undefined): boolean =>
  readBoolPref(prefs, REDUCE_MOTION_PREF, false)

const systemReducesMotion = (): boolean => {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/** What CanvasHost's correction flash and any scripted motion should honour. */
export const prefersReducedMotion = (prefs?: PlatformPrefs | null): boolean =>
  reduceMotionForced(prefs) || systemReducesMotion()

const MOTION_VARS = ["--dur-fast", "--dur", "--dur-slow", "--dur-lift"] as const

/**
 * Applies the in-app override on the themed root, the way tokens.css answers the system setting: every
 * duration token drops to zero and the lifted marker stays put. Off restores the stylesheet's values.
 */
export const applyMotionPreference = (root: HTMLElement, reduce: boolean): void => {
  for (const name of MOTION_VARS) {
    if (reduce) root.style.setProperty(name, "0ms")
    else root.style.removeProperty(name)
  }
  if (reduce) root.style.setProperty("--lift", "0px")
  else root.style.removeProperty("--lift")
  if (reduce) root.dataset.nibMotion = "reduce"
  else delete root.dataset.nibMotion
}
