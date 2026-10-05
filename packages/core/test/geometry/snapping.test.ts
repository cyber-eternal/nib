import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { draw, ptr } from "./helpers"

describe("object snapping ignores what is being dragged along", () => {
  test("dragging a connected shape straight down never shifts it sideways", () => {
    const ed = new EditorCore()
    const a = draw(ed, "rectangle", [0, 0], [100, 100])
    draw(ed, "rectangle", [400, 237], [500, 363])
    draw(ed, "arrow", [50, 50], [450, 300])
    ed.setAppState({ objectsSnapMode: true })
    ed.clearSelection()
    ed.setTool("selection")
    ed.pointerDown(ptr(50, 1))
    let y = 1
    const drift: number[] = []
    for (let i = 0; i < 20; i++) {
      y += 2
      ed.pointerMove(ptr(50, y))
      drift.push(ed.scene.get(a.id)!.x - a.x)
    }
    ed.pointerUp(ptr(50, y))
    expect(
      drift.every((d) => Math.abs(d) < 1e-6),
      drift.join(","),
    ).toBe(true)
  })
})
