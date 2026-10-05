import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { drawArrow, drawShape, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const connected = () => {
  const ed = new EditorCore()
  const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
  const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
  const arrow = drawArrow(ed, [50, 50], [350, 50])
  return { ed, a, b, arrow }
}

describe("eraser", () => {
  test("erasing a shape keeps the arrows connected to it", () => {
    const { ed, arrow } = connected()
    expect(arrow.startBinding).not.toBeNull()
    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 50))
    ed.pointerUp(ptr(0, 50))
    expect(ed.scene.get(arrow.id)!.isDeleted).toBe(false)
  })

  test("erasing an arrow unlinks it from the shapes it was bound to", () => {
    const { ed, a, b, arrow } = connected()
    ed.setTool("eraser")
    ed.pointerDown(ptr(200, 50))
    ed.pointerUp(ptr(200, 50))
    expect(ed.scene.get(arrow.id)!.isDeleted).toBe(true)
    expect((ed.scene.get(a.id)!.boundElements ?? []).some((r) => r.id === arrow.id)).toBe(false)
    expect((ed.scene.get(b.id)!.boundElements ?? []).some((r) => r.id === arrow.id)).toBe(false)
  })

  test("a fast eraser stroke erases what it passes over between samples", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [100, 0], [150, 50])
    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(300, 25))
    ed.pointerUp(ptr(300, 25))
    expect(ed.scene.get(rect.id)!.isDeleted).toBe(true)
  })
})
