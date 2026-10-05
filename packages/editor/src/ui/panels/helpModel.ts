import { SHORTCUTS, type Shortcut, type ShortcutGroup } from "@nib/core"
import { formatChord, parseChord } from "../../hooks/useShortcuts"

export type HelpGroupId = ShortcutGroup | "gestures"

export interface HelpRow {
  id: string
  label: string
  /** Chord specs from the shortcut table, or modifier names ("Shift", "Alt", "Mod") for gestures. */
  keys: readonly string[]
  note?: string
}

export interface HelpGroup {
  id: HelpGroupId
  title: string
  rows: HelpRow[]
}

export const HELP_GROUP_TITLES: Readonly<Record<HelpGroupId, string>> = {
  tools: "Tools",
  edit: "Editing",
  arrange: "Arrange",
  view: "View",
  file: "File",
  help: "Find and help",
  gestures: "While you drag",
}

const GROUP_ORDER: readonly HelpGroupId[] = ["tools", "edit", "arrange", "view", "file", "help", "gestures"]

const NOTES: Readonly<Record<string, string>> = {
  "tool.parallelogram": "Flowchart input and output",
  "tool.pen": "Raw freehand",
  "tool.pencil": "Freehand that turns into clean shapes",
  "tool.image": "Opens the file picker",
  "tool.laser": "Points without drawing",
  "view.pan": "Hold, then drag",
  "edit.enter": "On a shape, arrow or text",
  "edit.points": "On a line or arrow",
  "flow.addNode": "From the selected shape",
  "edit.nudge": "Moves the selection",
  "style.eyedropper": "Click the canvas to pick",
}

/** Modifier gestures: not keyboard shortcuts, so they live here rather than in the core table. */
export const GESTURE_ROWS: readonly HelpRow[] = [
  {
    id: "gesture.proportions",
    label: "Keep proportions",
    keys: ["Shift"],
    note: "While drawing or resizing",
  },
  { id: "gesture.centre", label: "Draw or resize from the centre", keys: ["Alt"], note: "While dragging" },
  { id: "gesture.rotate", label: "Rotate in 15° steps", keys: ["Shift"], note: "While rotating" },
  { id: "gesture.duplicate", label: "Duplicate the selection", keys: ["Alt"], note: "While dragging it" },
  { id: "gesture.addSelect", label: "Add to the selection", keys: ["Shift"], note: "Click or drag a box" },
  { id: "gesture.noBind", label: "Leave an arrow unattached", keys: ["Mod"], note: "While drawing it" },
  {
    id: "gesture.deletePoint",
    label: "Delete a line point",
    keys: ["Alt"],
    note: "Click it while editing points",
  },
  { id: "gesture.restore", label: "Restore while erasing", keys: ["Alt"], note: "Drag back over it" },
  {
    id: "gesture.rawPencil",
    label: "Keep a pencil stroke as drawn",
    keys: ["Alt"],
    note: "As you lift the pencil",
  },
  { id: "gesture.zoom", label: "Zoom", keys: ["Mod"], note: "Scroll, or pinch the trackpad" },
]

/** The help sheet, generated from the one shortcut table so it never drifts from what the keys do. */
export const buildHelpGroups = (table: readonly Shortcut[] = SHORTCUTS): HelpGroup[] => {
  const groups = new Map<HelpGroupId, HelpRow[]>()
  for (const s of table) {
    const rows = groups.get(s.group) ?? []
    rows.push({ id: s.id, label: s.label, keys: s.keys, note: NOTES[s.id] })
    groups.set(s.group, rows)
  }
  groups.set("gestures", [...GESTURE_ROWS])
  return GROUP_ORDER.filter((id) => groups.has(id)).map((id) => ({
    id,
    title: HELP_GROUP_TITLES[id],
    rows: groups.get(id)!,
  }))
}

const MODIFIER_LABELS: Readonly<Record<string, readonly [mac: string, other: string]>> = {
  Shift: ["⇧", "Shift"],
  Alt: ["⌥", "Alt"],
  Mod: ["⌘", "Ctrl"],
  Ctrl: ["⌃", "Ctrl"],
}

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const
const ARROW_LABELS: Readonly<Record<(typeof ARROWS)[number], readonly [mac: string, other: string]>> = {
  ArrowUp: ["↑", "Up"],
  ArrowDown: ["↓", "Down"],
  ArrowLeft: ["←", "Left"],
  ArrowRight: ["→", "Right"],
}

