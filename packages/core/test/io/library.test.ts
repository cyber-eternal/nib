import { describe, expect, test } from "vitest"
import {
  LIBRARY_MIME,
  createLibraryItem,
  mergeLibraryItems,
  parseLibrary,
  parseLibraryFile,
  serializeLibrary,
} from "../../src/io/excalidraw"
import { newElement } from "../../src/model/element"
import type { BinaryFiles, NibElement, TextElement } from "../../src/model/types"

const PNG = "data:image/png;base64,iVBORw0KGgo="

const box = (x = 0, extra: Record<string, unknown> = {}) =>
  newElement("rectangle", { x, y: 0, width: 40, height: 30, index: "a0", ...extra })

describe(".excalidrawlib import", () => {
  test("a v2 library keeps ids, names, status and per-item files", () => {
    const image = newElement("image", { x: 0, y: 0, width: 10, height: 10, fileId: "f1", index: "a0" })
    const text = JSON.stringify({
      type: "excalidrawlib",
      version: 2,
      libraryItems: [
        {
          id: "one",
          status: "published",
          name: "  Server  ",
          created: 5,
          elements: [image],
          files: { f1: { mimeType: "image/png", dataURL: PNG }, unused: { dataURL: PNG } },
        },
        { id: "two", elements: [box()] },
      ],
    })
    const result = parseLibraryFile(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [one, two] = result.items
    expect([one!.id, one!.status, one!.name, one!.created]).toEqual(["one", "published", "Server", 5])
    expect(Object.keys(one!.files ?? {})).toEqual(["f1"])
    expect(two!.status).toBe("unpublished")
    expect(two!.name).toBeUndefined()
  })

  test("a v1 library (bare element arrays) is read too", () => {
    const text = JSON.stringify({ type: "excalidrawlib", version: 1, library: [[box()], [box(), box(50)]] })
    const items = parseLibrary(text)
    expect(items.map((i) => i.elements.length)).toEqual([1, 2])
    expect(new Set(items.map((i) => i.id)).size).toBe(2)
  })

  test("duplicate ids in one file get new ids", () => {
    const text = JSON.stringify({
      libraryItems: [
        { id: "x", elements: [box()] },
        { id: "x", elements: [box(9)] },
      ],
    })
    const items = parseLibrary(text)
    expect(items[0]!.id).toBe("x")
    expect(items[1]!.id).not.toBe("x")
  })

  test("broken and foreign files are explained instead of read as empty", () => {
    expect(parseLibraryFile("{oops")).toMatchObject({ ok: false })
    expect(parseLibraryFile(JSON.stringify({ type: "excalidraw", elements: [] }))).toEqual({
      ok: false,
      error: "That file isn't an Excalidraw library.",
    })
    expect(parseLibraryFile(JSON.stringify({ type: "excalidrawlib" }))).toEqual({
      ok: false,
      error: "That file has no library items.",
    })
  })
})

describe(".excalidrawlib export", () => {
  const files: BinaryFiles = { f1: { id: "f1", mimeType: "image/png", dataURL: PNG, created: 1 } }
  const label = newElement("text", {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    text: "Hi",
    fontFamily: "code",
    index: "a1",
  })

  test("v2 writes names and files and round-trips", () => {
    const image = newElement("image", { x: 0, y: 0, width: 10, height: 10, fileId: "f1", index: "a0" })
    const item = createLibraryItem([image], files, "Logo")
    const out = JSON.parse(serializeLibrary([item]))
    expect([out.type, out.version]).toEqual(["excalidrawlib", 2])
    expect(out.libraryItems[0]).toMatchObject({ id: item.id, name: "Logo", status: "unpublished" })
    expect(Object.keys(out.libraryItems[0].files)).toEqual(["f1"])
    const [back] = parseLibrary(JSON.stringify(out))
    expect(back!.name).toBe("Logo")
    expect(back!.files?.f1?.dataURL).toBe(PNG)
  })

  test("v1 writes bare element arrays Excalidraw 0.x can read", () => {
    const out = JSON.parse(serializeLibrary([createLibraryItem([box()], {})], { version: 1 }))
    expect(out.version).toBe(1)
    expect(Array.isArray(out.library[0])).toBe(true)
    expect(out.libraryItems).toBeUndefined()
  })

  test("the Excalidraw target writes numeric font codes; the Nib target keeps Nib's fields", () => {
    const item = createLibraryItem([label], {})
    const forExcalidraw = JSON.parse(serializeLibrary([item]))
    expect(forExcalidraw.libraryItems[0].elements[0].fontFamily).toBe(3)
    const forNib = JSON.parse(serializeLibrary([item], { target: "nib" }))
    expect(forNib.libraryItems[0].elements[0].fontFamily).toBe("code")
    expect((parseLibrary(JSON.stringify(forExcalidraw))[0]!.elements[0] as TextElement).fontFamily).toBe(
      "code",
    )
  })

  test("deleted elements are left out", () => {
    const item = { ...createLibraryItem([box()], {}), elements: [box(), box(5, { isDeleted: true })] }
    const out = JSON.parse(serializeLibrary([item]))
    expect(out.libraryItems[0].elements).toHaveLength(1)
  })

  test("the drag MIME type is Nib's own", () => {
    expect(LIBRARY_MIME).toBe("application/vnd.nib.library+json")
  })
})

describe("merging an imported library", () => {
  const itemAt = (x: number, id: string, extra: Record<string, unknown> = {}) => ({
    ...createLibraryItem([box(x, extra)], {}),
    id,
  })

  test("new items go first and an item already there (same look, anywhere on the canvas) is skipped", () => {
    const existing = [itemAt(0, "a")]
    const merged = mergeLibraryItems(existing, [itemAt(500, "b"), itemAt(0, "c", { strokeColor: "#e03131" })])
    expect(merged.map((i) => i.id)).toEqual(["c", "a"])
  })

  test("an incoming item whose id is taken by different content gets a new id", () => {
    const merged = mergeLibraryItems([itemAt(0, "a")], [itemAt(0, "a", { width: 99 })])
    expect(merged).toHaveLength(2)
    expect(merged[0]!.id).not.toBe("a")
    expect(merged[1]!.id).toBe("a")
  })

  test("importing the same file twice adds nothing the second time", () => {
    const incoming: NibElement[][] = [[box(0)], [box(0, { height: 80 })]]
    const text = serializeLibrary(incoming.map((els) => createLibraryItem(els, {})))
    const once = mergeLibraryItems([], parseLibrary(text))
    expect(mergeLibraryItems(once, parseLibrary(text))).toHaveLength(2)
  })
})
