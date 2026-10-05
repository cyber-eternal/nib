import { type CSSProperties, type RefObject, useId, useRef } from "react"
import { type ThemeDef, type ThemeId, themes } from "../../theme/themes"
import { Popover, Switch } from "../primitives"
import { gridMove } from "./gridNav"
import { useMediaQuery } from "./useMediaQuery"
import "./shell.css"

export const DECK_COLUMNS = 5

/** Phone widths give the deck three columns, so every theme name fits on its card. */
export const DECK_NARROW_QUERY = "(max-width: 479px)"

/** The deck's column count, which the grid's CSS and its arrow keys both follow. */
export const deckColumns = (narrow: boolean): number => (narrow ? 3 : DECK_COLUMNS)

export interface ThemeDeckProps {
  open: boolean
  onClose(): void
  anchor: RefObject<HTMLElement | null>
  current: ThemeId
  matchSystem: boolean
  onSelect(id: ThemeId): void
  onMatchSystem(on: boolean): void
}

/** The theme deck: ten miniature boards, each in its own colours, plus Match system. */
export function ThemeDeck({
  open,
  onClose,
  anchor,
  current,
  matchSystem,
  onSelect,
  onMatchSystem,
}: ThemeDeckProps) {
  const titleId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const columns = deckColumns(useMediaQuery(DECK_NARROW_QUERY))
  const checked = Math.max(
    0,
    themes.findIndex((t) => t.id === current),
  )

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      side="bottom"
      align="end"
      labelledBy={titleId}
      initialFocus={() => refs.current[checked]}
      className="shell-deck"
    >
      <div className="shell-deck-head">
        <h2 id={titleId} className="shell-deck-title">
          Theme
        </h2>
        <Switch label="Match system" checked={matchSystem} onChange={onMatchSystem} />
      </div>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        className="shell-deck-grid"
        style={{ "--deck-columns": columns } as CSSProperties}
        onKeyDown={(e) => {
          const from = refs.current.findIndex((r) => r === document.activeElement)
          const next = gridMove(from < 0 ? checked : from, e.key, columns, themes.length)
          if (next === null) return
          e.preventDefault()
          e.stopPropagation()
          refs.current[next]?.focus()
          onSelect(themes[next]!.id)
        }}
      >
        {themes.map((t, i) => (
          <ThemeCard
            key={t.id}
            def={t}
            checked={t.id === current}
            buttonRef={(el) => {
              refs.current[i] = el
            }}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </div>
      {matchSystem ? (
        <p className="shell-deck-note">
          Following the system: Whiteboard in light appearance, Graphite in dark.
        </p>
      ) : null}
    </Popover>
  )
}

interface CardProps {
  def: ThemeDef
  checked: boolean
  onSelect(): void
  buttonRef: (el: HTMLButtonElement | null) => void
}

const ThemeCard = ({ def, checked, onSelect, buttonRef }: CardProps) => (
  <button
    ref={buttonRef}
    type="button"
    role="radio"
    aria-checked={checked}
    tabIndex={checked ? 0 : -1}
    className="shell-deck-card"
    onClick={onSelect}
  >
    <ThemeMiniature def={def} />
    <span className="shell-deck-name">{def.name}</span>
  </button>
)

/** A tiny board in the theme's own colours: a course-ink stroke and a tray with its five caps. */
export const ThemeMiniature = ({ def }: { def: ThemeDef }) => (
  <span
    className="shell-mini"
    aria-hidden="true"
    style={
      {
        "--mini-board": def.board,
        "--mini-tray": def.tray,
        "--mini-ink": def.ink,
        "--mini-course": def.course,
      } as CSSProperties
    }
  >
    <span className="shell-mini-stroke" />
    <span className="shell-mini-tray">
      {def.caps.map((cap, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: caps are positional and may repeat
        <span key={i} className="shell-mini-cap" style={{ background: cap }} />
      ))}
    </span>
  </span>
)
