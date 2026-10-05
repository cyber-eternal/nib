import type { NibElement } from "@nib/core"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { ThemeDef } from "../../theme/themes"
import { TRANSPARENT } from "../palette"
import { ColorSwatch, IconButton, Tooltip, isImeKey } from "../primitives"
import { boardColorPickerAvailable, pickColorFromBoard } from "./bus"
import {
  type ColorTarget,
  type Swatch,
  displayCanvasColor,
  displayColor,
  eyeDropperSupported,
  isSelectedSwatch,
  paletteSwatches,
  pickScreenColor,
  recentColors,
  recentRow,
  rememberColor,
  roleFor,
  sceneColors,
  shadeSwatches,
  storedColor,
  subscribeRecent,
  swatchesFor,
  themeCapSwatches,
} from "./colors"
import { keepFieldFocus } from "./fieldPress"
import { gridMove } from "./grid"
import { hexDraft, parseHexInput, sameColor } from "./hex"
import { StyleIcons } from "./icons"
import { useCommitOnOutsidePress } from "./useCommitOnOutsidePress"
import "./StyleBar.css"

export interface SwatchGridProps {
  label: string
  swatches: readonly Swatch[]
  /** Stored colour of the selection; null when mixed. */
  current: string | null
  columns?: number
  onPick: (swatch: Swatch) => void
}

/** A row or grid of swatches with one tab stop; arrows move focus, Enter or Space picks (one undo step). */
export const SwatchGrid = ({ label, swatches, current, columns = 7, onPick }: SwatchGridProps) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = swatches.findIndex((s) => isSelectedSwatch(s, current))
  const [focus, setFocus] = useState(-1)
  const tabStop = focus >= 0 && focus < swatches.length ? focus : Math.max(0, selected)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((r) => r === document.activeElement)
    const next = gridMove(from < 0 ? tabStop : from, swatches.length, columns, e.key)
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    setFocus(next)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="sc-style-swatches"
      style={{ gridTemplateColumns: `repeat(${columns}, var(--hit-s))` }}
      onKeyDown={onKeyDown}
    >
      {swatches.map((s, i) => (
        <Tooltip key={`${s.stored}-${i}`} label={s.name}>
          <ColorSwatch
            ref={(el) => {
              refs.current[i] = el
            }}
            color={s.display}
            drawn={s.drawn}
            name={s.name}
            selected={i === selected}
            tabIndex={i === tabStop ? 0 : -1}
            onFocus={() => setFocus(i)}
            onClick={() => onPick(s)}
          />
        </Tooltip>
      ))}
    </div>
  )
}

export interface HexFieldProps {
  label: string
  /** The colour as shown on the board, or null when the selection is mixed. */
  value: string | null
  allowTransparent?: boolean
  onCommit: (display: string) => void
  /** Sits beside the field, level with its box (the eyedropper). */
  children?: ReactNode
}

/**
 * Hex entry that commits once, on Enter or blur, so typing #123456 never paints #123 first.
 * Escape with an edited draft reverts it and keeps the popover open.
 */
export const HexField = ({ label, value, allowTransparent, onCommit, children }: HexFieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  const [draft, setDraft] = useState(() => hexDraft(value))
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!dirty.current) setDraft(hexDraft(value))
  }, [value])

  const revert = () => {
    dirty.current = false
    setError(null)
    setDraft(hexDraft(value))
  }

  const commit = (fromBlur: boolean): boolean => {
    if (!dirty.current) return true
    const r = parseHexInput(draft, { allowTransparent })
    if (!r.ok) {
      if (fromBlur) revert()
      else setError(r.error)
      return false
    }
    dirty.current = false
    setError(null)
    setDraft(hexDraft(r.color))
    if (value === null || !sameColor(r.color, value)) onCommit(r.color)
    return true
  }

  // the label, the box and the message count as the field: a press on them keeps the draft
  useCommitOnOutsidePress(fieldRef, () => {
    if (dirty.current) commit(true)
  })

  return (
    <div ref={fieldRef} className="sc-style-hex-field" onMouseDown={keepFieldFocus(inputRef)}>
      <div className="sc-style-hex-row">
        <div className="sc-style-hex">
          <label htmlFor={id} className="sc-style-hex-label">
            {label}
          </label>
          <div className="sc-style-hex-box" data-invalid={error ? "" : undefined}>
            <span className="sc-style-hex-hash" aria-hidden="true">
              #
            </span>
            <input
              ref={inputRef}
              id={id}
              className="sc-style-hex-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={16}
              placeholder={value === null ? "Mixed" : value === TRANSPARENT ? "None" : undefined}
              value={draft}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                dirty.current = true
                setError(null)
                setDraft(e.currentTarget.value)
              }}
              onKeyDown={(e) => {
                if (isImeKey(e)) return
                if (e.key === "Enter") {
                  e.preventDefault()
                  commit(false)
                } else if (e.key === "Escape" && dirty.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  revert()
                }
              }}
              onBlur={() => commit(true)}
            />
          </div>
        </div>
        {children}
      </div>
      {/* always laid out: the popover grows from its bottom edge, so a message appearing would lift the
          field out from under the pointer */}
      <p id={errorId} className="sc-style-hex-error" role="alert">
        {error ?? ""}
      </p>
    </div>
  )
}

