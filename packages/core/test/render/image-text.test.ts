import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { cropElement, fullCrop } from "../../src/geometry/crop"
import { newElement } from "../../src/model/element"
import type { ImageElement } from "../../src/model/types"
import { drawElement } from "../../src/render/drawElement"
import { ShapeCache } from "../../src/render/shapes"
import { setTextMeasurer } from "../../src/render/textMeasure"
import type { PointerInput } from "../../src/tools/types"
import { recordingCanvas } from "./mockCanvas"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

const ptr = (x: number, y: number): PointerInput => ({
  scene: [x, y],
  screen: [x, y],
  buttons: 1,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  pressure: 0.5,
  detail: 1,
})

/** Which source column the renderer paints at page x, read back from the recorded drawImage. */
const sourceXAt = (el: ImageElement, pageX: number, pageY: number): number => {
  const r = recordingCanvas()
  drawElement(r.ctx, el, {
    theme: "light",
    cache: new ShapeCache(),
    resolveImage: () => ({ image: {}, width: 200, height: 100 }),
  })
  const call = r.calls.find((c) => c.op === "drawImage") as (typeof r.calls)[number] & {
    matrix: [number, number, number, number, number, number]
  }
  const [a, b, c, d, e, f] = call.matrix
  const det = a * d - b * c
  const lx = (d * (pageX - e) - c * (pageY - f)) / det
  const [, sx, , sw, , , , dw] = call.args as number[]
  return sx! + (lx * sw!) / dw!
}

describe("cropping a flipped image keeps the pixels under the untouched edge", () => {
  test("dragging the west handle of a horizontally flipped image trims what is on the left", () => {
    const base = newElement("image", {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      fileId: "f",
      status: "saved",
      scale: [-1, 1],
      crop: fullCrop(200, 100),
    }) as ImageElement
    const before = sourceXAt(base, 150, 50)
    const cropped = cropElement(base, "w", [60, 50])
    expect(cropped.x).toBeCloseTo(60)
    const after = sourceXAt(cropped, 150, 50)
    expect(after).toBeCloseTo(before, 1)
  })
})

describe("container labels rotate with their container", () => {
  test("rotating a labelled rectangle rotates its label to the same angle", () => {
    const ed = new EditorCore()
    const rect = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50, index: "a0" })
    ed.scene.insert(rect)
    ed.startEditingLabel(rect)
    const labelId = ed.appState.editingTextId!
    ed.commitText(labelId, "Hello")
    ed.selectElements([rect.id])
    // rotation handle sits above the top edge centre: (50, 0 - 6 - 18)
    ed.pointerDown(ptr(50, -24))
    ed.pointerMove(ptr(120, 0))
    ed.pointerMove(ptr(200, 25))
    ed.pointerUp(ptr(200, 25))
    const container = ed.scene.get(rect.id)!
    const label = ed.scene.get(labelId)!
    expect(container.angle).toBeCloseTo(Math.PI / 2, 2)
    expect(label.angle).toBeCloseTo(container.angle, 2)
  })
})

describe("a pencil tap leaves a dot", () => {
  test("pointer down/up without moving creates a freedraw dot", () => {
    const ed = new EditorCore()
    ed.setTool("freedraw")
    ed.pointerDown(ptr(10, 10))
    ed.pointerUp(ptr(10, 10))
    const els = ed.scene.getNonDeleted()
    expect(els).toHaveLength(1)
    expect(els[0]!.type).toBe("freedraw")
  })
})
