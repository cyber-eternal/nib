import { type NibElement, type Theme, themeColor } from "@nib/core"
import { type CSSProperties, useId, useRef, useState } from "react"
import type { ThemeDef } from "../../theme/themes"
import { Icons } from "../Icons"
import { ColorSwatch } from "../primitives/ColorSwatch"
import { Popover } from "../primitives/Popover"
import { Tooltip } from "../primitives/Tooltip"
import { ColorPanel } from "../style/ColorPanel"
import { capIndexFor, capStroke, colorName } from "./trayModel"

export interface ColorCapsProps {
  /** Display colours of the theme's five marker caps. */
  caps: readonly string[]
  /** Their spoken names (ThemeDef.capNames); named from the colours when absent. */
  names?: readonly string[]
  mode: Theme
  board?: string
  /** Stored stroke of the selection (or the default for the next element); null for a mixed selection. */
  stroke: string | null
  /** Narrow windows show only the current cap, which opens the palette. */
  collapsed: boolean
  disabled?: boolean
  /** The applied theme, for the full colour picker the custom cap opens (the style bar's own). */
  theme: ThemeDef
  /** Scene elements, for the picker's colours-on-this-board row. */
  elements?: () => readonly NibElement[]
  /** Receives the colour to store; the caller applies it as one undo step. */
  onPick: (stored: string) => void
}

/** The tray's colour caps: the theme's five, a ring on the current one, and a custom cap for everything else. */
export const ColorCaps = ({
  caps,
  names,
  mode,
  board,
  stroke,
  collapsed,
  disabled,
  theme,
  elements,
  onPick,
}: ColorCapsProps) => {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const current = capIndexFor(stroke, caps, mode, board)
  const shown = stroke ? themeColor(stroke, mode, board) : null
  const custom = current < 0 && shown !== null
  const nameOf = (i: number): string => names?.[i] ?? colorName(caps[i]!)
  const shownName = shown === null ? "mixed" : current >= 0 ? nameOf(current) : colorName(shown)

  const pick = (stored: string) => {
    setOpen(false)
    onPick(stored)
  }

  const openerLabel = collapsed
    ? `Stroke colour: ${shownName}`
    : custom
      ? `Custom colour: ${shownName}`
      : shown
        ? "More colours"
        : "More colours (mixed selection)"

  const chipFilled = collapsed ? shown !== null : custom
  const openerButton = (
    <Tooltip label={openerLabel}>
      <button
        ref={opener}
        type="button"
        className="tray-cap-custom"
        aria-label={openerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        data-selected={(collapsed ? shown !== null : custom) || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span
          className="tray-cap-chip"
          data-filled={chipFilled || undefined}
          style={chipFilled && shown ? ({ "--swatch": shown } as CSSProperties) : undefined}
          aria-hidden="true"
        >
          {chipFilled ? null : shown === null ? Icons.minus : Icons.plus}
        </span>
      </button>
    </Tooltip>
  )

  return (
    <div className="tray-group tray-caps" role="group" aria-label="Stroke colour">
      {collapsed
        ? null
        : caps.map((cap, i) => {
            const name = nameOf(i)
            return (
              <Tooltip key={`${i}-${cap}`} label={name}>
                <ColorSwatch
                  className="tray-cap"
                  size="m"
                  color={cap}
                  name={name}
                  selected={i === current}
                  disabled={disabled}
                  onClick={() => onPick(capStroke(cap, mode, board))}
                />
              </Tooltip>
            )
          })}
      {openerButton}
      <Popover
        open={open}
        id={popoverId}
        onClose={() => setOpen(false)}
        anchor={opener}
        side="top"
        align="end"
        offset={12}
        label="Stroke colour"
        className="sc-style-pop"
      >
        <div className="sc-style-pop-body">
          <ColorPanel
            target="stroke"
            label="Stroke"
            theme={theme}
            current={stroke}
            elements={open ? elements?.() : undefined}
            onRequestClose={() => setOpen(false)}
            onPick={pick}
          />
        </div>
      </Popover>
    </div>
  )
}
