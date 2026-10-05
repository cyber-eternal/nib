import {
  type AppState,
  type Arrowhead,
  type EditorCore,
  type FillStyle,
  type FontFamily,
  type NibElement,
  type Roughness,
  type StrokeStyle,
  type TextAlign,
  type ToolType,
  type VerticalAlign,
  isBoundText,
  isPolygonLine,
  outermostGroupId,
} from "@nib/core"

/** A property whose selected elements disagree: no option is shown as active. */
export const MIXED: unique symbol = Symbol("mixed")
export type Mixed<T> = T | typeof MIXED

export const isMixed = <T>(v: Mixed<T>): v is typeof MIXED => v === MIXED

/** Mixed values become null, which the Segmented, Slider and swatch primitives read as "nothing active". */
export const orNull = <T>(v: Mixed<T>): T | null => (v === MIXED ? null : v)

/** The shared value, MIXED when the values disagree, or the fallback when there are none. */
export const common = <T>(
  values: readonly T[],
  fallback: T,
  eq: (a: T, b: T) => boolean = Object.is,
): Mixed<T> => {
  if (values.length === 0) return fallback
  const first = values[0]!
  for (let i = 1; i < values.length; i++) if (!eq(values[i]!, first)) return MIXED
  return first
}

export type StyleGroup =
  | "strokeColor"
  | "fill"
  | "stroke"
  | "edges"
  | "closed"
  | "arrow"
  | "text"
  | "opacity"
  | "arrange"
  | "more"

/** Bar order; separators fall between clusters. */
export const GROUP_ORDER: readonly StyleGroup[] = [
  "strokeColor",
  "fill",
  "stroke",
  "edges",
  "closed",
  "arrow",
  "text",
  "opacity",
  "arrange",
  "more",
]

export type ArrowType = AppState["currentItemArrowType"]
export type Edges = "sharp" | "round"

/** Tools whose bar shows nothing while the selection is empty (and Hand, Eraser and Laser never show it). */
const QUIET_TOOLS: ReadonlySet<ToolType> = new Set(["selection", "lasso", "image", "frame"])
const HIDING_TOOLS: ReadonlySet<ToolType> = new Set(["hand", "eraser", "laser"])

const STROKED: ReadonlySet<string> = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "embeddable",
  "line",
  "arrow",
  "freedraw",
  "text",
])
/** Elements the renderer draws a rough outline for: frames, images and text have none. */
const OUTLINED: ReadonlySet<string> = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "embeddable",
  "line",
  "arrow",
  "freedraw",
])
const CORNERED: ReadonlySet<string> = new Set(["rectangle", "diamond", "embeddable", "line"])

export const isStroked = (el: NibElement): boolean => STROKED.has(el.type)
export const isOutlined = (el: NibElement): boolean => OUTLINED.has(el.type)
/** Freehand ink has a width but no dash pattern or sloppiness. */
export const hasStrokeStyle = (el: NibElement): boolean => OUTLINED.has(el.type) && el.type !== "freedraw"
/** Background and fill style paint only inside closed outlines (open lines and arrows never fill). */
export const isFillable = (el: NibElement): boolean =>
  el.type === "rectangle" ||
  el.type === "diamond" ||
  el.type === "ellipse" ||
  el.type === "embeddable" ||
  isPolygonLine(el)
/**
 * Arrows take their corners from Arrow type, so Edges never touches them. A closed line always
 * draws as a straight-edged polygon, so Edges would change nothing there either.
 */
export const hasEdges = (el: NibElement): boolean => CORNERED.has(el.type) && !isPolygonLine(el)

export const arrowTypeOf = (el: NibElement): ArrowType | null =>
  el.type === "arrow" ? (el.elbowed ? "elbow" : el.roundness ? "round" : "sharp") : null

/** What a drawing tool's next element will use, for the bar shown before anything is drawn. */
interface ToolProfile {
  groups: readonly StyleGroup[]
  strokeStyle: boolean
}

const SHAPE_GROUPS: readonly StyleGroup[] = ["strokeColor", "fill", "stroke", "edges", "opacity"]