const arrowOf = (spec: string): { prefix: string; arrow: (typeof ARROWS)[number] } | null => {
  for (const a of ARROWS) if (spec.endsWith(a)) return { prefix: spec.slice(0, -a.length), arrow: a }
  return null
}

/** Display strings for a row's keys; all four arrows with the same modifiers collapse into one. */
export const displayKeys = (keys: readonly string[], isMac: boolean): string[] => {
  const modifier = keys.length === 1 ? MODIFIER_LABELS[keys[0]!] : undefined
  if (modifier) return [isMac ? modifier[0] : modifier[1]]
  const arrows = keys.map(arrowOf)
  if (
    keys.length === 4 &&
    arrows.every((a) => a && a.prefix === arrows[0]!.prefix) &&
    new Set(arrows.map((a) => a!.arrow)).size === 4
  ) {
    const sample = formatChord(keys[0]!, isMac)
    const label = ARROW_LABELS[arrows[0]!.arrow][isMac ? 0 : 1]
    const prefix = sample.slice(0, sample.length - label.length)
    return [isMac ? `${prefix} Arrows`.trim() : `${prefix}Arrows`]
  }
  return keys.map((k) => formatChord(k, isMac))
}

const wordStarts = (text: string, q: string): boolean =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((w) => w.startsWith(q))

/** The character a chord spec ends on ("Mod+Shift+Z" -> "z"); null for named keys such as Enter. */
const finalChar = (spec: string): string | null => parseChord(spec)?.char ?? null

/**
 * How a one-character query meets a row's keys: 0 when a key is exactly that ("Z"), 1 when a chord
 * ends on it ("⌘Z"), null when neither.
 */
const keyRank = (row: HelpRow, q: string, isMac: boolean): 0 | 1 | null => {
  const keys = displayKeys(row.keys, isMac).map((k) => k.toLocaleLowerCase())
  if (keys.some((k) => k === q || k.replace(/\+/g, "") === q.replace(/\+/g, ""))) return 0
  if (q.length === 1 && row.keys.some((k) => finalChar(k)?.toLocaleLowerCase() === q)) return 1
  return null
}

/**
 * True when a row answers the query by its name, note or keys ("p", "⌘d", "undo", "zoom"). One character
 * is a key being looked up ("what does Z do?"), so it matches keys only, bare or as a chord's last key:
 * as a word start it would also match Pen, Paste, Pan and a dozen more.
 */
export const rowMatches = (row: HelpRow, query: string, isMac: boolean): boolean => {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  if (keyRank(row, q, isMac) !== null) return true
  if (q.length < 2) return false
  if (wordStarts(row.label, q) || (row.note && wordStarts(row.note, q))) return true
  return row.label.toLocaleLowerCase().includes(q) || (row.note ?? "").toLocaleLowerCase().includes(q)
}

const byKeyRank = (rows: readonly HelpRow[], q: string, isMac: boolean): HelpRow[] =>
  rows
    .map((row, i) => ({ row, i, rank: keyRank(row, q, isMac) ?? 2 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((r) => r.row)

/** Groups with only the rows that match; a query naming a group keeps the whole group. */
export const filterHelpGroups = (
  groups: readonly HelpGroup[],
  query: string,
  isMac: boolean,
): HelpGroup[] => {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return [...groups]
  const shown = groups
    .map((g) =>
      q.length >= 2 && g.title.toLocaleLowerCase().startsWith(q)
        ? g
        : { ...g, rows: g.rows.filter((r) => rowMatches(r, q, isMac)) },
    )
    .filter((g) => g.rows.length > 0)
  if (q.length !== 1) return shown
  // a key lookup lists the key pressed alone before the chords that end on it
  const ranked = shown.map((g) => ({ ...g, rows: byKeyRank(g.rows, q, isMac) }))
  const best = (g: HelpGroup) => Math.min(...g.rows.map((r) => keyRank(r, q, isMac) ?? 2))
  return ranked
    .map((g, i) => ({ g, i, rank: best(g) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.g)
}

const PENCIL_WORDS = ["pencil", "shape", "correct", "snap", "circle", "box", "triangle", "tidy", "recogn"]

/** Whether the pencil explainer belongs with the current query. */
export const showsPencilNote = (query: string): boolean => {
  const q = query.trim().toLocaleLowerCase()
  return !q || q === "p" || (q.length >= 2 && PENCIL_WORDS.some((w) => w.startsWith(q) || q.startsWith(w)))
}
