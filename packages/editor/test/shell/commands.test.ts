import { EditorCore, SHORTCUTS, newElement } from "@nib/core"
import { describe, expect, it, vi } from "vitest"
import { buildCommands } from "../../src/commands"
import { parseChord } from "../../src/hooks/useShortcuts"
import type { MenuActions } from "../../src/ui/MainMenu"

const actions = new Proxy({}, { get: () => vi.fn() }) as unknown as MenuActions

describe("the command palette list", () => {
  it("has a pencil on P and the raw pen on 7", () => {
    const list = buildCommands(new EditorCore(), vi.fn(), actions, vi.fn())
    expect(list.find((c) => c.id === "tool.pencil")).toMatchObject({
      shortcut: "P",
      label: expect.stringMatching(/Pencil/),
    })
    expect(list.find((c) => c.id === "tool.pen")).toMatchObject({ shortcut: "7" })
  })

  it("arms the parallelogram on G, found by flowchart words too", () => {
    const core = new EditorCore()
    const list = buildCommands(core, vi.fn(), actions, vi.fn())
    const row = list.find((c) => c.id === "tool.parallelogram")!
    expect(row).toMatchObject({ label: "Parallelogram", group: "Tools", shortcut: "G" })
    expect(row.keywords).toEqual(expect.arrayContaining(["input", "output", "flowchart"]))
    row.run()
    expect(core.appState.activeTool).toBe("parallelogram")
  })

  it("lists Embed once, on its own key", () => {
    const list = buildCommands(new EditorCore(), vi.fn(), actions, vi.fn())
    const embeds = list.filter((c) => /embed/i.test(c.label))
    expect(embeds).toHaveLength(1)
    expect(embeds[0]).toMatchObject({ id: "tool.embed", shortcut: "W" })
  })

  it("Preferences carries its ⌘, chord", () => {
    const list = buildCommands(new EditorCore(), vi.fn(), actions, vi.fn())
    expect(list.find((c) => c.id === "app.preferences")?.shortcut).toBe("Mod+,")
  })

  it("lists every tool row of the shortcut table", () => {
    const ids = new Set(buildCommands(new EditorCore(), vi.fn(), actions, vi.fn()).map((c) => c.id))
    for (const s of SHORTCUTS.filter((r) => r.group === "tools" && r.id !== "view.pan"))
      expect(ids.has(s.id)).toBe(true)
  })

  it("ids are unique and shortcuts are chord specs the palette can lay out", () => {
    const theme = {
      current: "whiteboard" as const,
      matchSystem: false,
      apply: vi.fn(),
      setMatchSystem: vi.fn(),
    }
    const list = buildCommands(new EditorCore(), vi.fn(), actions, vi.fn(), { theme })
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
    for (const c of list)
      if (c.shortcut) expect(parseChord(c.shortcut), `${c.id}: ${c.shortcut}`).not.toBeNull()
  })

  it("view mode disables the editing commands", () => {
    const core = new EditorCore()
    core.toggleViewMode()
    const list = buildCommands(core, vi.fn(), actions, vi.fn())
    expect(list.find((c) => c.id === "tool.rectangle")?.disabled).toBe(true)
    expect(list.find((c) => c.id === "tool.hand")?.disabled).toBe(false)
    expect(list.find((c) => c.id === "file.reset")?.disabled).toBe(true)
    expect(list.find((c) => c.id === "file.export")?.disabled).toBeFalsy()
  })

  it("offers the eleven themes and Match system when the shell can switch them", () => {
    const apply = vi.fn()
    const theme = { current: "whiteboard" as const, matchSystem: false, apply, setMatchSystem: vi.fn() }
    const list = buildCommands(new EditorCore(), vi.fn(), actions, vi.fn(), { theme })
    const themes = list.filter((c) => c.group === "Theme")
    expect(themes).toHaveLength(12)
    themes.find((c) => c.id === "theme.kraft")!.run()
    expect(apply).toHaveBeenCalledWith("kraft")
    expect(themes.find((c) => c.id === "theme.whiteboard")?.disabled).toBe(true)
  })

  it("says what Match system will do, instead of a blind toggle", () => {
    const setMatchSystem = vi.fn()
    const row = (matchSystem: boolean) =>
      buildCommands(new EditorCore(), vi.fn(), actions, vi.fn(), {
        theme: { current: "graphite", matchSystem, apply: vi.fn(), setMatchSystem },
      }).find((c) => c.id === "theme.matchSystem")!
    expect(row(true).label).toBe("Stop matching the system theme")
    expect(row(false).label).toBe("Match the system theme")
    row(true).run()
    expect(setMatchSystem).toHaveBeenLastCalledWith(false)
    row(false).run()
    expect(setMatchSystem).toHaveBeenLastCalledWith(true)
  })

  it("arms the pen and the pencil the way the tray does", () => {
    const armPen = vi.fn()
    const armPencil = vi.fn()
    const list = buildCommands(new EditorCore(), vi.fn(), actions, vi.fn(), { armPen, armPencil })
    list.find((c) => c.id === "tool.pen")!.run()
    list.find((c) => c.id === "tool.pencil")!.run()
    expect(armPen).toHaveBeenCalledOnce()
    expect(armPencil).toHaveBeenCalledOnce()
    expect(list.find((c) => c.id === "tool.pen")?.label).not.toMatch(/raw/)
  })

  it("Present needs frames to present", () => {
    const core = new EditorCore()
    const present = { ...actions, present: vi.fn() } as MenuActions
    expect(
      buildCommands(core, vi.fn(), present, vi.fn()).find((c) => c.id === "present.start")?.disabled,
    ).toBe(true)
    core.addElements([newElement("frame", { x: 0, y: 0, width: 200, height: 100 })])
    expect(
      buildCommands(core, vi.fn(), present, vi.fn()).find((c) => c.id === "present.start")?.disabled,
    ).toBe(false)
  })
})