const TOOL_PROFILES: Partial<Record<ToolType, ToolProfile>> = {
  rectangle: { groups: SHAPE_GROUPS, strokeStyle: true },
  diamond: { groups: SHAPE_GROUPS, strokeStyle: true },
  embeddable: { groups: SHAPE_GROUPS, strokeStyle: true },
  ellipse: { groups: ["strokeColor", "fill", "stroke", "opacity"], strokeStyle: true },
  // a closed line always draws straight, so Edges would change nothing
  parallelogram: { groups: ["strokeColor", "fill", "stroke", "opacity"], strokeStyle: true },
  arrow: { groups: ["strokeColor", "stroke", "arrow", "opacity"], strokeStyle: true },
  line: { groups: ["strokeColor", "stroke", "edges", "opacity"], strokeStyle: true },
  freedraw: { groups: ["strokeColor", "stroke", "opacity"], strokeStyle: false },
  // corrected strokes become shapes in the current style, so the pencil shows the shape defaults
  pencil: { groups: SHAPE_GROUPS, strokeStyle: true },
  text: { groups: ["strokeColor", "text", "opacity"], strokeStyle: false },
}

export interface SelectionInput {
  /** The selection without labels (core.selectedElements()). Drives section visibility. */
  selected: readonly NibElement[]
  /** The selection with labels, which text styling reads and writes. */
  withText: readonly NibElement[]
  appState: AppState
  getElement: (id: string) => NibElement | undefined
}

/** Groups and their members count as one unit for align, distribute and group. */
export const selectionUnits = (selected: readonly NibElement[], editingGroupId: string | null): number => {
  const keys = new Set<string>()
  for (const el of selected) keys.add(outermostGroupId(el, editingGroupId) ?? el.id)
  return keys.size
}

/** Labels never count as elements of their own; an edited label alone still counts. */
export const withoutBoundText = (els: readonly NibElement[]): NibElement[] => {
  const free = els.filter((e) => !isBoundText(e))
  return free.length > 0 ? free : [...els]
}

/** Texts sitting in a shape (not on an arrow), where vertical alignment means something. */
const inBoxContainer = (text: NibElement, getElement: SelectionInput["getElement"]): boolean => {
  if (text.type !== "text" || !text.containerId) return false
  const host = getElement(text.containerId)
  return !!host && !host.isDeleted && host.type !== "arrow"
}

export const groupsForSelection = (input: SelectionInput): StyleGroup[] => {
  const sel = withoutBoundText(input.selected)
  if (sel.length === 0) return []
  const out = new Set<StyleGroup>()
  if (sel.some(isStroked)) out.add("strokeColor")
  if (sel.some(isFillable)) out.add("fill")
  if (sel.some(isOutlined)) out.add("stroke")
  if (sel.some(hasEdges)) out.add("edges")
  if (sel.some((e) => e.type === "line")) out.add("closed")
  if (sel.some((e) => e.type === "arrow")) out.add("arrow")
  if (input.withText.some((e) => e.type === "text")) out.add("text")
  out.add("opacity")
  out.add("arrange")
  out.add("more")
  return GROUP_ORDER.filter((g) => out.has(g))
}

export const groupsForTool = (tool: ToolType): StyleGroup[] => [...(TOOL_PROFILES[tool]?.groups ?? [])]

export interface ArrangeModel {
  count: number
  units: number
  canAlign: boolean
  canDistribute: boolean
  canGroup: boolean
  canUngroup: boolean
  locked: Mixed<boolean>
  /** The one element selected, for single-element actions such as unlock. */
  singleId: string | null
  hasLinear: boolean
  hasLink: boolean
}

export interface TextActions {
  canBind: boolean
  canUnbind: boolean
  canWrap: boolean
}

