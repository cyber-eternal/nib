import {
  DEFAULT_APP_STATE,
  type EditorCore,
  SHORTCUTS,
  type Theme,
  type ToolType,
  parseColor,
  rgbToHsl,
  storedColorFor,
  themeColor,
} from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"
import { type ThemeDef, themes } from "../../theme/themes"
import type { IconName } from "../Icons"
import { applyStyle } from "../style/apply"

export interface MarkerDef {
  tool: ToolType
  icon: IconName
  /** Row in core SHORTCUTS that names the tool and lists its keys; absent when the tool has none. */
  shortcutId?: string
  /** Overrides the SHORTCUTS label where the tray needs a clearer name. */
  label?: string
}

const marker = (tool: ToolType, icon: IconName, shortcutId?: string, label?: string): MarkerDef => ({
  tool,
  icon,
  shortcutId,
  label,
})

/** Tray groups, left to right, split by seams (brief: Layout, the marker tray). */
export const TRAY_GROUPS: readonly (readonly MarkerDef[])[] = [
  [marker("selection", "selection", "tool.selection"), marker("hand", "hand", "tool.hand")],
  [
    marker("rectangle", "rectangle", "tool.rectangle"),
    marker("diamond", "diamond", "tool.diamond"),
    marker("parallelogram", "parallelogram", "tool.parallelogram"),
    marker("ellipse", "ellipse", "tool.ellipse"),
    marker("arrow", "arrow", "tool.arrow"),
    marker("line", "line", "tool.line"),
    marker("freedraw", "pen", "tool.pen"),
    marker("pencil", "pencil", "tool.pencil", "Pencil, snaps shapes"),
    marker("text", "text", "tool.text"),
    marker("eraser", "eraser", "tool.eraser"),
  ],
]

/** Narrow trays scroll, so the pencil, the tool that tidies shapes, comes before the raw pen. */
export const trayGroups = (narrow: boolean): readonly (readonly MarkerDef[])[] =>
  narrow
    ? TRAY_GROUPS.map((group) => {
        const pen = group.findIndex((m) => m.tool === "freedraw")
        const pencil = group.findIndex((m) => m.tool === "pencil")
        if (pen < 0 || pencil < 0) return group
        const next = [...group]
        next[pen] = group[pencil]!
        next[pencil] = group[pen]!
        return next
      })
    : TRAY_GROUPS

/** What view mode still allows (core VIEW_MODE_TOOLS); the presenter keeps the laser in reach. */
export const VIEW_MODE_MARKERS: readonly MarkerDef[] = [
  marker("selection", "selection", "tool.selection"),
  marker("hand", "hand", "tool.hand"),
  marker("laser", "laser", "tool.laser"),
]

export type DrawerItem =
  | { kind: "tool"; id: string; def: MarkerDef; name: string }
  | { kind: "action"; id: "mermaid"; icon: IconName; name: string; label: string }
  | { kind: "lock"; id: "lock"; name: string; label: string }

/** The More drawer, in reading order (brief: item 3 of the tray). */
export const DRAWER_ITEMS: readonly DrawerItem[] = [
  { kind: "tool", id: "image", def: marker("image", "image", "tool.image"), name: "Image" },
  { kind: "tool", id: "frame", def: marker("frame", "frame", "tool.frame"), name: "Frame" },
  {
    kind: "tool",
    id: "embeddable",
    def: marker("embeddable", "embed", "tool.embed", "Embed"),
    name: "Embed",
  },
  { kind: "tool", id: "laser", def: marker("laser", "laser", "tool.laser"), name: "Laser" },
  { kind: "tool", id: "lasso", def: marker("lasso", "lasso", "tool.lasso"), name: "Lasso" },
  { kind: "action", id: "mermaid", icon: "mermaid", name: "Mermaid", label: "Mermaid to diagram" },
  { kind: "lock", id: "lock", name: "Keep tool", label: "Keep tool active" },
]

export const DRAWER_COLUMNS = 4

export const TRAY_TOOLS: readonly ToolType[] = TRAY_GROUPS.flat().map((m) => m.tool)
export const DRAWER_TOOLS: readonly ToolType[] = DRAWER_ITEMS.flatMap((i) =>
  i.kind === "tool" ? [i.def.tool] : [],
)

export const isDrawerTool = (tool: ToolType): boolean => DRAWER_TOOLS.includes(tool)

export const isFreehandTool = (tool: ToolType): boolean => tool === "freedraw" || tool === "pencil"

const shortcutRow = (id: string | undefined) => (id ? SHORTCUTS.find((s) => s.id === id) : undefined)