export interface ColorPanelProps {
  target: ColorTarget
  theme: ThemeDef
  /** Stored colour of the selection (or the next element); null when mixed. */
  current: string | null
  onPick: (stored: string) => void
  /** Scene elements, for the colours already used on this canvas. */
  elements?: readonly NibElement[]
  /** Accessible name prefix: "Stroke", "Background", "Canvas". */
  label: string
  /** Closes the surrounding popover, so a board pick can see the board. */
  onRequestClose?: () => void
  children?: ReactNode
}

const useRecent = (target: ColorTarget): readonly string[] =>
  useSyncExternalStore(
    subscribeRecent,
    () => recentColors(target),
    () => recentColors(target),
  )

/** Theme palette, shades, recent colours, hex entry and (where the browser has one) an eyedropper. */
export const ColorPanel = ({
  target,
  theme,
  current,
  onPick,
  elements,
  label,
  onRequestClose,
  children,
}: ColorPanelProps) => {
  const picked = useRecent(target)
  const caps = useMemo(() => (target === "stroke" ? themeCapSwatches(theme) : []), [target, theme])
  const palette = useMemo(() => paletteSwatches(target, theme), [target, theme])
  const shades = useMemo(
    () => (target === "canvas" ? [] : shadeSwatches(current, target, theme)),
    [target, current, theme],
  )
  const onCanvas = useMemo(
    () => (elements && target !== "canvas" ? sceneColors(elements, target) : []),
    [elements, target],
  )
  const recent = useMemo(() => {
    const shown = [...caps, ...palette, ...shades].map((s) => s.stored)
    return swatchesFor(recentRow(picked, onCanvas, shown), target, theme)
  }, [picked, onCanvas, caps, palette, shades, target, theme])

  const pick = (stored: string) => {
    rememberColor(target, stored)
    onPick(stored)
  }
  const pickDisplay = (display: string) =>
    pick(display === TRANSPARENT ? TRANSPARENT : storedColor(display, theme))

  const shownValue =
    current === null
      ? null
      : target === "canvas"
        ? displayCanvasColor(current, theme)
        : current === TRANSPARENT
          ? TRANSPARENT
          : displayColor(current, theme, roleFor(target))

  const boardTarget = target === "canvas" ? null : target
  const fromBoard = boardTarget !== null && boardColorPickerAvailable()
  const canDrop = fromBoard || eyeDropperSupported()
  const dropper = () => {
    if (fromBoard && boardTarget) {
      onRequestClose?.()
      pickColorFromBoard(boardTarget)
      return
    }
    void pickScreenColor().then((c) => {
      if (c) pickDisplay(c)
    })
  }

  return (
    <div className="sc-style-color">
      {caps.length > 0 ? (
        <Section title="Theme markers">
          <SwatchGrid
            label={`${label}: theme markers`}
            swatches={caps}
            current={current}
            onPick={(s) => pick(s.stored)}
          />
        </Section>
      ) : null}
      <Section title={target === "canvas" ? "Canvas" : "Colours"}>
        <SwatchGrid
          label={`${label}: colours`}
          swatches={palette}
          current={current}
          onPick={(s) => pick(s.stored)}
        />
      </Section>
      {shades.length > 0 ? (
        <Section title="Shades">
          <SwatchGrid
            label={`${label}: shades`}
            swatches={shades}
            current={current}
            onPick={(s) => pick(s.stored)}
          />
        </Section>
      ) : null}
      {recent.length > 0 ? (
        <Section title="Recent">
          <SwatchGrid
            label={`${label}: recent`}
            swatches={recent}
            current={current}
            columns={Math.min(7, recent.length)}
            onPick={(s) => pick(s.stored)}
          />
        </Section>
      ) : null}
      <HexField
        label="Hex"
        value={shownValue}
        allowTransparent={target === "background"}
        onCommit={pickDisplay}
      >
        {canDrop ? (
          <IconButton
            label={fromBoard ? "Take a colour from a shape" : "Pick a colour from the screen"}
            icon={StyleIcons.eyedropper}
            size="s"
            shortcut={fromBoard ? "I" : undefined}
            onClick={dropper}
          />
        ) : null}
      </HexField>
      {children}
    </div>
  )
}

export const Section = ({ title, children }: { title: string; children?: ReactNode }) => {
  const id = useId()
  return (
    <section className="sc-style-section" aria-labelledby={id}>
      <h3 id={id} className="sc-style-heading">
        {title}
      </h3>
      {children}
    </section>
  )
}