export interface StyleModel {
  source: "selection" | "tool"
  groups: readonly StyleGroup[]
  /** A text editor is open: chrome clicks must leave its focus alone. */
  editingText: boolean
  strokeColor: Mixed<string>
  backgroundColor: Mixed<string>
  fillStyle: Mixed<FillStyle>
  /** False when every fillable element is transparent; the row stays, disabled. */
  fillEnabled: boolean
  strokeWidth: Mixed<number>
  strokeStyle: Mixed<StrokeStyle>
  roughness: Mixed<Roughness>
  /** Dash pattern and sloppiness apply (not for freehand ink alone). */
  showStrokeStyle: boolean
  edges: Mixed<Edges>
  closed: Mixed<boolean>
  /** A line needs three points to close. */
  canClose: boolean
  arrowType: Mixed<ArrowType>
  startArrowhead: Mixed<Arrowhead | null>
  endArrowhead: Mixed<Arrowhead | null>
  fontFamily: Mixed<FontFamily>
  fontSize: Mixed<number>
  textAlign: Mixed<TextAlign>
  verticalAlign: Mixed<VerticalAlign>
  showVerticalAlign: boolean
  opacity: Mixed<number>
  arrange: ArrangeModel
  text: TextActions
}

const NO_ARRANGE: ArrangeModel = {
  count: 0,
  units: 0,
  canAlign: false,
  canDistribute: false,
  canGroup: false,
  canUngroup: false,
  locked: false,
  singleId: null,
  hasLinear: false,
  hasLink: false,
}

const NO_TEXT_ACTIONS: TextActions = { canBind: false, canUnbind: false, canWrap: false }

const edgesOf = (el: NibElement): Edges => (el.roundness ? "round" : "sharp")

/** The bar's content for a selection; empty groups mean the bar hides. */
export const modelForSelection = (input: SelectionInput, text: TextActions = NO_TEXT_ACTIONS): StyleModel => {
  const a = input.appState
  const sel = withoutBoundText(input.selected)
  const texts = input.withText.filter((e) => e.type === "text")
  const stroked = sel.filter(isStroked)
  const fillable = sel.filter(isFillable)
  const outlined = sel.filter(isOutlined)
  const styled = outlined.filter(hasStrokeStyle)
  const cornered = sel.filter(hasEdges)
  const lines = sel.filter((e) => e.type === "line")
  const arrows = sel.filter((e) => e.type === "arrow")
  const units = selectionUnits(sel, a.editingGroupId)

  return {
    source: "selection",
    groups: groupsForSelection(input),
    editingText: a.editingTextId !== null,
    strokeColor: common(
      stroked.map((e) => e.strokeColor.toLowerCase()),
      a.currentItemStrokeColor,
    ),
    backgroundColor: common(
      fillable.map((e) => e.backgroundColor.toLowerCase()),
      a.currentItemBackgroundColor,
    ),
    fillStyle: common(
      fillable.map((e) => e.fillStyle),
      a.currentItemFillStyle,
    ),
    fillEnabled: fillable.length === 0 || fillable.some((e) => e.backgroundColor !== "transparent"),
    strokeWidth: common(
      outlined.map((e) => e.strokeWidth),
      a.currentItemStrokeWidth,
    ),
    strokeStyle: common(
      styled.map((e) => e.strokeStyle),
      a.currentItemStrokeStyle,
    ),
    roughness: common(
      styled.map((e) => e.roughness),
      a.currentItemRoughness,
    ),
    showStrokeStyle: styled.length > 0,
    edges: common(cornered.map(edgesOf), a.currentItemRoundness),
    closed: common(
      lines.map((e) => isPolygonLine(e)),
      false,
    ),
    canClose: lines.some((e) => e.type === "line" && e.points.length >= 3),
    arrowType: common(
      arrows.map((e) => arrowTypeOf(e)!),
      a.currentItemArrowType,
    ),
    startArrowhead: common(
      arrows.map((e) => (e.type === "arrow" ? e.startArrowhead : null)),
      a.currentItemStartArrowhead,
    ),
    endArrowhead: common(
      arrows.map((e) => (e.type === "arrow" ? e.endArrowhead : null)),
      a.currentItemEndArrowhead,
    ),
    fontFamily: common(
      texts.map((e) => (e.type === "text" ? e.fontFamily : a.currentItemFontFamily)),
      a.currentItemFontFamily,
    ),
    fontSize: common(
      texts.map((e) => (e.type === "text" ? e.fontSize : a.currentItemFontSize)),
      a.currentItemFontSize,
    ),
    textAlign: common(
      texts.map((e) => (e.type === "text" ? e.textAlign : a.currentItemTextAlign)),
      a.currentItemTextAlign,
    ),
    verticalAlign: common(
      texts
        .filter((t) => inBoxContainer(t, input.getElement))
        .map((e) => (e.type === "text" ? e.verticalAlign : "middle")),
      "middle" as VerticalAlign,
    ),
    showVerticalAlign: texts.some((t) => inBoxContainer(t, input.getElement)),
    opacity: common(
      sel.map((e) => e.opacity),
      a.currentItemOpacity,
    ),
    arrange: {
      count: sel.length,
      units,
      canAlign: units >= 2,
      canDistribute: units >= 3,
      canGroup: units >= 2,
      canUngroup: sel.some((e) => outermostGroupId(e, a.editingGroupId) !== null),
      locked: common(
        sel.map((e) => e.locked),
        false,
      ),
      singleId: sel.length === 1 ? sel[0]!.id : null,
      hasLinear: sel.some((e) => e.type === "line" || e.type === "arrow"),
      hasLink: sel.some((e) => !!e.link),
    },
    text,
  }
}