/** Every key that arms the marker's tool, as core SHORTCUTS lists them (letters before numerals there). */
export const markerKeys = (def: MarkerDef): readonly string[] => shortcutRow(def.shortcutId)?.keys ?? []

/** The key a label shows: the first one SHORTCUTS lists ("R" for Rectangle, "7" for the pen). */
export const markerKey = (def: MarkerDef): string | undefined => markerKeys(def)[0]

export const markerName = (def: MarkerDef): string =>
  def.label ?? shortcutRow(def.shortcutId)?.label ?? def.tool

/** The lifted marker's label text, such as "Rectangle · R". */
export const liftLabel = (def: MarkerDef): string => {
  const key = markerKey(def)
  return key ? `${markerName(def)} · ${key}` : markerName(def)
}

/** Space-separated aria-keyshortcuts for single-key chords (tool keys never carry modifiers). */
export const ariaKeys = (def: MarkerDef): string | undefined => {
  const keys = markerKeys(def)
  return keys.length > 0 ? keys.join(" ") : undefined
}

/** Arrow, Home and End inside a grid of `count` cells laid out `cols` wide; no wrapping across edges. */
export const gridMove = (index: number, key: string, cols: number, count: number): number => {
  if (count <= 0) return -1
  const i = Math.min(Math.max(index, 0), count - 1)
  switch (key) {
    case "ArrowRight":
      return Math.min(i + 1, count - 1)
    case "ArrowLeft":
      return Math.max(i - 1, 0)
    case "ArrowDown":
      return i + cols < count ? i + cols : i
    case "ArrowUp":
      return i - cols >= 0 ? i - cols : i
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return i
  }
}

export const isGridKey = (key: string): boolean =>
  key === "ArrowRight" ||
  key === "ArrowLeft" ||
  key === "ArrowDown" ||
  key === "ArrowUp" ||
  key === "Home" ||
  key === "End"

/** The theme whose caps these are, so a dark board can be found from the caps the shell passes. */
export const themeForCaps = (caps: readonly string[]): ThemeDef | undefined => {
  const want = caps.map((c) => c.toLowerCase()).join()
  return themes.find((t) => t.caps.map((c) => c.toLowerCase()).join() === want)
}

const channelDistance = (a: string, b: string): number => {
  const x = parseColor(a)
  const y = parseColor(b)
  return x && y ? Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) : Number.POSITIVE_INFINITY
}

/** Caps are display colours; dark boards store them as their light originals so the remap shows the cap. */
export const capStroke = (cap: string, mode: Theme, board?: string): string =>
  (mode === "dark" ? storedColorFor(cap, "dark", board) : cap).toLowerCase()

/** A one-step style patch for a cap: the selection takes it, or the next element when nothing is selected. */
export const capStrokePatch = (cap: string, mode: Theme, board?: string): { strokeColor: string } => ({
  strokeColor: capStroke(cap, mode, board),
})

const DEFAULT_STROKE = DEFAULT_APP_STATE.currentItemStrokeColor.toLowerCase()

/**
 * Index of the cap that shows as the stored stroke `stroke`, or -1 (custom colour or a mixed selection).
 * Core's default black is the ink every theme puts on its first cap, so it rings that cap.
 */
export const capIndexFor = (
  stroke: string | null,
  caps: readonly string[],
  mode: Theme,
  board?: string,
): number => {
  if (!stroke) return -1
  const s = stroke.trim().toLowerCase()
  const exact = caps.findIndex((cap) => capStroke(cap, mode, board) === s)
  if (exact >= 0) return exact
  // the dark remap does not round-trip every hex exactly; a near-identical display colour is the same cap
  const shown = themeColor(s, mode, board)
  let best = -1
  let bestDistance = 25
  caps.forEach((cap, i) => {
    const d = channelDistance(shown, cap)
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  })
  if (best >= 0) return best
  return s === DEFAULT_STROKE && caps.length > 0 ? 0 : -1
}

/** "#abc", "abc", "#aabbcc" or "aabbcc" as lowercase "#rrggbb"; null for anything else. */
export const normalizeHex = (input: string): string | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  let h = m[1]!.toLowerCase()
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  return `#${h}`
}

const HUES: readonly [number, string][] = [
  [15, "Red"],
  [42, "Orange"],
  [68, "Yellow"],
  [160, "Green"],
  [195, "Teal"],
  [255, "Blue"],
  [290, "Violet"],
  [330, "Purple"],
  [350, "Pink"],
  [360, "Red"],
]

