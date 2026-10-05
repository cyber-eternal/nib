import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../src/editor/editorCore"
import type { ArrowElement } from "../src/model/types"
import { setTextMeasurer } from "../src/render/textMeasure"
import type { PointerInput } from "../src/tools/types"

beforeAll(() => setTextMeasurer((t) => t.length * 9))

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

/** A click: press and release without moving. */
const click = (ed: EditorCore, at: [number, number]) => {
  ed.pointerDown(ptr(at[0], at[1]))
  ed.pointerUp(ptr(at[0], at[1]))
}

const hover = (ed: EditorCore, at: [number, number]) => ed.pointerMove(ptr(at[0], at[1]))

const rect = (ed: EditorCore, a: [number, number], b: [number, number]) => {
  ed.setTool("rectangle")
  ed.pointerDown(ptr(a[0], a[1]))
  ed.pointerMove(ptr(b[0], b[1]))
  ed.pointerUp(ptr(b[0], b[1]))
  return ed.scene.getNonDeleted()[ed.scene.getNonDeleted().length - 1]!
}

const theArrow = (ed: EditorCore) =>
  ed.scene.getNonDeleted().find((e) => e.type === "arrow") as ArrowElement | undefined

const absolute = (a: ArrowElement): [number, number][] => a.points.map((p) => [a.x + p[0], a.y + p[1]])

describe("click to connect", () => {
  const twoShapes = () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [200, 120])
    const b = rect(ed, [400, 0], [600, 120])
    ed.setTool("arrow")
    return { ed, a, b }
  }

  test("click one shape then the other makes a bound connector", () => {
    const { ed, a, b } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [300, 60])
    click(ed, [500, 60])

    const arrow = theArrow(ed)!
    expect(arrow.startBinding?.elementId).toBe(a.id)
    expect(arrow.endBinding?.elementId).toBe(b.id)
    expect(arrow.points).toHaveLength(2)
  })

  test("the connector stops at each border instead of the centres", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [300, 60])
    click(ed, [500, 60])

    const pts = absolute(theArrow(ed)!)
    expect(pts[0]![0]).toBeGreaterThanOrEqual(200)
    expect(pts[0]![0]).toBeLessThan(260)
    expect(pts[1]![0]).toBeLessThanOrEqual(400)
    expect(pts[1]![0]).toBeGreaterThan(340)
  })

  test("finishing returns to the selection tool with the arrow selected", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    click(ed, [500, 60])

    const arrow = theArrow(ed)!
    expect(ed.appState.activeTool).toBe("selection")
    expect(ed.appState.selectedElementIds[arrow.id]).toBe(true)
  })

  test("both shapes record the arrow that joins them", () => {
    const { ed, a, b } = twoShapes()
    click(ed, [100, 60])
    click(ed, [500, 60])
    const arrow = theArrow(ed)!

    for (const id of [a.id, b.id]) {
      expect(ed.scene.get(id)!.boundElements?.some((x) => x.id === arrow.id)).toBe(true)
    }
  })

  test("the tail leaves the border while the head is still being placed", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [320, 60])

    const pts = absolute(theArrow(ed)!)
    expect(pts[0]![0]).toBeGreaterThanOrEqual(200)
  })

  test("clicking empty canvas adds a bend instead of finishing", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [300, 300])
    click(ed, [300, 300])

    const arrow = theArrow(ed)!
    expect(arrow.points.length).toBeGreaterThan(2)
    expect(arrow.endBinding).toBeNull()
    expect(ed.appState.activeTool).toBe("arrow")
  })

  test("a bend then a shape still finishes on that shape", () => {
    const { ed, b } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [300, 300])
    click(ed, [300, 300])
    hover(ed, [500, 60])
    click(ed, [500, 60])

    const arrow = theArrow(ed)!
    expect(arrow.endBinding?.elementId).toBe(b.id)
    expect(ed.appState.activeTool).toBe("selection")
  })

  test("Escape abandons a connector that was only started", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    ed.keyDown({ key: "Escape", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false })
    expect(theArrow(ed)).toBeUndefined()
  })
})

describe("hover feedback", () => {
  test("the shape under the pointer is highlighted before any click", () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [200, 120])
    ed.setTool("arrow")

    hover(ed, [100, 60])
    expect(ed.bindingHighlight?.id).toBe(a.id)

    hover(ed, [900, 900])
    expect(ed.bindingHighlight).toBeNull()
  })

  test("the highlight clears when the tool changes", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    ed.setTool("arrow")
    hover(ed, [100, 60])
    expect(ed.bindingHighlight).not.toBeNull()

    ed.setTool("selection")
    expect(ed.bindingHighlight).toBeNull()
  })

  test("the target shape is highlighted while the head is being placed", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    const b = rect(ed, [400, 0], [600, 120])
    ed.setTool("arrow")

    click(ed, [100, 60])
    hover(ed, [500, 60])
    expect(ed.bindingHighlight?.id).toBe(b.id)
  })
})

describe("connection dots", () => {
  const twoShapes = () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [200, 120])
    const b = rect(ed, [400, 0], [600, 120])
    ed.setTool("arrow")
    return { ed, a, b }
  }

  test("no dots before the connector is started", () => {
    const { ed } = twoShapes()
    hover(ed, [100, 60])
    expect(ed.bindingHints).toHaveLength(0)
  })

  test("the tail dot sits on the first shape's border", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [320, 60])

    expect(ed.bindingHints.length).toBeGreaterThanOrEqual(1)
    const tail = ed.bindingHints[0]!
    expect(tail[0]).toBeGreaterThanOrEqual(198)
    expect(tail[0]).toBeLessThan(260)
  })

  test("a second dot appears on the shape under the head", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [500, 60])

    expect(ed.bindingHints).toHaveLength(2)
    const head = ed.bindingHints[1]!
    expect(head[0]).toBeLessThanOrEqual(402)
    expect(head[0]).toBeGreaterThan(340)
  })

  test("the head dot disappears when the pointer leaves the shape", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    hover(ed, [500, 60])
    expect(ed.bindingHints).toHaveLength(2)

    hover(ed, [320, 400])
    expect(ed.bindingHints).toHaveLength(1)
  })

  test("dots clear once the connector is finished", () => {
    const { ed } = twoShapes()
    click(ed, [100, 60])
    click(ed, [500, 60])
    expect(ed.bindingHints).toHaveLength(0)
  })

  test("dragging an existing endpoint onto a shape shows a dot there", () => {
    const { ed, b } = twoShapes()
    click(ed, [100, 60])
    click(ed, [500, 60])
    const arrow = theArrow(ed)!

    ed.setTool("selection")
    ed.selectElements([arrow.id])
    ed.setAppState({ editingLinearElementId: arrow.id })

    const pts = absolute(ed.scene.get(arrow.id) as ArrowElement)
    const tip = pts[pts.length - 1]!
    ed.pointerDown(ptr(tip[0], tip[1]))
    ed.pointerMove(ptr(520, 80))

    expect(ed.bindingHighlight?.id).toBe(b.id)
    expect(ed.bindingHints).toHaveLength(1)

    ed.pointerUp(ptr(520, 80))
    expect(ed.bindingHints).toHaveLength(0)
  })
})
