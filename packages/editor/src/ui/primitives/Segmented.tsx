import { type KeyboardEvent, type ReactNode, useRef } from "react"
import { Tooltip } from "./Tooltip"
import { moveIndex, navMoveFor } from "./menuNav"

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Icon-only option: the label becomes its accessible name and tooltip. */
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  label: string
  options: readonly SegmentedOption<T>[]
  /** null shows the mixed state: nothing checked. */
  value: T | null
  onChange: (value: T) => void
  className?: string
}

/** A radio group of segments: one tab stop, arrow keys move and select (ARIA radio pattern). */
export const Segmented = <T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const disabled = options.map((o) => !!o.disabled)
  const checked = options.findIndex((o) => o.value === value)
  const tabStop = checked >= 0 && !disabled[checked] ? checked : moveIndex(disabled, -1, "first")

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = navMoveFor(e.key, "both")
    if (!move) return
    e.preventDefault()
    e.stopPropagation()
    const from = refs.current.findIndex((r) => r === document.activeElement)
    const next = moveIndex(disabled, from < 0 ? tabStop : from, move)
    if (next < 0) return
    refs.current[next]?.focus()
    onChange(options[next]!.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={["sc-segmented", className ?? ""].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const button = (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            aria-label={o.icon ? o.label : undefined}
            disabled={o.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            className="sc-segment"
            onClick={() => onChange(o.value)}
          >
            {o.icon ?? o.label}
          </button>
        )
        return o.icon ? (
          <Tooltip key={o.value} label={o.label}>
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}