/** A spoken colour name for swatch labels ("Dark blue", not "#1f3a5f"). */
export const colorName = (color: string): string => {
  if (color === "transparent") return "Transparent"
  const c = parseColor(color)
  if (!c) return color
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b)
  // HSL saturation runs high for faint tints near white and black, so judge those by chroma
  const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255
  if (l <= 0.13 || (l <= 0.2 && chroma < 0.08)) return "Black"
  if (l >= 0.97 || (l >= 0.88 && chroma < 0.1)) return "White"
  if (s < 0.14) return l < 0.4 ? "Dark grey" : l < 0.72 ? "Grey" : "Light grey"
  const deg = h * 360
  const hue = HUES.find(([limit]) => deg < limit)?.[1] ?? "Red"
  if (hue === "Orange" && l < 0.36) return "Brown"
  if (l >= 0.72) return `Light ${hue.toLowerCase()}`
  if (l <= 0.3) return `Dark ${hue.toLowerCase()}`
  return hue
}

/** The theme's own names for its caps; any cap that is not the theme's is named from its colour. */
export const capNames = (caps: readonly string[], theme?: Pick<ThemeDef, "caps" | "capNames">): string[] =>
  caps.map((cap, i) =>
    theme && theme.caps[i]?.toLowerCase() === cap.toLowerCase() ? theme.capNames[i]! : colorName(cap),
  )

export interface TraySnapshot {
  tool: ToolType
  locked: boolean
  viewMode: boolean
  /** The stroke the caps reflect: the selection's shared colour, null when it is mixed, else the default. */
  stroke: string | null
  hasSelection: boolean
  mode: Theme
  /** The pencil in hand came from the Pen marker (its remembered "Correct shapes"), so the Pen is held. */
  penHolds: boolean
}

/** O(selection), not O(scene): this runs on every core emit, including pointer frames. */
export const selectionStroke = (core: EditorCore): { stroke: string | null; hasSelection: boolean } => {
  const ids = Object.keys(core.appState.selectedElementIds)
  let stroke: string | undefined
  let count = 0
  for (const id of ids) {
    const el = core.scene.get(id)
    if (!el || el.isDeleted) continue
    if (el.type === "text" && el.containerId) continue
    count++
    const c = el.strokeColor.toLowerCase()
    if (stroke === undefined) stroke = c
    else if (stroke !== c) return { stroke: null, hasSelection: true }
  }
  if (count === 0) return { stroke: core.appState.currentItemStrokeColor.toLowerCase(), hasSelection: false }
  return { stroke: stroke ?? null, hasSelection: true }
}

export const traySnapshot = (core: EditorCore): TraySnapshot => {
  const a = core.appState
  const { stroke, hasSelection } = selectionStroke(core)
  return {
    tool: a.activeTool,
    locked: a.toolLocked,
    viewMode: a.viewMode,
    stroke,
    hasSelection,
    mode: a.theme,
    penHolds: penHoldsPencil(core),
  }
}

export const snapshotKey = (s: TraySnapshot): string =>
  `${s.tool}|${s.locked}|${s.viewMode}|${s.stroke ?? "~"}|${s.hasSelection}|${s.mode}|${s.penHolds}`

/** Remembers the pen's "Correct shapes" switch: "true" means the pencil is the freehand marker of choice. */
export const PENCIL_PREF_KEY = "nib.pencilDefault"

export const readPencilDefault = (prefs: PlatformPrefs): boolean => {
  try {
    return prefs.get(PENCIL_PREF_KEY) === "true"
  } catch {
    return false
  }
}

export const writePencilDefault = (prefs: PlatformPrefs, on: boolean): void => {
  try {
    prefs.set(PENCIL_PREF_KEY, on ? "true" : "false")
  } catch {
    // a full or blocked store only loses the remembered choice
  }
}

/** The freehand tool the user last chose with the switch, for hosts that offer one generic "Draw". */
export const preferredFreehandTool = (prefs: PlatformPrefs): "pencil" | "freedraw" =>
  readPencilDefault(prefs) ? "pencil" : "freedraw"

/** The tool the "Correct shapes" switch leads to. */
export const correctionTool = (on: boolean): "pencil" | "freedraw" => (on ? "pencil" : "freedraw")

interface PenHold {
  pen: boolean
}

const penHolds = new WeakMap<EditorCore, PenHold>()

// any route away from the pencil ends the Pen's hold, including ones the shell never sees
const penHoldOf = (core: EditorCore): PenHold => {
  let hold = penHolds.get(core)
  if (!hold) {
    const h: PenHold = { pen: false }
    core.subscribe(() => {
      if (core.appState.activeTool !== "pencil") h.pen = false
    })
    penHolds.set(core, h)
    hold = h
  }
  return hold
}

