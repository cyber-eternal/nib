import { SHORTCUTS } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  GESTURE_ROWS,
  buildHelpGroups,
  displayKeys,
  filterHelpGroups,
  rowMatches,
  showsPencilNote,
} from "../../src/ui/panels/helpModel"

const groups = buildHelpGroups()
const ids = (gs: ReturnType<typeof buildHelpGroups>) => gs.flatMap((g) => g.rows.map((r) => r.id))

describe("help sheet is generated from core SHORTCUTS", () => {
  it("lists every shortcut row exactly once, plus the drag gestures", () => {
    const listed = ids(groups)
    for (const s of SHORTCUTS) expect(listed.filter((id) => id === s.id)).toHaveLength(1)
    expect(listed.length).toBe(SHORTCUTS.length + GESTURE_ROWS.length)
  })

  it("groups rows in a stable order and includes flowchart and font-size keys", () => {
    expect(groups.map((g) => g.id)).toEqual(["tools", "edit", "arrange", "view", "file", "help", "gestures"])
    for (const id of [
      "flow.addNode",
      "flow.navigate",
      "style.fontSizeUp",
      "style.fontSizeDown",
      "tool.pencil",
    ])
      expect(ids(groups)).toContain(id)
  })

  it("explains the pen and the pencil apart", () => {
    const tools = groups.find((g) => g.id === "tools")!.rows
    expect(tools.find((r) => r.id === "tool.pencil")?.note).toMatch(/clean shapes/)
    expect(tools.find((r) => r.id === "tool.pen")?.note).toMatch(/Raw/)
  })

  it("lists the parallelogram on G as the flowchart input/output shape", () => {
    const row = groups.find((g) => g.id === "tools")!.rows.find((r) => r.id === "tool.parallelogram")
    expect(row).toMatchObject({ label: "Parallelogram", keys: ["G"], note: "Flowchart input and output" })
  })
})

describe("key display", () => {
  it("formats chords per platform", () => {
    expect(displayKeys(["Mod+Shift+Z", "Mod+Y"], true)).toEqual(["⇧⌘Z", "⌘Y"])
    expect(displayKeys(["Mod+Shift+Z"], false)).toEqual(["Ctrl+Shift+Z"])
  })

  it("collapses the four arrows of one chord into one key", () => {
    expect(displayKeys(["Mod+ArrowRight", "Mod+ArrowDown", "Mod+ArrowLeft", "Mod+ArrowUp"], true)).toEqual([
      "⌘ Arrows",
    ])
    expect(displayKeys(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], false)).toEqual(["Arrows"])
    expect(displayKeys(["Alt+ArrowRight", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowUp"], false)).toEqual([
      "Alt+Arrows",
    ])
  })

  it("shows gesture modifiers on their own", () => {
    expect(displayKeys(["Shift"], true)).toEqual(["⇧"])
    expect(displayKeys(["Mod"], false)).toEqual(["Ctrl"])
  })
})

describe("help search", () => {
  it("finds a row by its key", () => {
    const found = ids(filterHelpGroups(groups, "p", true))
    expect(found).toContain("tool.pencil")
    expect(found).not.toContain("history.undo")
  })

  it("answers a one-key query with that key's rows only, not every word starting with it", () => {
    const found = ids(filterHelpGroups(groups, "P", true))
    expect(found).toEqual(["tool.pencil"])
    // the bare key first, then ⌘7 (Go to tab)
    expect(ids(filterHelpGroups(groups, "7", true))).toEqual(["tool.pen", "tab.goTo"])
    expect(ids(filterHelpGroups(groups, "pe", true))).toEqual(
      expect.arrayContaining(["tool.pen", "tool.pencil"]),
    )
  })

  it("a one-key query also finds the chords ending on that key, bare key first", () => {
    const z = ids(filterHelpGroups(groups, "Z", true))
    expect(z).toEqual(expect.arrayContaining(["history.undo", "history.redo", "view.zen"]))
    expect(z).not.toContain("tool.pencil")
    expect(ids(filterHelpGroups(groups, "c", false))).toEqual(
      expect.arrayContaining(["edit.copy", "edit.copyStyle", "edit.copyPng"]),
    )
    expect(ids(filterHelpGroups(groups, "s", true))).toEqual(
      expect.arrayContaining(["file.save", "view.snap", "style.stroke"]),
    )
    expect(ids(filterHelpGroups(groups, "G", true))).toEqual(
      expect.arrayContaining(["arrange.group", "arrange.ungroup", "style.background"]),
    )
    const v = filterHelpGroups(groups, "v", true)
    expect(v[0]!.rows[0]!.id).toBe("tool.selection")
    expect(ids(v)).toEqual(expect.arrayContaining(["edit.paste", "arrange.flipV"]))
    const one = filterHelpGroups(groups, "1", true).flatMap((g) => g.rows.map((r) => r.id))
    expect(one.indexOf("tool.selection")).toBeLessThan(one.indexOf("view.zoomFit"))
  })

  it("finds rows by name and note words", () => {
    expect(ids(filterHelpGroups(groups, "undo", true))).toEqual(["history.undo"])
    expect(ids(filterHelpGroups(groups, "freehand", false))).toEqual(
      expect.arrayContaining(["tool.pen", "tool.pencil"]),
    )
  })

  it("matches a typed chord", () => {
    const undo = groups.flatMap((g) => g.rows).find((r) => r.id === "history.undo")!
    expect(rowMatches(undo, "⌘z", true)).toBe(true)
    expect(rowMatches(undo, "ctrl+z", false)).toBe(true)
  })

  it("keeps a whole group when the query names it, and drops empty groups", () => {
    const view = filterHelpGroups(groups, "view", true)
    expect(view.find((g) => g.id === "view")?.rows.length).toBe(
      groups.find((g) => g.id === "view")!.rows.length,
    )
    expect(filterHelpGroups(groups, "qqqq", true)).toEqual([])
  })

  it("shows the pencil explainer for pencil-ish queries only", () => {
    expect(showsPencilNote("")).toBe(true)
    expect(showsPencilNote("p")).toBe(true)
    expect(showsPencilNote("shapes")).toBe(true)
    expect(showsPencilNote("zoom")).toBe(false)
    expect(showsPencilNote("s")).toBe(false)
  })
})
