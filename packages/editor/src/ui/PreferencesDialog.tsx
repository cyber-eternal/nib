import { DEFAULT_GRID_SIZE, type EditorCore, MAX_GRID_SIZE, MIN_GRID_SIZE } from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { useCoreVersion } from "../hooks/useEditor"
import { type ThemeDef, type ThemeId, getTheme, themes } from "../theme/themes"
import {
  PENCIL_DEFAULT_PREF,
  PENCIL_HINTS_PREF,
  REDUCE_MOTION_PREF,
  REOPEN_TABS_PREF,
  applyMotionPreference,
  pencilHintsEnabled,
  pencilIsDefault,
  reduceMotionForced,
  reopensTabs,
  writeBoolPref,
} from "./panels/preferences"
import { Dialog } from "./primitives/Dialog"
import { Switch } from "./primitives/Switch"
import "./panels/panels.css"

export interface PreferencesDialogProps {
  core: EditorCore
  prefs: PlatformPrefs
  onClose(): void
  /** Defaults to true, so the shell can mount it only while it is open. */
  open?: boolean
  /** The theme in use; the Appearance section shows when onThemeChange is given. */
  theme?: ThemeDef | ThemeId
  matchSystem?: boolean
  onThemeChange?(id: ThemeId): void
  onMatchSystemChange?(on: boolean): void
  /** Lets the tray follow a new pen default at once (the pref is written either way). */
  onPencilDefaultChange?(on: boolean): void
  /** Applies the reduced-motion override; defaults to applyMotionPreference on the document root. */
  onReduceMotionChange?(on: boolean): void
  /** Shows Reopen tabs on launch, for the desktop app, whose shell decides what a launch restores. */
  sessionRestore?: boolean
}

const COLUMNS = 5

function ThemePicker({
  current,
  matchSystem,
  onPick,
}: {
  current: ThemeId | null
  matchSystem: boolean
  onPick(id: ThemeId): void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const checked = themes.findIndex((t) => t.id === current)
  const tabStop = checked >= 0 ? checked : 0

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((r) => r === document.activeElement)
    if (from < 0) return
    const n = themes.length
    const to =
      e.key === "ArrowRight"
        ? (from + 1) % n
        : e.key === "ArrowLeft"
          ? (from - 1 + n) % n
          : e.key === "ArrowDown"
            ? Math.min(n - 1, from + COLUMNS)
            : e.key === "ArrowUp"
              ? Math.max(0, from - COLUMNS)
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? n - 1
                  : -1
    if (to < 0) return
    e.preventDefault()
    e.stopPropagation()
    refs.current[to]?.focus()
    onPick(themes[to]!.id)
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="sc-theme-grid" onKeyDown={onKeyDown}>
      {themes.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={!matchSystem && t.id === current}
          tabIndex={i === tabStop ? 0 : -1}
          className="sc-theme-chip"
          style={
            {
              "--chip-board": t.board,
              "--chip-tray": t.tray,
              "--chip-course": t.course,
              "--chip-cap": t.caps[0],
            } as CSSProperties
          }
          onClick={() => onPick(t.id)}
        >
          <span className="sc-theme-board" aria-hidden="true">
            <span className="sc-theme-tray">
              <i />
              <i />
              <i />
            </span>
          </span>
          {t.name}
        </button>
      ))}
    </div>
  )
}

