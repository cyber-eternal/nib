import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { mermaidToElements, parseMermaid } from "../../src/io/mermaid"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { addLabel, drawShape, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const order = (ed: EditorCore) => ed.scene.getNonDeleted().map((e) => e.id)

describe("fractional indices", () => {
  test("inserted elements get indices above the scene, so z-order commands keep working", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [50, 50])
    drawShape(ed, "rectangle", [100, 0], [150, 50])
    drawShape(ed, "rectangle", [200, 0], [250, 50])
    const before = ed.scene.getNonDeleted().length
    const inserted = mermaidToElements(parseMermaid("graph TD\nA-->B"), {
      appState: ed.appState,
      origin: [0, 400],
      nextIndex: () => ed.scene.nextIndex(),
    })
    ed.addElements(inserted)

    const indices = ed.scene.getElements().map((e) => e.index)
    expect(new Set(indices).size).toBe(indices.length)
    const ids = order(ed)
    for (const el of inserted) expect(ids.indexOf(el.id)).toBeGreaterThanOrEqual(before)

    ed.selectElements([a.id])
    expect(() => {
      ed.moveZ("forward")
      ed.moveZ("forward")
      ed.moveZ("forward")
    }).not.toThrow()
  })

  test("invalid index strings from a file are rewritten instead of crashing later", () => {
    const scene = new Scene([
      newElement("rectangle", { id: "one", index: "1" }),
      newElement("rectangle", { id: "two", index: "2" }),
    ])
    expect(() => scene.nextIndex()).not.toThrow()
    expect(scene.getElements().map((e) => e.id)).toEqual(["one", "two"])
  })
})

describe("grouping and z-order", () => {
  test("grouping keeps each label above its container and does not jump over unrelated elements", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    const label = addLabel(ed, a, "A")
    const c = drawShape(ed, "rectangle", [50, 50], [350, 80]) // overlaps both, sits on top
    ed.selectElements([a.id, b.id])
    ed.group()

    const ids = order(ed)
    expect(ids.indexOf(label)).toBeGreaterThan(ids.indexOf(a.id))
    expect(ids.indexOf(c.id)).toBeGreaterThan(ids.indexOf(a.id))
    expect(ids.indexOf(c.id)).toBeGreaterThan(ids.indexOf(b.id))
  })
})
