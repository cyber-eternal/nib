import type { EditorCore } from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  type CanvasPalette,
  type ThemeDef,
  type ThemeId,
  applyTheme,
  canvasPaletteFor,
  systemPrefersDark,
  watchSystemDark,
} from "../../theme/themes"
import {
  type ThemeChoice,
  oppositeTheme,
  pickTheme,
  readThemeChoice,
  resolveTheme,
  setMatchSystem as writeMatchSystem,
} from "./themePrefs"

export interface ThemeController {
  def: ThemeDef
  matchSystem: boolean
  palette: CanvasPalette
  select(id: ThemeId): void
  setMatchSystem(on: boolean): void
  /** ⇧⌥D: flips between a light and a dark theme. */
  toggleMode(): void
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/** Owns the UI theme: reads and persists the choice, follows the OS when asked, and themes the page. */
export const useThemeController = (prefs: PlatformPrefs, core: EditorCore): ThemeController => {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice(prefs))
  const [dark, setDark] = useState(systemPrefersDark)
  const def = resolveTheme(choice, dark)
  const lastByMode = useRef<Partial<Record<ThemeDef["mode"], ThemeId>>>({})
  const latest = useRef({ def, choice })
  latest.current = { def, choice }

  useEffect(() => watchSystemDark(setDark), [])

  useIsoLayoutEffect(() => {
    lastByMode.current[def.mode] = def.id
    applyTheme(document.documentElement, def)
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", def.board)
    if (core.appState.theme !== def.mode) core.setAppState({ theme: def.mode })
  }, [def, core])

  const select = useCallback((id: ThemeId) => setChoice(pickTheme(prefs, id)), [prefs])

  const setMatchSystem = useCallback(
    (on: boolean) => {
      const { choice: c, def: d } = latest.current
      setChoice(writeMatchSystem(prefs, c, on, d.id))
    },
    [prefs],
  )

  const toggleMode = useCallback(() => {
    setChoice(pickTheme(prefs, oppositeTheme(latest.current.def, lastByMode.current)))
  }, [prefs])

  const palette = useMemo(() => canvasPaletteFor(def), [def])

  return useMemo(
    () => ({ def, matchSystem: choice.matchSystem, palette, select, setMatchSystem, toggleMode }),
    [def, choice.matchSystem, palette, select, setMatchSystem, toggleMode],
  )
}
