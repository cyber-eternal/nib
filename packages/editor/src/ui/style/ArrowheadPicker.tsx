import type { Arrowhead } from "@nib/core"
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react"
import { Tooltip } from "../primitives"
import { gridMove } from "./grid"
import { arrowheadIcon } from "./icons"
import { ARROWHEAD_LABELS, ARROWHEAD_OPTIONS } from "./options"
import "./StyleBar.css"

export interface IconOption<T> {
  value: T
  label: string
  icon: ReactNode
}

export interface IconGridProps<T> {
  label: string
  options: readonly IconOption<T>[]
  /** The active option; undefined when mixed (nothing pressed). */
  value: T | undefined
  columns?: number
  onChange: (value: T) => void
}

/** Icon toggles in a wrapped grid with one tab stop; arrows move focus, Enter or Space chooses. */
export const IconGrid = <T,>({ label, options, value, columns = 7, onChange }: IconGridProps<T>) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = value === undefined ? -1 : options.findIndex((o) => Object.is(o.value, value))
  const [focus, setFocus] = useState(-1)
  const tabStop = focus >= 0 && focus < options.length ? focus : Math.max(0, selected)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((r) => r === document.activeElement)
    const next = gridMove(from < 0 ? tabStop : from, options.length, columns, e.key)
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
      className="sc-style-icongrid"
      style={{ gridTemplateColumns: `repeat(${columns}, var(--hit-s))` }}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <Tooltip key={o.label} label={o.label}>
          <button
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            className="sc-style-option"
            aria-label={o.label}
            aria-pressed={i === selected}
            tabIndex={i === tabStop ? 0 : -1}
            onFocus={() => setFocus(i)}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

export interface ArrowheadPickerProps {
  end: "start" | "end"
  /** undefined when the selected arrows disagree. */
  value: Arrowhead | null | undefined
  onChange: (value: Arrowhead | null) => void
}

/** Every arrowhead as a drawn preview, so no label is ever cut off. */
export const ArrowheadPicker = ({ end, value, onChange }: ArrowheadPickerProps) => (
  <IconGrid<Arrowhead | null>
    label={end === "start" ? "Start arrowhead" : "End arrowhead"}
    value={value}
    onChange={onChange}
    options={ARROWHEAD_OPTIONS.map((k) => ({
      value: k,
      label: ARROWHEAD_LABELS[k ?? "none"],
      icon: arrowheadIcon(k, end === "start"),
    }))}
  />
)
