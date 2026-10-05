import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../src/editor/editorCore"
import { getCommonBounds, getElementBounds } from "../src/geometry/elementBounds"
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

const drawWith = (ed: EditorCore, tool: "arrow" | "line" | "freedraw", path: [number, number][]) => {
  ed.setTool(tool)
  ed.pointerDown(ptr(path[0]![0], path[0]![1]))
  for (const p of path.slice(1)) ed.pointerMove(ptr(p[0], p[1]))
  const last = path[path.length - 1]!
  ed.pointerUp(ptr(last[0], last[1]))
  return ed.scene.getNonDeleted()[ed.scene.getNonDeleted().length - 1]!
}

/** Bounds a viewer would draw around the element, from its own points. */
const drawnExtent = (el: { x: number; y: number; points: readonly (readonly number[])[] }) => {
  const xs = el.points.map((p) => el.x + p[0]!)
  const ys = el.points.map((p) => el.y + p[1]!)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

describe("bounds of points-based elements", () => {
  const directions: [string, [number, number][]][] = [
    [
      "left and up",
      [
        [500, 300],
        [300, 200],
        [100, 100],
      ],
    ],
    [
      "right and down",
      [
        [100, 100],
        [300, 200],
        [500, 300],
      ],
    ],
    [
      "left and down",
      [
        [500, 100],
        [300, 200],
        [100, 300],
      ],
    ],
    [
      "right and up",
      [
        [100, 300],
        [300, 200],
        [500, 100],
      ],
    ],
  ]

  for (const [name, path] of directions) {
    test(`an arrow drawn ${name} reports the box it actually occupies`, () => {
      const ed = new EditorCore()
      const el = drawWith(ed, "arrow", path) as never
      expect(getElementBounds(el)).toEqual(drawnExtent(el))
    })
  }

  test("a line keeps x and y at the top-left of its box", () => {
    const ed = new EditorCore()
    const el = drawWith(ed, "line", [
      [400, 400],
      [200, 150],
    ]) as never as {
      x: number
      y: number
      width: number
      height: number
    }
    expect(el.x).toBeCloseTo(200)
    expect(el.y).toBeCloseTo(150)
    expect(el.width).toBeCloseTo(200)
    expect(el.height).toBeCloseTo(250)
  })

  test("a freehand stroke drawn up and left reports the right box", () => {
    const ed = new EditorCore()
    const el = drawWith(ed, "freedraw", [
      [400, 400],
      [350, 330],
      [300, 280],
      [260, 240],
    ]) as never
    expect(getElementBounds(el)).toEqual(drawnExtent(el))
  })

  test("a marquee that covers a leftward arrow selects it", () => {
    const ed = new EditorCore()
    const arrow = drawWith(ed, "arrow", [
      [500, 300],
      [100, 100],
    ])
    ed.clearSelection()

    ed.setTool("selection")
    ed.pointerDown(ptr(50, 50))
    ed.pointerMove(ptr(300, 200))
    ed.pointerMove(ptr(560, 360))
    ed.pointerUp(ptr(560, 360))
    expect(ed.appState.selectedElementIds[arrow.id]).toBe(true)
  })

  test("a marquee beside a leftward arrow leaves it alone", () => {
    const ed = new EditorCore()
    const arrow = drawWith(ed, "arrow", [
      [500, 300],
      [100, 100],
    ])
    ed.clearSelection()

    ed.setTool("selection")
    ed.pointerDown(ptr(600, 400))
    ed.pointerMove(ptr(800, 500))
    ed.pointerMove(ptr(900, 600))
    ed.pointerUp(ptr(900, 600))
    expect(ed.appState.selectedElementIds[arrow.id]).toBeUndefined()
  })

  test("common bounds cover every selected element", () => {
    const ed = new EditorCore()
    const a = drawWith(ed, "arrow", [
      [500, 300],
      [100, 100],
    ])
    const b = drawWith(ed, "arrow", [
      [600, 600],
      [900, 800],
    ])
    const common = getCommonBounds([a, b])
    expect(common[0]).toBeCloseTo(100)
    expect(common[1]).toBeCloseTo(100)
    expect(common[2]).toBeCloseTo(900)
    expect(common[3]).toBeCloseTo(800)
  })

  test("zoom to fit frames a leftward arrow", () => {
    const ed = new EditorCore()
    drawWith(ed, "arrow", [
      [500, 300],
      [100, 100],
    ])
    ed.clearSelection()
    ed.zoomToFit(800, 600)
    const { scrollX, scrollY, zoom } = ed.appState.viewport
    // the centre of the arrow should land near the centre of the viewport
    expect(-scrollX + 800 / zoom / 2).toBeCloseTo(300, 0)
    expect(-scrollY + 600 / zoom / 2).toBeCloseTo(200, 0)
  })
})
