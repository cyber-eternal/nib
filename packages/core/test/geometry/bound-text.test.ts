import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { layoutBoundText } from "../../src/geometry/boundText"
import { pointInPolygon } from "../../src/geometry/hitTest"
import { elementCenter, elementOutline } from "../../src/geometry/outline"
import type { Point } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import type { NibElement, TextElement } from "../../src/model/types"
import { selectionHandleSet } from "../../src/render/interactiveScene"
import { setTextMeasurer } from "../../src/render/textMeasure"
import { drag, draw, rotateSelection } from "./helpers"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

const label = (ed: EditorCore, container: NibElement, text: string): TextElement => {
  ed.startEditingLabel(ed.scene.get(container.id)!)
  const t = ed.scene.getNonDeleted().find((e) => e.type === "text" && e.containerId === container.id)!
  ed.commitText(t.id, text)
  return ed.scene.get(t.id) as TextElement
}

describe("labels follow their container's rotation", () => {
  test("rotating a labelled shape rotates its label", () => {
    const ed = new EditorCore()
    const rect = draw(ed, "rectangle", [0, 0], [200, 100])
    const text = label(ed, rect, "hello")
    ed.selectElements([rect.id])
    rotateSelection(ed, (c) => [c[0] + 300, c[1]])
    const r = ed.scene.get(rect.id)!
    const t = ed.scene.get(text.id)!
    expect(r.angle).toBeCloseTo(Math.PI / 2, 5)
    expect(t.angle).toBeCloseTo(r.angle, 5)
  })

  test("rotating several labelled shapes carries each label with its shape", () => {
    const ed = new EditorCore()
    const a = draw(ed, "rectangle", [0, 0], [200, 100])
    const b = draw(ed, "rectangle", [400, 0], [600, 100])
    const ta = label(ed, a, "hi")
    const tb = label(ed, b, "hi")
    ed.selectElements([a.id, b.id])
    rotateSelection(ed, (c) => [c[0] + 500, c[1]])
    for (const [shape, text] of [
      [a, ta],
      [b, tb],
    ] as const) {
      const sc = elementCenter(ed.scene.get(shape.id)!)
      const tc = elementCenter(ed.scene.get(text.id)!)
      expect(Math.hypot(sc[0] - tc[0], sc[1] - tc[1])).toBeLessThan(1)
    }
  })
})

const corners = (t: TextElement): Point[] => [
  [t.x, t.y],
  [t.x + t.width, t.y],
  [t.x + t.width, t.y + t.height],
  [t.x, t.y + t.height],
]

describe("labels stay inside ellipses and diamonds whatever the alignment", () => {
  const words = "aaaa aaaa aaaa aaaa aaaa aaaa"
  const cases: [string, "ellipse" | "diamond", "left" | "center" | "right", "top" | "middle" | "bottom"][] = [
    ["ellipse left/middle", "ellipse", "left", "middle"],
    ["ellipse center/top", "ellipse", "center", "top"],
    ["ellipse right/bottom", "ellipse", "right", "bottom"],
    ["diamond left/top", "diamond", "left", "top"],
    ["diamond right/middle", "diamond", "right", "middle"],
  ]
  for (const [name, type, textAlign, verticalAlign] of cases) {
    test(`${name}`, () => {
      const container = newElement(type, { x: 0, y: 0, width: 200, height: 100 })
      const text = newElement("text", {
        text: words,
        originalText: words,
        containerId: container.id,
        fontSize: 20,
        textAlign,
        verticalAlign,
      })
      const laid = layoutBoundText(container, text)
      const outline = elementOutline(laid.container)
      for (const c of corners(laid.text)) expect(pointInPolygon(c, outline)).toBe(true)
    })
  }
})

describe("arrow labels sit on the middle of the drawn path", () => {
  test("a three-point elbow-ish arrow puts its label on the middle vertex", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    })
    const text = newElement("text", { text: "ab", originalText: "ab", containerId: arrow.id, fontSize: 20 })
    const c = elementCenter(layoutBoundText(arrow, text).text)
    // path length 200, halfway is the corner at (100, 0)
    expect(c[0]).toBeCloseTo(100, 0)
    expect(c[1]).toBeCloseTo(0, 0)
  })

  test("a curved three-point arrow puts its label on the curve", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [100, 100],
        [200, 0],
      ],
    })
    const text = newElement("text", { text: "ab", originalText: "ab", containerId: arrow.id, fontSize: 20 })
    const c = elementCenter(layoutBoundText(arrow, text).text)
    expect(c[0]).toBeCloseTo(100, 0)
    expect(c[1]).toBeCloseTo(100, 0)
  })
})

describe("a label's minimum height respects the resize anchor", () => {
  test("dragging the top edge of a labelled shape down never moves its bottom edge", () => {
    const ed = new EditorCore()
    const rect = draw(ed, "rectangle", [0, 0], [200, 200])
    label(ed, rect, "one two three four five six")
    ed.selectElements([rect.id])
    const n = selectionHandleSet(ed.selectedElements(), 1)!.handles.n!
    ed.setTool("selection")
    drag(ed, [n[0], n[1]], [n[0], 180])
    const r = ed.scene.get(rect.id)!
    expect(r.y + r.height).toBeCloseTo(200, 5)
  })
})
