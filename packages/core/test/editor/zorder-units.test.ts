import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { newElement } from "../../src/model/element"
import type { NibElement } from "../../src/model/types"
import { computeMoveIndices } from "../../src/model/zindex"
import { addLabel, drawShape, key, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const order = (ed: EditorCore) => ed.scene.getNonDeleted().map((e) => e.id)
const back = (ed: EditorCore) => ed.keyDown({ ...key("[", { metaKey: true }), code: "BracketLeft" })
const forward = (ed: EditorCore) => ed.keyDown({ ...key("]", { metaKey: true }), code: "BracketRight" })

describe("a z-order step hops a whole unit", () => {
  test("Send backward does not slip a shape between a container and its label", () => {
    const ed = new EditorCore()
    const b = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const label = addLabel(ed, b, "B")
    const x = drawShape(ed, "rectangle", [300, 0], [400, 100])
    expect(order(ed)).toEqual([b.id, label, x.id])
    ed.selectElements([x.id])
    back(ed)
    expect(order(ed)).toEqual([x.id, b.id, label])
  })

  test("Bring forward does not slip a shape between a container and its label", () => {
    const ed = new EditorCore()
    const x = drawShape(ed, "rectangle", [300, 0], [400, 100])
    const b = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const label = addLabel(ed, b, "B")
    ed.selectElements([x.id])
    forward(ed)
    expect(order(ed)).toEqual([b.id, label, x.id])
  })

  test("a step over a group hops the whole group", () => {
    const ed = new EditorCore()
    const g1 = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const g2 = drawShape(ed, "rectangle", [150, 0], [250, 100])
    ed.selectElements([g1.id, g2.id])
    ed.group()
    const x = drawShape(ed, "ellipse", [300, 0], [400, 100])
    ed.selectElements([x.id])
    back(ed)
    expect(order(ed)).toEqual([x.id, g1.id, g2.id])
    forward(ed)
    expect(order(ed)).toEqual([g1.id, g2.id, x.id])
  })

  test("a labelled shape moves with its label and stays below it", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [200, 0], [300, 100])
    const label = addLabel(ed, b, "B")
    ed.selectElements([b.id])
    back(ed)
    expect(order(ed)).toEqual([b.id, label, a.id])
  })
})

describe("z-order keys never repeat a deleted element's key", () => {
  test("a step backward into a gap left by a deleted element picks a fresh key", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [50, 50])
    const gone = drawShape(ed, "rectangle", [100, 0], [150, 50])
    const b = drawShape(ed, "rectangle", [200, 0], [250, 50])
    const c = drawShape(ed, "rectangle", [300, 0], [350, 50])
    ed.selectElements([gone.id])
    ed.deleteSelected()
    ed.selectElements([c.id])
    back(ed)
    const keys = ed.scene.getElements().map((e) => e.index)
    expect(new Set(keys).size).toBe(keys.length)
    expect(order(ed)).toEqual([a.id, c.id, b.id])
    ed.undo()
    ed.undo()
    const restored = ed.scene.getElements().map((e) => e.index)
    expect(new Set(restored).size).toBe(restored.length)
    expect(order(ed)).toEqual([a.id, gone.id, b.id, c.id])
  })

  test("front and back step past tombstones at either end", () => {
    const els: NibElement[] = [
      newElement("rectangle", { id: "a", index: "a0" }),
      newElement("rectangle", { id: "b", index: "a1" }),
      newElement("rectangle", { id: "t", index: "a2", isDeleted: true }),
    ]
    const front = computeMoveIndices(els, new Set(["a"]), "front")
    expect(front.get("a")! > "a2").toBe(true)
    const withBottomTomb: NibElement[] = [
      newElement("rectangle", { id: "t", index: "a0", isDeleted: true }),
      newElement("rectangle", { id: "a", index: "a1" }),
      newElement("rectangle", { id: "b", index: "a2" }),
    ]
    const backKeys = computeMoveIndices(withBottomTomb, new Set(["b"]), "back")
    expect(backKeys.get("b")! < "a0").toBe(true)
  })

  test("an alt-drag copy never takes an existing key, even beside tied keys", () => {
    const ed = new EditorCore()
    const a = newElement("rectangle", { id: "a", x: 0, y: 0, width: 50, height: 50, index: "a0" })
    const b = newElement("rectangle", { id: "b", x: 100, y: 0, width: 50, height: 50, index: "a1" })
    const c = newElement("rectangle", { id: "c", x: 200, y: 0, width: 50, height: 50, index: "a2" })
    ed.loadScene([a, b, c])
    // ties can still come from elsewhere; the fallback must clear every existing key
    ed.scene.update({ ...ed.scene.get("b")!, index: "a0" })
    ed.scene.update({ ...ed.scene.get("c")!, index: "a1" })
    ed.selectElements(["a"])
    ed.pointerDown(ptr(25, 25, { altKey: true }))
    ed.pointerMove(ptr(25, 125, { altKey: true }))
    ed.pointerUp(ptr(25, 125, { altKey: true }))
    const copy = ed.scene.getElements().find((e) => !["a", "b", "c"].includes(e.id))!
    const others = ed.scene.getElements().filter((e) => e !== copy)
    expect(others.map((e) => e.index)).not.toContain(copy.index)
  })
})
