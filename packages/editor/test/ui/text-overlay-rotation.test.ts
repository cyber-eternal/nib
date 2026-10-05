import { EditorCore, layoutStandaloneText, newElement, sceneToScreen, setTextMeasurer } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TextEditorOverlay } from "../../src/canvas/TextEditorOverlay"

type Mat = [number, number, number, number, number, number]
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

const angleOf = (v: string): number => {
  const n = Number.parseFloat(v)
  if (v.endsWith("deg")) return (n * Math.PI) / 180
  if (v.endsWith("turn")) return n * 2 * Math.PI
  return n
}

const parseTransform = (value: string): Mat => {
  let m: Mat = [1, 0, 0, 1, 0, 0]
  for (const [, fn, args] of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const parts = args!.split(/[ ,]+/).filter(Boolean)
    if (fn === "rotate") {
      const t = angleOf(parts[0]!)
      m = mul(m, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0])
    } else if (fn === "translate") {
      m = mul(m, [1, 0, 0, 1, Number.parseFloat(parts[0]!), Number.parseFloat(parts[1] ?? "0")])
    } else if (fn === "translateX") {
      m = mul(m, [1, 0, 0, 1, Number.parseFloat(parts[0]!), 0])
    } else if (fn === "translateY") {
      m = mul(m, [1, 0, 0, 1, 0, Number.parseFloat(parts[0]!)])
    }
  }
  return m
}

const originAxis = (token: string | undefined, size: number): number => {
  if (token === undefined || token === "center") return size / 2
  if (token === "left" || token === "top") return 0
  if (token === "right" || token === "bottom") return size
  if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * size
  return Number.parseFloat(token)
}

const parseStyle = (markup: string): Record<string, string> => {
  const style = /style="([^"]*)"/.exec(markup)?.[1] ?? ""
  const out: Record<string, string> = {}
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":")
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  return out
}

describe("text overlay rotation pivot", () => {
  it("places a rotated text editor over the rotated text, pivoting on the element centre", () => {
    // fixed-width glyphs so the overlay box and the element box are the same size
    setTextMeasurer(() => 20)
    const core = new EditorCore()
    const text = layoutStandaloneText(
      newElement("text", {
        x: 200,
        y: 100,
        width: 0,
        height: 25,
        fontSize: 20,
        text: "ab",
        originalText: "ab",
        angle: Math.PI / 2,
        index: core.scene.nextIndex(),
      }),
    )
    core.scene.insert(text)
    core.setAppState({ editingTextId: text.id })

    const markup = renderToStaticMarkup(createElement(TextEditorOverlay, { core, version: 0 }))
    const style = parseStyle(markup)
    const left = Number.parseFloat(style.left!)
    const top = Number.parseFloat(style.top!)
    const width = Number.parseFloat(style.width!)
    const height = Number.parseFloat(style.height ?? style["min-height"]!)
    const [ox, oy] = (style["transform-origin"] ?? "50% 50%").split(/\s+/)
    const origin = [originAxis(ox, width), originAxis(oy, height)] as const
    const m = parseTransform(style.transform ?? "")
    const local = [width / 2 - origin[0], height / 2 - origin[1]] as const
    const overlayCentre = [
      left + origin[0] + m[0] * local[0] + m[2] * local[1] + m[4],
      top + origin[1] + m[1] * local[0] + m[3] * local[1] + m[5],
    ]

    const el = core.scene.get(text.id)!
    const expected = sceneToScreen([el.x + el.width / 2, el.y + el.height / 2], core.appState.viewport)
    expect(overlayCentre[0]).toBeCloseTo(expected[0], 0)
    expect(overlayCentre[1]).toBeCloseTo(expected[1], 0)
  })
})
