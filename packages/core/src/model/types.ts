import type { Point } from "../math/vector"

export type FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag"
export type StrokeStyle = "solid" | "dashed" | "dotted"
export type Roughness = 0 | 1 | 2
export type Roundness = { type: 2 | 3; value?: number } | null
export type Theme = "light" | "dark"
export type TextAlign = "left" | "center" | "right"
export type VerticalAlign = "top" | "middle" | "bottom"

export type FontFamily = "hand" | "normal" | "code" | "serif" | "mono"

export type Arrowhead =
  | "arrow"
  | "bar"
  | "dot"
  | "circle"
  | "circle_outline"
  | "triangle"
  | "triangle_outline"
  | "diamond"
  | "diamond_outline"
  | "crowfoot_one"
  | "crowfoot_many"
  | "crowfoot_one_or_many"

export interface BoundElementRef {
  id: string
  type: "arrow" | "text"
}

export interface PointBinding {
  elementId: string
  /** -1..1 offset across the bound shape, keeps the arrow aimed at the same spot on resize. */
  focus: number
  gap: number
  fixedPoint?: Point | null
}

export interface ElementBase {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly angle: number
  readonly strokeColor: string
  readonly backgroundColor: string
  readonly fillStyle: FillStyle
  readonly strokeWidth: number
  readonly strokeStyle: StrokeStyle
  readonly roughness: Roughness
  readonly opacity: number
  readonly roundness: Roundness
  readonly seed: number
  readonly version: number
  readonly versionNonce: number
  readonly isDeleted: boolean
  readonly groupIds: readonly string[]
  readonly frameId: string | null
  readonly boundElements: readonly BoundElementRef[] | null
  readonly link: string | null
  readonly locked: boolean
  readonly index: string
  readonly updated: number
}

export interface RectangleElement extends ElementBase {
  readonly type: "rectangle"
}
export interface DiamondElement extends ElementBase {
  readonly type: "diamond"
}
export interface EllipseElement extends ElementBase {
  readonly type: "ellipse"
}
export interface FrameElement extends ElementBase {
  readonly type: "frame"
  readonly name: string | null
}
export interface EmbeddableElement extends ElementBase {
  readonly type: "embeddable"
}

export interface TextElement extends ElementBase {
  readonly type: "text"
  readonly text: string
  readonly originalText: string
  readonly fontSize: number
  readonly fontFamily: FontFamily
  readonly textAlign: TextAlign
  readonly verticalAlign: VerticalAlign
  readonly containerId: string | null
  readonly lineHeight: number
  readonly autoResize: boolean
}

export interface LinearElementBase extends ElementBase {
  /** Points are relative to x/y, the top-left of the unrotated box they span. */
  readonly points: readonly Point[]
  readonly lastCommittedPoint: Point | null
}

export interface LineElement extends LinearElementBase {
  readonly type: "line"
  readonly polygon: boolean
}

export interface ArrowElement extends LinearElementBase {
  readonly type: "arrow"
  readonly startBinding: PointBinding | null
  readonly endBinding: PointBinding | null
  readonly startArrowhead: Arrowhead | null
  readonly endArrowhead: Arrowhead | null
  readonly elbowed: boolean
}

export interface FreedrawElement extends ElementBase {
  readonly type: "freedraw"
  readonly points: readonly Point[]
  readonly pressures: readonly number[]
  readonly simulatePressure: boolean
  readonly lastCommittedPoint: Point | null
}

export interface ImageElement extends ElementBase {
  readonly type: "image"
  readonly fileId: string | null
  readonly status: "pending" | "saved" | "error"
  /** Sign flips mirror the image; magnitude is always 1. */
  readonly scale: readonly [number, number]
  readonly crop: ImageCrop | null
}

export interface ImageCrop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly naturalWidth: number
  readonly naturalHeight: number
}

export type NibElement =
  | RectangleElement
  | DiamondElement
  | EllipseElement
  | FrameElement
  | EmbeddableElement
  | TextElement
  | LineElement
  | ArrowElement
  | FreedrawElement
  | ImageElement

export type ElementType = NibElement["type"]
export type LinearElement = LineElement | ArrowElement

export type GenericElement = RectangleElement | DiamondElement | EllipseElement | EmbeddableElement

export const isLinearElement = (el: NibElement): el is LinearElement =>
  el.type === "line" || el.type === "arrow"
