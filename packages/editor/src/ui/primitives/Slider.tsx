import { useEffect, useId, useRef } from "react"

export interface SliderProps {
  label: string
  /** null shows the mixed state. */
  value: number | null
  min?: number
  max?: number
  step?: number
  /** Live value while dragging or stepping; apply it without recording history. */
  onChange: (value: number) => void
  /** Once per gesture, before the first onChange (open a transaction here). */
  onStart?: () => void
  /** Once per gesture: on release, per keyboard step, or on blur mid-drag (commit one history step). */
  onCommit?: (value: number) => void
  format?: (value: number) => string
  hideLabel?: boolean
  disabled?: boolean
  className?: string
}

export const formatReadout = (value: number | null, format?: (v: number) => string): string =>
  value === null ? "Mixed" : format ? format(value) : String(Math.round(value * 100) / 100)

/** Range input with a tabular readout; a whole drag is one onStart … onCommit gesture. */
export const Slider = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onStart,
  onCommit,
  format,
  hideLabel,
  disabled,
  className,
}: SliderProps) => {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const gesture = useRef(false)
  const cb = useRef({ onChange, onStart, onCommit })
  cb.current = { onChange, onStart, onCommit }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // the native change event fires once on release (and once per keyboard step); React's onChange is per
    // input. A drag let go on its starting value fires no change, so the release itself ends it too, even
    // off the input.
    const end = () => {
      if (!gesture.current) return
      gesture.current = false
      cb.current.onCommit?.(Number(el.value))
    }
    el.addEventListener("change", end)
    el.addEventListener("blur", end)
    el.addEventListener("keyup", end)
    el.addEventListener("lostpointercapture", end)
    window.addEventListener("pointerup", end, true)
    window.addEventListener("pointercancel", end, true)
    return () => {
      el.removeEventListener("change", end)
      el.removeEventListener("blur", end)
      el.removeEventListener("keyup", end)
      el.removeEventListener("lostpointercapture", end)
      window.removeEventListener("pointerup", end, true)
      window.removeEventListener("pointercancel", end, true)
    }
  }, [])

  const readout = formatReadout(value, format)
  return (
    <div className={["sc-slider", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={hideLabel ? "sc-visually-hidden" : "sc-slider-label"}>
        {label}
      </label>
      <output htmlFor={id} className="sc-slider-readout" aria-hidden="true">
        {readout}
      </output>
      <input
        ref={ref}
        id={id}
        type="range"
        className="sc-slider-input"
        min={min}
        max={max}
        step={step}
        value={value ?? (min + max) / 2}
        aria-valuetext={readout}
        disabled={disabled}
        onChange={(e) => {
          if (!gesture.current) {
            gesture.current = true
            cb.current.onStart?.()
          }
          cb.current.onChange(Number(e.currentTarget.value))
        }}
      />
    </div>
  )
}
