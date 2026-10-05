import { type ButtonHTMLAttributes, type CSSProperties, forwardRef } from "react"

export interface ColorSwatchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  /** Any CSS colour, or "transparent" (drawn as a checkerboard). */
  color: string
  /** Human colour name for the accessible label ("Red", not "#e03131"). */
  name: string
  selected?: boolean
  /** "toggle" announces aria-pressed; "radio" is for swatches inside a role=radiogroup. */
  mode?: "toggle" | "radio"
  /** "m" is a 40px tray cap, "s" a 28px palette chip. */
  size?: "m" | "s"
  /** A second colour shown as a dot on the chip: what the canvas paints when it differs from `color`. */
  drawn?: string
}

export const ColorSwatch = forwardRef<HTMLButtonElement, ColorSwatchProps>(function ColorSwatch(
  {
    color,
    name,
    selected = false,
    mode = "toggle",
    size = "s",
    drawn,
    className,
    type = "button",
    style,
    ...rest
  },
  ref,
) {
  const transparent = color === "transparent" || color === ""
  return (
    <button
      ref={ref}
      type={type}
      className={["sc-swatch", className ?? ""].filter(Boolean).join(" ")}
      aria-label={name}
      aria-pressed={mode === "toggle" ? selected : undefined}
      aria-checked={mode === "radio" ? selected : undefined}
      role={mode === "radio" ? "radio" : undefined}
      data-size={size}
      data-selected={selected || undefined}
      data-transparent={transparent || undefined}
      style={
        {
          ...style,
          "--swatch": transparent ? "transparent" : color,
          ...(drawn ? { "--swatch-drawn": drawn } : null),
        } as CSSProperties
      }
      {...rest}
    >
      <span className="sc-swatch-chip" aria-hidden="true">
        {drawn ? <span className="sc-swatch-drawn" /> : null}
      </span>
    </button>
  )
})