function GridSizeField({ core, disabled }: { core: EditorCore; disabled: boolean }) {
  const id = useId()
  const size = core.appState.gridSize ?? DEFAULT_GRID_SIZE
  const [draft, setDraft] = useState(String(size))
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  useEffect(() => setDraft(String(size)), [size])

  const commit = () => {
    const n = Number(draft.trim())
    if (!Number.isFinite(n) || n < MIN_GRID_SIZE || n > MAX_GRID_SIZE) {
      setError(`Use a size from ${MIN_GRID_SIZE} to ${MAX_GRID_SIZE}.`)
      setDraft(String(size))
      return
    }
    setError(null)
    if (Math.round(n) !== size) core.setGridSize(Math.round(n))
  }

  return (
    <div className="sc-stack">
      <div className="sc-row">
        <label htmlFor={id} className="sc-row-label">
          Grid size
        </label>
        <span className="sc-number-row">
          <input
            id={id}
            className="sc-input"
            inputMode="numeric"
            autoComplete="off"
            value={draft}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (cancelled.current) cancelled.current = false
              else commit()
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commit()
              } else if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                cancelled.current = true
                setDraft(String(size))
                setError(null)
                e.currentTarget.blur()
              }
            }}
          />
          <span className="sc-hint">px</span>
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="sc-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Appearance, drawing behaviour and this drawing's grid and snapping, all applied as you change them. */
export function PreferencesDialog({
  core,
  prefs,
  onClose,
  open = true,
  theme,
  matchSystem = false,
  onThemeChange,
  onMatchSystemChange,
  onPencilDefaultChange,
  onReduceMotionChange,
  sessionRestore = false,
}: PreferencesDialogProps) {
  useCoreVersion(core)
  const [pencil, setPencil] = useState(() => pencilIsDefault(prefs))
  const [hints, setHints] = useState(() => pencilHintsEnabled(prefs))
  const [reduce, setReduce] = useState(() => reduceMotionForced(prefs))
  const [reopen, setReopen] = useState(() => reopensTabs(prefs))
  const currentTheme = theme ? (typeof theme === "string" ? getTheme(theme) : theme) : null
  const grid = core.appState.gridSize !== null

  return (
    <Dialog open={open} onClose={onClose} title="Preferences" size="m" className="sc-panel-dialog">
      <div className="sc-stack" data-testid="preferences-dialog">
        {onThemeChange ? (
          <section className="sc-section" aria-labelledby="sc-prefs-appearance">
            <h3 id="sc-prefs-appearance" className="sc-section-title">
              Appearance
            </h3>
            <ThemePicker
              current={currentTheme?.id ?? null}
              matchSystem={matchSystem}
              onPick={(id) => {
                if (matchSystem) onMatchSystemChange?.(false)
                onThemeChange(id)
              }}
            />
            {onMatchSystemChange ? (
              <>
                <Switch label="Match system" checked={matchSystem} onChange={onMatchSystemChange} />
                <p className="sc-hint">Whiteboard while your system is light, Graphite while it is dark.</p>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="sc-section" aria-labelledby="sc-prefs-motion">
          <h3 id="sc-prefs-motion" className="sc-section-title">
            Motion
          </h3>
          <Switch
            label="Reduce motion"
            checked={reduce}
            onChange={(on) => {
              setReduce(on)
              writeBoolPref(prefs, REDUCE_MOTION_PREF, on)
              if (onReduceMotionChange) onReduceMotionChange(on)
              else if (typeof document !== "undefined") applyMotionPreference(document.documentElement, on)
            }}
          />
          <p className="sc-hint">Always on when your system asks for less motion.</p>
        </section>

        <section className="sc-section" aria-labelledby="sc-prefs-drawing">
          <h3 id="sc-prefs-drawing" className="sc-section-title">
            Drawing
          </h3>
          <Switch
            label="Pen corrects shapes"
            checked={pencil}
            onChange={(on) => {
              setPencil(on)
              writeBoolPref(prefs, PENCIL_DEFAULT_PREF, on)
              onPencilDefaultChange?.(on)
            }}
          />
          <p className="sc-hint">
            The pen starts as the pencil: hand-drawn circles, boxes, lines and arrows become clean shapes.
          </p>
          <Switch
            label="Explain corrections"
            checked={hints}
            onChange={(on) => {
              setHints(on)
              writeBoolPref(prefs, PENCIL_HINTS_PREF, on)
            }}
          />
          <p className="sc-hint">A short note after the pencil snaps a stroke, with how to get it back.</p>
        </section>

        {sessionRestore ? (
          <section className="sc-section" aria-labelledby="sc-prefs-tabs">
            <h3 id="sc-prefs-tabs" className="sc-section-title">
              Tabs
            </h3>
            <Switch
              label="Reopen tabs on launch"
              checked={reopen}
              onChange={(on) => {
                setReopen(on)
                writeBoolPref(prefs, REOPEN_TABS_PREF, on)
              }}
            />
            <p className="sc-hint">
              Brings back the drawings that were open, where you left them. Unsaved drawings come back either
              way.
            </p>
          </section>
        ) : null}

        <section className="sc-section" aria-labelledby="sc-prefs-drawing-file">
          <h3 id="sc-prefs-drawing-file" className="sc-section-title">
            This drawing
          </h3>
          <Switch
            label="Show grid"
            checked={grid}
            onChange={(on) => {
              // toggleGrid brings back the size the grid had before it was hidden
              if (on !== (core.appState.gridSize !== null)) core.toggleGrid()
            }}
          />
          <GridSizeField core={core} disabled={!grid} />
          <Switch
            label="Snap to objects"
            checked={core.appState.objectsSnapMode}
            onChange={() => core.toggleSnap()}
          />
          <p className="sc-hint">
            Shapes snap to the grid while it shows. Both settings are saved with the drawing.
          </p>
        </section>
      </div>
    </Dialog>
  )
}
