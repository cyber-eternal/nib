import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { getBoundText } from "../../src/geometry/boundText"
import type { NibElement, TextElement } from "../../src/model/types"
import { frameLabelLayout } from "../../src/render/drawElement"
import { selectionHandleSet } from "../../src/render/interactiveScene"
import { addLabel, drawShape, key, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

/** Frame F holding a rectangle labelled "Web app". */
const framed = () => {
  const ed = new EditorCore()
  const frame = drawShape(ed, "frame", [0, 0], [400, 300])
  const rect = drawShape(ed, "rectangle", [100, 100], [220, 180])
  const labelId = addLabel(ed, rect, "Web app")
  expect(ed.scene.get(rect.id)!.frameId).toBe(frame.id)
  ed.selectElements([frame.id])
  return { ed, frame, rect, labelId }
}

const copiesOf = (ed: EditorCore, before: ReadonlySet<string>) =>
  ed.scene.getNonDeleted().filter((el) => !before.has(el.id))

const labelOf = (ed: EditorCore, el: NibElement): TextElement | null =>
  getBoundText(ed.scene.get(el.id)!, (id) => ed.scene.get(id))

describe("a frame's contents travel with it", () => {
  test("withFrameChildren brings the children and their labels", () => {
    const { ed, frame, rect, labelId } = framed()
    const ids = ed.withFrameChildren([ed.scene.get(frame.id)!])
    expect([...ids].sort()).toEqual([frame.id, rect.id, labelId].sort())
  })

  test("Cmd+D copies the frame with its labelled child, inside the new frame", () => {
    const { ed, frame } = framed()
    const before = new Set(ed.scene.getNonDeleted().map((el) => el.id))
    ed.keyDown({ ...key("d", { metaKey: true }), code: "KeyD" })
    const copies = copiesOf(ed, before)
    const newFrame = copies.find((el) => el.type === "frame")!
    const newRect = copies.find((el) => el.type === "rectangle")!
    expect(copies).toHaveLength(3)
    expect(newRect.frameId).toBe(newFrame.id)
    const label = labelOf(ed, newRect)!
    expect(label.originalText).toBe("Web app")
    expect(label.frameId).toBe(newFrame.id)
    // only the frame copy is selected, as the frame was
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([newFrame.id])
    expect(ed.scene.get(frame.id)!.x).toBe(0)
  })

  test("Alt-drag copies the frame with its contents and moves them together", () => {
    const { ed, frame, rect } = framed()
    const before = new Set(ed.scene.getNonDeleted().map((el) => el.id))
    ed.pointerDown(ptr(300, 250, { altKey: true }))
    ed.pointerMove(ptr(400, 250, { altKey: true }))
    ed.pointerMove(ptr(800, 250, { altKey: true }))
    ed.pointerUp(ptr(800, 250, { altKey: true }))
    const copies = copiesOf(ed, before)
    const newFrame = copies.find((el) => el.type === "frame")!
    const newRect = copies.find((el) => el.type === "rectangle")!
    const label = labelOf(ed, newRect)!
    expect(copies).toHaveLength(3)
    expect(newFrame.x).toBe(500)
    expect(newRect.x).toBe(600)
    expect(newRect.frameId).toBe(newFrame.id)
    expect(label.originalText).toBe("Web app")
    expect(label.x).toBeGreaterThan(newRect.x)
    expect(label.x + label.width).toBeLessThan(newRect.x + newRect.width)
    // the originals stay where they were
    expect(ed.scene.get(frame.id)!.x).toBe(0)
    expect(ed.scene.get(rect.id)!.x).toBe(100)
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([newFrame.id])
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(3)
  })

  test("moving and nudging a frame keeps each label centred on its container", () => {
    const { ed, rect, labelId } = framed()
    const offset = (id: string) => {
      const r = ed.scene.get(rect.id)!
      const t = ed.scene.get(id)!
      return [t.x - r.x, t.y - r.y]
    }
    const start = offset(labelId)
    ed.pointerDown(ptr(300, 250))
    ed.pointerMove(ptr(340, 270))
    ed.pointerMove(ptr(380, 290))
    ed.pointerUp(ptr(380, 290))
    expect(ed.scene.get(rect.id)!.x).toBe(180)
    expect(offset(labelId)).toEqual(start)
    ed.keyDown(key("ArrowDown", { shiftKey: true }))
    expect(ed.scene.get(rect.id)!.y).toBe(150)
    expect(offset(labelId)).toEqual(start)
  })
})

describe("frames do not rotate", () => {
  test("a selected frame, alone or with others, gets no rotation handle", () => {
    const { ed, frame, rect } = framed()
    expect(selectionHandleSet([ed.scene.get(frame.id)!], 1)!.handles.rotation).toBeUndefined()
    expect(selectionHandleSet([ed.scene.get(rect.id)!], 1)!.handles.rotation).toBeDefined()
    const both = [ed.scene.get(frame.id)!, ed.scene.get(rect.id)!]
    expect(selectionHandleSet(both, 1)!.handles.rotation).toBeUndefined()
  })

  test("the stats panel cannot tilt a frame either", () => {
    const { ed, frame } = framed()
    ed.setElementGeometry(frame.id, { angle: Math.PI / 6, x: 10 })
    expect(ed.scene.get(frame.id)!.angle).toBe(0)
    expect(ed.scene.get(frame.id)!.x).toBe(10)
  })
})

describe("a drag keeps frame membership that the drag does not change", () => {
  const onName = (ed: EditorCore, frameId: string): [number, number] => {
    const frame = ed.scene.get(frameId)!
    const box = frameLabelLayout(frame, ed.appState.viewport.zoom)!
    return [frame.x + box.x + box.width / 2, frame.y + box.y + box.height / 2]
  }
  const dragBy = (ed: EditorCore, from: [number, number], dx: number, dy: number, alt = false) => {
    ed.pointerDown(ptr(from[0], from[1], { altKey: alt }))
    ed.pointerMove(ptr(from[0] + dx / 2, from[1] + dy / 2, { altKey: alt }))
    ed.pointerMove(ptr(from[0] + dx, from[1] + dy, { altKey: alt }))
    ed.pointerUp(ptr(from[0] + dx, from[1] + dy, { altKey: alt }))
  }

  test("a pasted frame dragged by its name keeps the pasted child and its label", () => {
    const { ed } = framed()
    const pasted = ed.insertScene(ed.scene.getNonDeleted(), {}, [1000, 150])
    const newFrame = pasted.find((el) => el.type === "frame")!
    const newRect = pasted.find((el) => el.type === "rectangle")!
    expect(Object.keys(ed.appState.selectedElementIds).sort()).toEqual([newFrame.id, newRect.id].sort())
    dragBy(ed, onName(ed, newFrame.id), 100, 50)
    expect(ed.scene.get(newFrame.id)!.x).toBe(900)
    expect(ed.scene.get(newRect.id)!.frameId).toBe(newFrame.id)
    expect(labelOf(ed, newRect)!.frameId).toBe(newFrame.id)
  })

  test("a frame and its shift-clicked child dragged or Alt-dragged by the name stay together", () => {
    const { ed, frame, rect } = framed()
    ed.selectElements([frame.id, rect.id])
    dragBy(ed, onName(ed, frame.id), 40, 0)
    expect(ed.scene.get(rect.id)!.frameId).toBe(frame.id)
    expect(labelOf(ed, rect)!.frameId).toBe(frame.id)

    const before = new Set(ed.scene.getNonDeleted().map((el) => el.id))
    ed.selectElements([frame.id, rect.id])
    dragBy(ed, onName(ed, frame.id), 600, 0, true)
    const copies = copiesOf(ed, before)
    const newFrame = copies.find((el) => el.type === "frame")!
    const newRect = copies.find((el) => el.type === "rectangle")!
    expect(newRect.frameId).toBe(newFrame.id)
    expect(ed.scene.get(rect.id)!.frameId).toBe(frame.id)
  })

  test("select-all dragged by a framed shape leaves every membership as it was", () => {
    const ed = new EditorCore()
    const f1 = drawShape(ed, "frame", [0, 0], [400, 300])
    const r1 = drawShape(ed, "rectangle", [100, 100], [200, 200])
    const f2 = drawShape(ed, "frame", [600, 0], [1000, 300])
    const r2 = drawShape(ed, "rectangle", [700, 100], [800, 200])
    const free = drawShape(ed, "ellipse", [100, 800], [200, 900])
    expect(ed.scene.get(r1.id)!.frameId).toBe(f1.id)
    expect(ed.scene.get(r2.id)!.frameId).toBe(f2.id)
    ed.setTool("selection")
    ed.keyDown({ ...key("a", { metaKey: true }), code: "KeyA" })
    dragBy(ed, [150, 150], 30, 20)
    expect(ed.scene.get(r1.id)!.x).toBe(130)
    expect(ed.scene.get(r1.id)!.frameId).toBe(f1.id)
    expect(ed.scene.get(r2.id)!.frameId).toBe(f2.id)
    expect(ed.scene.get(free.id)!.frameId).toBeNull()
  })

  test("a shape dragged into a frame still joins it, and one dragged out leaves", () => {
    const ed = new EditorCore()
    const frame = drawShape(ed, "frame", [0, 0], [400, 300])
    const shape = drawShape(ed, "rectangle", [600, 100], [700, 200])
    expect(ed.scene.get(shape.id)!.frameId).toBeNull()
    ed.setTool("selection")
    dragBy(ed, [650, 150], -400, 0)
    expect(ed.scene.get(shape.id)!.frameId).toBe(frame.id)
    dragBy(ed, [250, 150], 400, 0)
    expect(ed.scene.get(shape.id)!.frameId).toBeNull()
  })

  test("of several shapes dropped on a frame, only those that reach it join", () => {
    const ed = new EditorCore()
    const frame = drawShape(ed, "frame", [0, 0], [400, 300])
    const near = drawShape(ed, "rectangle", [600, 100], [700, 200])
    const far = drawShape(ed, "rectangle", [600, 900], [700, 1000])
    ed.setTool("selection")
    ed.selectElements([near.id, far.id])
    dragBy(ed, [650, 150], -400, 0)
    expect(ed.scene.get(near.id)!.frameId).toBe(frame.id)
    expect(ed.scene.get(far.id)!.frameId).toBeNull()
  })
})
