import { EditorCore, type LibraryItem, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  addSelectionToLibrary,
  filterLibraryItems,
  insertLibraryItem,
  isLibraryFileName,
  libraryItemLabel,
  removeLibraryItem,
  renameLibraryItem,
  restoreLibraryItem,
} from "../../src/ui/panels/libraryModel"

const item = (id: string, name?: string): LibraryItem => ({
  id,
  status: "unpublished",
  elements: [newElement("rectangle", { x: 0, y: 0, width: 40, height: 40 })],
  created: 0,
  ...(name ? { name } : {}),
})

describe("library item names", () => {
  it("labels unnamed items by position", () => {
    expect(libraryItemLabel(item("a"), 2)).toBe("Library item 3")
    expect(libraryItemLabel(item("a", "Server"), 2)).toBe("Server")
  })

  it("renames, trims and clears names", () => {
    const items = [item("a"), item("b", "Old")]
    expect(renameLibraryItem(items, "a", "  Database ")[0]!.name).toBe("Database")
    expect("name" in renameLibraryItem(items, "b", "   ")[1]!).toBe(false)
  })

  it("filters by name and keeps original positions", () => {
    const items = [item("a", "Server"), item("b"), item("c", "Service bus")]
    expect(filterLibraryItems(items, "serv").map((x) => x.index)).toEqual([0, 2])
    expect(filterLibraryItems(items, "item 2").map((x) => x.item.id)).toEqual(["b"])
  })
})

describe("removing an item is undoable", () => {
  it("restores the item at its old position", () => {
    const items = [item("a"), item("b"), item("c")]
    const { items: left, removed } = removeLibraryItem(items, "b")
    expect(left.map((i) => i.id)).toEqual(["a", "c"])
    expect(restoreLibraryItem(left, removed!).map((i) => i.id)).toEqual(["a", "b", "c"])
    expect(restoreLibraryItem(items, removed!).map((i) => i.id)).toEqual(["a", "b", "c"])
  })

  it("ignores unknown ids", () => {
    expect(removeLibraryItem([item("a")], "zzz").removed).toBeNull()
  })
})

describe("one add path and inserting at the view centre", () => {
  const setup = () => {
    const core = new EditorCore()
    const box = newElement("rectangle", { x: 500, y: 500, width: 100, height: 60 })
    const label = newElement("text", {
      x: 520,
      y: 520,
      width: 40,
      height: 20,
      text: "hi",
      originalText: "hi",
      containerId: box.id,
    } as never)
    for (const el of [{ ...box, boundElements: [{ id: label.id, type: "text" }] }, label])
      core.scene.insert({ ...el, index: core.scene.nextIndex() } as never)
    core.selectElements([box.id])
    return { core, box, label }
  }

  it("adds the selection with its label as one new item in front", () => {
    const { core, box, label } = setup()
    const next = addSelectionToLibrary(core, [item("old")])!
    expect(next).toHaveLength(2)
    expect(next[0]!.elements.map((e) => e.id).sort()).toEqual([box.id, label.id].sort())
    expect(next[1]!.id).toBe("old")
  })

  it("refuses an empty selection and a duplicate", () => {
    const { core } = setup()
    const once = addSelectionToLibrary(core, [])!
    expect(addSelectionToLibrary(core, once)).toBeNull()
    core.clearSelection()
    expect(addSelectionToLibrary(core, [])).toBeNull()
  })

  it("lands a clicked item centred on the middle of the view", () => {
    const core = new EditorCore()
    core.setViewportSize(1000, 800)
    insertLibraryItem(core, item("a"))
    const placed = core.selectedElements()
    expect(placed).toHaveLength(1)
    const [cx, cy] = core.viewportCenter()
    expect(placed[0]!.x + placed[0]!.width / 2).toBeCloseTo(cx)
    expect(placed[0]!.y + placed[0]!.height / 2).toBeCloseTo(cy)
  })

  it("recognises library files by name", () => {
    expect(isLibraryFileName("shapes.excalidrawlib")).toBe(true)
    expect(isLibraryFileName("shapes.png")).toBe(false)
  })
})