export const isArrowElement = (el: NibElement): el is ArrowElement => el.type === "arrow"
export const isTextElement = (el: NibElement): el is TextElement => el.type === "text"
export const isFreedrawElement = (el: NibElement): el is FreedrawElement => el.type === "freedraw"
export const isImageElement = (el: NibElement): el is ImageElement => el.type === "image"
export const isFrameElement = (el: NibElement): el is FrameElement => el.type === "frame"
export const isEmbeddableElement = (el: NibElement): el is EmbeddableElement => el.type === "embeddable"
export const isGenericElement = (el: NibElement): el is GenericElement =>
  el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse" || el.type === "embeddable"
/** A closed line (a pencil triangle, say) that behaves like a shape. */
export const isPolygonLine = (el: NibElement): el is LineElement => el.type === "line" && el.polygon === true
/** Shapes whose outline an arrow can bind to and whose interior can hold a label. */
export const isBindableElement = (el: NibElement): boolean =>
  el.type === "rectangle" ||
  el.type === "diamond" ||
  el.type === "ellipse" ||
  el.type === "image" ||
  el.type === "embeddable" ||
  el.type === "frame" ||
  el.type === "text" ||
  isPolygonLine(el)
export const canHaveLabel = (el: NibElement): boolean =>
  el.type === "rectangle" ||
  el.type === "diamond" ||
  el.type === "ellipse" ||
  el.type === "arrow" ||
  el.type === "embeddable" ||
  isPolygonLine(el)

export interface BinaryFile {
  readonly id: string
  readonly mimeType: string
  readonly dataURL: string
  readonly created: number
  readonly lastRetrieved?: number
}
export type BinaryFiles = Record<string, BinaryFile>

export type ToolType =
  | "selection"
  | "hand"
  | "lasso"
  | "rectangle"
  | "diamond"
  | "parallelogram"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "pencil"
  | "text"
  | "image"
  | "eraser"
  | "frame"
  | "embeddable"
  | "laser"

export interface Viewport {
  readonly scrollX: number
  readonly scrollY: number
  readonly zoom: number
}

export interface LaserTrail {
  readonly points: readonly { p: Point; t: number }[]
}

export interface AppState {
  readonly viewport: Viewport
  readonly activeTool: ToolType
  readonly toolLocked: boolean
  readonly selectedElementIds: Readonly<Record<string, true>>
  readonly selectedGroupIds: Readonly<Record<string, true>>
  readonly editingGroupId: string | null
  readonly editingTextId: string | null
  readonly editingLinearElementId: string | null
  /** Vertices selected in the line editor; cleared whenever editingLinearElementId changes. */
  readonly selectedPointIndices: readonly number[]
  readonly croppingElementId: string | null
  readonly viewBackgroundColor: string
  readonly gridSize: number | null
  readonly objectsSnapMode: boolean
  readonly theme: Theme
  readonly zenMode: boolean
  readonly viewMode: boolean
  readonly currentItemStrokeColor: string
  readonly currentItemBackgroundColor: string
  readonly currentItemFillStyle: FillStyle
  readonly currentItemStrokeWidth: number
  readonly currentItemStrokeStyle: StrokeStyle
  readonly currentItemRoughness: Roughness
  readonly currentItemOpacity: number
  readonly currentItemRoundness: "sharp" | "round"
  readonly currentItemFontFamily: FontFamily
  readonly currentItemFontSize: number
  readonly currentItemTextAlign: TextAlign
  readonly currentItemStartArrowhead: Arrowhead | null
  readonly currentItemEndArrowhead: Arrowhead | null
  readonly currentItemArrowType: "sharp" | "round" | "elbow"
  readonly name: string
}

export const DEFAULT_FONT_SIZE = 20
export const DEFAULT_LINE_HEIGHT = 1.25

export const DEFAULT_APP_STATE: AppState = {
  viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
  activeTool: "selection",
  toolLocked: false,
  selectedElementIds: {},
  selectedGroupIds: {},
  editingGroupId: null,
  editingTextId: null,
  editingLinearElementId: null,
  selectedPointIndices: [],
  croppingElementId: null,
  viewBackgroundColor: "#ffffff",
  gridSize: null,
  objectsSnapMode: false,
  theme: "light",
  zenMode: false,
  viewMode: false,
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: "solid",
  currentItemRoughness: 1,
  currentItemOpacity: 100,
  currentItemRoundness: "round",
  currentItemFontFamily: "hand",
  currentItemFontSize: DEFAULT_FONT_SIZE,
  currentItemTextAlign: "left",
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: "arrow",
  currentItemArrowType: "round",
  name: "Untitled",
}
