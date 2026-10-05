import { describe, expect, it } from "vitest"
import { themes } from "../../src/theme/themes"
import {
  type Command,
  commandShortcut,
  groupCommands,
  isChordSpec,
  paletteSections,
  rankCommands,
  scoreCommand,
  themeCommands,
} from "../../src/ui/panels/commandModel"

const noop = () => {}
const cmd = (id: string, label: string, group: string, extra: Partial<Command> = {}): Command => ({
  id,
  label,
  group,
  run: noop,
  ...extra,
})

const commands = [
  cmd("view.zoomFit", "Zoom to fit", "View"),
  cmd("arrange.alignLeft", "Align left", "Arrange"),
  cmd("tool.pencil", "Pencil: draw and correct shapes", "Tools"),
  cmd("tool.freedraw", "Pen", "Tools", { shortcut: "P", keywords: ["freehand", "draw"] }),
  cmd("file.save", "Save", "File", { shortcut: "⌘S" }),
  cmd("present.start", "Present frames", "Present"),
  cmd("custom.thing", "Something else", "Plugins"),
]

describe("command ranking", () => {
  it("prefers exact and prefix matches, then word starts, then substrings", () => {
    expect(scoreCommand(commands[4]!, "save")).toBeGreaterThan(scoreCommand(commands[0]!, "fit"))
    expect(scoreCommand(commands[0]!, "fit")).toBeGreaterThan(scoreCommand(commands[1]!, "eft"))
  })

  it("finds commands by every typed word, keywords and subsequences", () => {
    expect(rankCommands(commands, "zo fit").map((c) => c.id)).toEqual(["view.zoomFit"])
    expect(rankCommands(commands, "freehand").map((c) => c.id)).toEqual(["tool.freedraw"])
    expect(rankCommands(commands, "aln").map((c) => c.id)).toContain("arrange.alignLeft")
  })

  it("keeps the caller's order for equal scores, ranks group matches last and drops non-matches", () => {
    expect(rankCommands(commands, "p").map((c) => c.id)).toEqual([
      "tool.pencil",
      "tool.freedraw",
      "present.start",
      "custom.thing",
    ])
    expect(rankCommands(commands, "zzz")).toEqual([])
  })
})

describe("command grouping", () => {
  it("lists groups in the palette's order, unknown groups last", () => {
    expect(groupCommands(commands).map((g) => g.group)).toEqual([
      "Tools",
      "File",
      "Arrange",
      "View",
      "Present",
      "Plugins",
    ])
  })

  it("shows groups while the query is empty and one ranked list once typing starts", () => {
    expect(paletteSections(commands, "").length).toBeGreaterThan(1)
    const ranked = paletteSections(commands, "zoom")
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.group).toBe("")
  })
})

describe("command shortcuts come from the core table", () => {
  it("uses the SHORTCUTS row over a stale caller shortcut (the pen is 7, the pencil P)", () => {
    expect(commandShortcut(commands[3]!)).toBe("7")
    expect(commandShortcut(commands[2]!)).toBe("P")
  })

  it("maps palette ids onto differently named rows", () => {
    expect(commandShortcut({ id: "edit.undo" })).toBe("Mod+Z")
    expect(commandShortcut({ id: "help.shortcuts" })).toBe("?")
  })

  it("falls back to the caller's text, and to nothing", () => {
    expect(commandShortcut({ id: "custom.thing", shortcut: "Mod+Alt+P" })).toBe("Mod+Alt+P")
    expect(commandShortcut({ id: "present.start" })).toBeUndefined()
  })

  it("recognises chords the Kbd primitive can format", () => {
    expect(isChordSpec("Mod+Shift+E")).toBe(true)
    expect(isChordSpec("⇧⌘E")).toBe(true)
    expect(isChordSpec("not a chord")).toBe(false)
  })
})

describe("theme commands", () => {
  it("offers every theme and Match system, with the current theme disabled", () => {
    const picked: string[] = []
    const list = themeCommands({
      current: "graphite",
      matchSystem: false,
      apply: (id) => picked.push(id),
      setMatchSystem: noop,
    })
    expect(list).toHaveLength(themes.length + 1)
    expect(list.find((c) => c.id === "theme.graphite")?.disabled).toBe(true)
    list.find((c) => c.id === "theme.blueprint")!.run()
    expect(picked).toEqual(["blueprint"])
    expect(rankCommands(list, "dark").length).toBeGreaterThanOrEqual(4)
  })

  it("toggles Match system", () => {
    let on = true
    const list = themeCommands({
      current: null,
      matchSystem: on,
      apply: noop,
      setMatchSystem: (v) => (on = v),
    })
    const match = list.find((c) => c.id === "theme.matchSystem")!
    expect(match.label).toMatch(/Stop matching/)
    match.run()
    expect(on).toBe(false)
  })
})