/** The bar's content before anything is drawn: the tool's defaults for the next element. */
export const modelForTool = (tool: ToolType, a: AppState): StyleModel => {
  const profile = TOOL_PROFILES[tool]
  return {
    source: "tool",
    groups: profile ? [...profile.groups] : [],
    editingText: a.editingTextId !== null,
    strokeColor: a.currentItemStrokeColor,
    backgroundColor: a.currentItemBackgroundColor,
    fillStyle: a.currentItemFillStyle,
    fillEnabled: a.currentItemBackgroundColor !== "transparent",
    strokeWidth: a.currentItemStrokeWidth,
    strokeStyle: a.currentItemStrokeStyle,
    roughness: a.currentItemRoughness,
    showStrokeStyle: profile?.strokeStyle ?? false,
    edges: a.currentItemRoundness,
    closed: false,
    canClose: false,
    arrowType: a.currentItemArrowType,
    startArrowhead: a.currentItemStartArrowhead,
    endArrowhead: a.currentItemEndArrowhead,
    fontFamily: a.currentItemFontFamily,
    fontSize: a.currentItemFontSize,
    textAlign: a.currentItemTextAlign,
    verticalAlign: "middle",
    showVerticalAlign: false,
    opacity: a.currentItemOpacity,
    arrange: NO_ARRANGE,
    text: NO_TEXT_ACTIONS,
  }
}

/** What the style bar shows for the core right now, or null when it should be hidden. */
export const styleModel = (core: EditorCore): StyleModel | null => {
  const a = core.appState
  if (a.viewMode || HIDING_TOOLS.has(a.activeTool)) return null
  const selected = core.selectedElements()
  if (selected.length > 0) {
    const model = modelForSelection(
      {
        selected,
        withText: core.selectedElements({ includeBoundText: true }),
        appState: a,
        getElement: (id) => core.scene.get(id),
      },
      { canBind: core.canBindText(), canUnbind: core.canUnbindText(), canWrap: core.canWrapText() },
    )
    return model.groups.length > 0 ? model : null
  }
  if (QUIET_TOOLS.has(a.activeTool)) return null
  const model = modelForTool(a.activeTool, a)
  return model.groups.length > 0 ? model : null
}

/** Structural equality for models, so the bar re-renders only when what it shows changes. */
export const sameModel = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka)
    if (!sameModel((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}

export const GROUP_LABELS: Record<StyleGroup, string> = {
  strokeColor: "Stroke colour",
  fill: "Fill",
  stroke: "Stroke",
  edges: "Edges",
  closed: "Closed shape",
  arrow: "Arrow",
  text: "Text",
  opacity: "Opacity",
  arrange: "Arrange",
  more: "More actions",
}