/** Whether the pencil in hand was armed from the Pen marker, which then shows as the held marker. */
export const penHoldsPencil = (core: EditorCore): boolean =>
  core.appState.activeTool === "pencil" && (penHolds.get(core)?.pen ?? false)

/** Arms the freehand tool `tool`; `fromPen` says the Pen marker (or 7) asked for it. */
export const armFreehand = (core: EditorCore, tool: "pencil" | "freedraw", fromPen: boolean): void => {
  const hold = penHoldOf(core)
  // set before setTool, whose emit is what the tray re-reads
  hold.pen = fromPen && tool === "pencil"
  core.setTool(tool)
  if (core.appState.activeTool !== "pencil") hold.pen = false
}

/** The Pen marker and 7: the pen as the user left it, the pencil when "Correct shapes" was left on. */
export const armPen = (core: EditorCore, prefs: PlatformPrefs): void =>
  armFreehand(core, preferredFreehandTool(prefs), true)

/** The Pencil marker and P. */
export const armPencil = (core: EditorCore): void => armFreehand(core, "pencil", false)

/** The marker that shows as held: the Pen also holds a pencil it armed itself. */
export const markerHeld = (m: MarkerDef, snap: Pick<TraySnapshot, "tool" | "penHolds">): boolean => {
  if (m.tool === "freedraw") return snap.tool === "freedraw" || (snap.tool === "pencil" && snap.penHolds)
  if (m.tool === "pencil") return snap.tool === "pencil" && !snap.penHolds
  return snap.tool === m.tool
}

/** Image opens the picker through core (host.onRequestImage); the prop is the fallback for hosts without one. */
export const pickImage = (core: EditorCore, fallback: () => void): void => {
  core.setTool("image")
  if (!core.host.onRequestImage && core.appState.activeTool === "image") fallback()
}

/** Sets the stroke colour as one undo step, only on selected elements that draw a stroke. */
export const applyStroke = (core: EditorCore, strokeColor: string): void => {
  applyStyle(core, { strokeColor })
}

/**
 * Where the tray sits: "side" centres it between the ledge end and the help button, "centre" on the
 * window's centre line (wide windows), "stacked" across the full width with both raised above it.
 */
export type TrayLayout = "side" | "centre" | "stacked"

/** From this width the tray keeps the true centre line, when it fits there with every cap showing. */
export const WIDE_TRAY_MIN = 1400

export interface FitInput {
  /** The tray's width as measured, borders included and any scrolled-away markers counted. */
  content: number
  /** Whether the caps are collapsed in the measured tray. */
  collapsed: boolean
  /** Width of one cap cell. */
  capCell: number
  /** Caps the collapsed tray hides. */
  capCount: number
  /** Below the narrow breakpoint the caps always collapse. */
  narrow: boolean
  /** The window's width. */
  viewport: number
  /** Measured widths of the ledge end (bottom-left) and the help corner (bottom-right). */
  ledge: number
  corner: number
  /** --chrome-gap: between the window edge and the chrome, and between neighbouring chrome. */
  gap: number
}

export interface TrayFit {
  layout: TrayLayout
  /** Show only the current cap. */
  collapse: boolean
  /** The markers still do not fit: they scroll, with snap. */
  scroll: boolean
}

/**
 * Lays the tray out from one measurement in either cap state: beside the ledge end when the whole
 * tray fits there, else stacked under it. The caps collapse only when even the full width is too
 * narrow, so no window between the narrow breakpoint and a wide one loses them.
 */
export const trayFit = (m: FitInput): TrayFit => {
  const hidden = m.capCount * m.capCell
  const full = m.collapsed ? m.content + hidden : m.content
  const compact = m.collapsed ? m.content : m.content - hidden
  const fits = (width: number, avail: number) => width <= avail + 0.5
  if (!m.narrow) {
    const centre = m.viewport - 2 * Math.max(m.ledge, m.corner) - 4 * m.gap
    if (m.viewport >= WIDE_TRAY_MIN && fits(full, centre))
      return { layout: "centre", collapse: false, scroll: false }
    if (fits(full, m.viewport - m.ledge - m.corner - 4 * m.gap))
      return { layout: "side", collapse: false, scroll: false }
  }
  const avail = m.viewport - 2 * m.gap
  const collapse = m.narrow || !fits(full, avail)
  return { layout: "stacked", collapse, scroll: !fits(collapse ? compact : full, avail) }
}
