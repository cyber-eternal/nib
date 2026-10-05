import type { Arrowhead, FillStyle, FontFamily, StrokeStyle, TextAlign, VerticalAlign } from "@nib/core"
import { FONT_STACKS } from "@nib/core"
import type { ReactNode } from "react"
import { StyleIcons, widthIcon } from "./icons"
import type { ArrowType, Edges } from "./model"

export const FILL_OPTIONS: readonly { value: FillStyle; label: string; icon: ReactNode }[] = [
  { value: "hachure", label: "Hachure", icon: StyleIcons.hachure },
  { value: "cross-hatch", label: "Cross-hatch", icon: StyleIcons.crossHatch },
  { value: "solid", label: "Solid", icon: StyleIcons.solid },
  { value: "zigzag", label: "Zigzag", icon: StyleIcons.zigzag },
]

export const WIDTH_OPTIONS = [
  { value: "1", label: "Thin", icon: widthIcon(1) },
  { value: "2", label: "Bold", icon: widthIcon(2.5) },
  { value: "4", label: "Extra bold", icon: widthIcon(4) },
] as const

export const STROKE_STYLE_OPTIONS: readonly { value: StrokeStyle; label: string; icon: ReactNode }[] = [
  { value: "solid", label: "Solid line", icon: StyleIcons.strokeSolid },
  { value: "dashed", label: "Dashed", icon: StyleIcons.strokeDashed },
  { value: "dotted", label: "Dotted", icon: StyleIcons.strokeDotted },
]

export const SLOPPINESS_OPTIONS = [
  { value: "0", label: "Architect", icon: StyleIcons.architect },
  { value: "1", label: "Artist", icon: StyleIcons.artist },
  { value: "2", label: "Cartoonist", icon: StyleIcons.cartoonist },
] as const

export const EDGE_OPTIONS: readonly { value: Edges; label: string; icon: ReactNode }[] = [
  { value: "sharp", label: "Sharp", icon: StyleIcons.sharp },
  { value: "round", label: "Round", icon: StyleIcons.round },
]

export const ARROW_TYPE_OPTIONS: readonly { value: ArrowType; label: string; icon: ReactNode }[] = [
  { value: "sharp", label: "Straight", icon: StyleIcons.arrowStraight },
  { value: "round", label: "Curved", icon: StyleIcons.arrowCurved },
  { value: "elbow", label: "Elbow", icon: StyleIcons.arrowElbow },
]

const sample = (family: FontFamily) => (
  <span className="sc-style-font" style={{ fontFamily: FONT_STACKS[family] }}>
    Aa
  </span>
)

export const FONT_OPTIONS: readonly { value: FontFamily; label: string; icon: ReactNode }[] = [
  { value: "hand", label: "Hand-drawn", icon: sample("hand") },
  { value: "normal", label: "Normal", icon: sample("normal") },
  { value: "code", label: "Code", icon: sample("code") },
  { value: "serif", label: "Serif", icon: sample("serif") },
  { value: "mono", label: "Mono", icon: sample("mono") },
]

export const FONT_SIZES = [
  { value: "16", label: "Small", icon: <span className="sc-style-size">S</span> },
  { value: "20", label: "Medium", icon: <span className="sc-style-size">M</span> },
  { value: "28", label: "Large", icon: <span className="sc-style-size">L</span> },
  { value: "36", label: "Extra large", icon: <span className="sc-style-size">XL</span> },
] as const

export const ALIGN_OPTIONS: readonly { value: TextAlign; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Align text left", icon: StyleIcons.textLeft },
  { value: "center", label: "Centre text", icon: StyleIcons.textCenter },
  { value: "right", label: "Align text right", icon: StyleIcons.textRight },
]

export const VALIGN_OPTIONS: readonly { value: VerticalAlign; label: string; icon: ReactNode }[] = [
  { value: "top", label: "Top", icon: StyleIcons.valignTop },
  { value: "middle", label: "Middle", icon: StyleIcons.valignMiddle },
  { value: "bottom", label: "Bottom", icon: StyleIcons.valignBottom },
]

export const ARROWHEAD_LABELS: Record<Arrowhead | "none", string> = {
  none: "None",
  arrow: "Arrow",
  bar: "Bar",
  dot: "Dot",
  circle: "Circle",
  circle_outline: "Circle outline",
  triangle: "Triangle",
  triangle_outline: "Triangle outline",
  diamond: "Diamond",
  diamond_outline: "Diamond outline",
  crowfoot_one: "Crow's foot, one",
  crowfoot_many: "Crow's foot, many",
  crowfoot_one_or_many: "Crow's foot, one or many",
}

/** No head first, then all twelve kinds the renderer draws, related shapes side by side. */
export const ARROWHEAD_OPTIONS: readonly (Arrowhead | null)[] = [
  null,
  "arrow",
  "triangle",
  "triangle_outline",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
]
