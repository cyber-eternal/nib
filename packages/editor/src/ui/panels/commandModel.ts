import { SHORTCUTS } from "@nib/core"
import { parseChord } from "../../hooks/useShortcuts"
import { type ThemeId, themes } from "../../theme/themes"

export interface Command {
  id: string
  label: string
  group: string
  /** A chord ("Mod+Shift+E") or, from older callers, display text ("⇧⌘E"). Rows of core SHORTCUTS win. */
  shortcut?: string
  /** Other words that should find this command ("dark" for a theme, "freehand" for the pen). */
  keywords?: readonly string[]
  disabled?: boolean
  run(): void
}

/** Palette groups in the order they are listed before anything is typed; unknown groups follow. */
export const GROUP_ORDER: readonly string[] = [
  "Tools",
  "File",
  "Edit",
  "Arrange",
  "View",
  "Insert",
  "Theme",
  "Present",
  "Help",
]

/** Palette command ids whose core SHORTCUTS row has a different id. */
export const SHORTCUT_ALIASES: Readonly<Record<string, string>> = {
  "tool.freedraw": "tool.pen",
  "edit.undo": "history.undo",
  "edit.redo": "history.redo",
  "edit.selectAll": "selection.all",
  "edit.group": "arrange.group",
  "edit.ungroup": "arrange.ungroup",
  "edit.tidy": "arrange.tidy",
  "arrange.bringToFront": "arrange.front",
  "arrange.bringForward": "arrange.forward",
  "arrange.sendBackward": "arrange.backward",
  "arrange.sendToBack": "arrange.back",
  "view.toggleStats": "view.stats",
  "help.shortcuts": "app.help",
  "help.palette": "app.palette",
  "app.find": "app.search",
  "file.exportImage": "file.export",
}

const shortcutRows = new Map(SHORTCUTS.map((s) => [s.id, s]))

/** The chord to show for a command: its core SHORTCUTS row first, then what the caller passed. */
export const commandShortcut = (cmd: Pick<Command, "id" | "shortcut">): string | undefined => {
  const row = shortcutRows.get(cmd.id) ?? shortcutRows.get(SHORTCUT_ALIASES[cmd.id] ?? "")
  if (row?.keys[0]) return row.keys[0]
  return cmd.shortcut || undefined
}

/** True for a chord the Kbd primitive can lay out per platform; false for free display text. */
export const isChordSpec = (text: string): boolean => parseChord(text) !== null

const words = (s: string): string[] =>
  s
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

const subsequence = (hay: string, needle: string): boolean => {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

/** 0 when the command does not match; higher is better. */
export const scoreCommand = (cmd: Pick<Command, "label" | "group" | "keywords">, query: string): number => {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return 1
  const label = cmd.label.toLocaleLowerCase()
  if (label === q) return 120
  if (label.startsWith(q)) return 100
  const labelWords = words(cmd.label)
  if (labelWords.some((w) => w.startsWith(q))) return 80
  const idx = label.indexOf(q)
  if (idx >= 0) return 60 - Math.min(idx, 30)
  // every typed word starts some label word: "zo fit" finds "Zoom to fit"
  const typed = words(q)
  if (typed.length > 1 && typed.every((t) => labelWords.some((w) => w.startsWith(t)))) return 50
  if ((cmd.keywords ?? []).some((k) => k.toLocaleLowerCase().startsWith(q))) return 40
  if (subsequence(label.replace(/\s+/g, ""), q.replace(/\s+/g, ""))) return 20
  if (cmd.group.toLocaleLowerCase().startsWith(q)) return 10
  return 0
}

/** Matching commands, best first; equal scores keep the caller's order. */
export const rankCommands = <T extends Command>(commands: readonly T[], query: string): T[] =>
  commands
    .map((c, i) => ({ c, i, s: scoreCommand(c, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c)

export interface CommandGroup<T extends Command = Command> {
  group: string
  items: T[]
}

/** Commands grouped in GROUP_ORDER, each group in the caller's order. */
export const groupCommands = <T extends Command>(commands: readonly T[]): CommandGroup<T>[] => {
  const groups = new Map<string, T[]>()
  for (const c of commands) {
    const list = groups.get(c.group)
    if (list) list.push(c)
    else groups.set(c.group, [c])
  }
  const rank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g)
    return i < 0 ? GROUP_ORDER.length : i
  }
  return [...groups.entries()]
    .map(([group, items], order) => ({ group, items, order }))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.order - b.order)
    .map(({ group, items }) => ({ group, items }))
}

/**
 * What the palette shows: everything grouped while the query is empty, one ranked list otherwise.
 * Each entry keeps its group so a ranked row can still say where it comes from.
 */
export const paletteSections = <T extends Command>(
  commands: readonly T[],
  query: string,
): CommandGroup<T>[] =>
  query.trim() ? [{ group: "", items: rankCommands(commands, query) }] : groupCommands(commands)

export interface ThemeCommandOptions {
  current: ThemeId | null
  matchSystem: boolean
  apply(id: ThemeId): void
  setMatchSystem(on: boolean): void
}

/** One palette command per theme plus Match system, for the shell to spread into its command list. */
export const themeCommands = (opts: ThemeCommandOptions): Command[] => [
  ...themes.map(
    (t): Command => ({
      id: `theme.${t.id}`,
      label: `Theme: ${t.name}`,
      group: "Theme",
      keywords: [t.name, t.mode, "theme", "colours", "colors", "appearance"],
      disabled: !opts.matchSystem && opts.current === t.id,
      run: () => opts.apply(t.id),
    }),
  ),
  {
    id: "theme.matchSystem",
    label: opts.matchSystem ? "Stop matching the system theme" : "Match the system theme",
    group: "Theme",
    keywords: ["light", "dark", "auto", "appearance", "system"],
    run: () => opts.setMatchSystem(!opts.matchSystem),
  },
]
