import { describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { parseNib } from "../../src/io/nibFile"
import { DEFAULT_APP_STATE } from "../../src/model/types"

const PAYLOAD = '0)"/><script>alert(1)</script><g a="'

const svgFor = (elements: unknown[]): string => {
  const parsed = parseNib(JSON.stringify({ type: "nib", version: 1, elements, appState: {} }))
  if (!parsed.ok) throw new Error(parsed.error)
  return exportToSvg({
    elements: parsed.elements,
    appState: DEFAULT_APP_STATE,
    exportBackground: false,
    exportPadding: 10,
    scale: 1,
    theme: "light",
  })
}

// Geometry fields from an untrusted file are interpolated raw into SVG attributes.
describe("SVG export cannot be broken out of by non-numeric geometry", () => {
  test("string x/y on a shape does not inject markup", () => {
    const svg = svgFor([{ id: "a", type: "rectangle", x: PAYLOAD, y: 0, width: 10, height: 10 }])
    expect(svg).not.toContain("<script")
  })

  test("string x on a rotated shape does not inject markup", () => {
    const svg = svgFor([{ id: "a", type: "ellipse", x: PAYLOAD, y: 0, width: 10, height: 10, angle: 1 }])
    expect(svg).not.toContain("<script")
  })

  test("string width on right-aligned text does not inject markup", () => {
    const svg = svgFor([
      { id: "t", type: "text", x: 0, y: 0, width: PAYLOAD, height: 20, text: "hi", textAlign: "right" },
    ])
    expect(svg).not.toContain("<script")
  })

  test("string width on a flipped image does not inject markup", () => {
    const elements = [
      { id: "i", type: "image", x: 0, y: 0, width: PAYLOAD, height: 20, fileId: "f", scale: [-1, 1] },
    ]
    const parsed = parseNib(
      JSON.stringify({
        type: "nib",
        version: 1,
        elements,
        appState: {},
        files: { f: { id: "f", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 } },
      }),
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const svg = exportToSvg({
      elements: parsed.elements,
      appState: DEFAULT_APP_STATE,
      files: parsed.files,
      exportBackground: false,
      exportPadding: 10,
      scale: 1,
      theme: "light",
    })
    expect(svg).not.toContain("<script")
  })
})
