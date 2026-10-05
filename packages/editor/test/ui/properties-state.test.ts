import { EditorCore, type NibElement, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { getTheme } from "../../src/theme/themes"
import { StyleGroupPanel } from "../../src/ui/style/panels"

const buttons = (markup: string): Record<string, string>[] =>
  [...markup.matchAll(/<button([^>]*)>/g)].map(([, attrs]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs!.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

// options are toggles (aria-pressed) or radios in a segmented control (aria-checked)
const pressed = (markup: string, label: string): boolean | undefined => {
  const b = buttons(markup).find((x) => x["aria-label"] === label)
  return b ? (b["aria-checked"] ?? b["aria-pressed"]) === "true" : undefined
}

// the style bar's Stroke and Fill popovers, which hold the width, sloppiness and fill style controls
const render = (core: EditorCore): string =>
  (["stroke", "fill"] as const)
    .map((group) =>
      renderToStaticMarkup(createElement(StyleGroupPanel, { core, theme: getTheme("whiteboard"), group })),
    )
    .join("")

const withSelection = (els: NibElement[]): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() })
  core.selectElements(els.map((e) => e.id))
  return core
}

describe("properties panel reflects the real selection state", () => {
  it("does not mark any stroke width as active when the selection mixes widths", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, strokeWidth: 1 })
    const b = newElement("rectangle", { x: 100, y: 0, width: 50, height: 50, strokeWidth: 4 })
    const markup = render(withSelection([a, b]))
    expect(pressed(markup, "Thin")).toBe(false)
    expect(pressed(markup, "Extra bold")).toBe(false)
  })

  it("does not mark any sloppiness as active when the selection mixes roughness", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, roughness: 0 })
    const b = newElement("ellipse", { x: 100, y: 0, width: 50, height: 50, roughness: 2 })
    const markup = render(withSelection([a, b]))
    expect(pressed(markup, "Architect")).toBe(false)
    expect(pressed(markup, "Cartoonist")).toBe(false)
  })
})

describe("fill style of a filled line is read from the line", () => {
  it("shows the selected closed line's own fill style, not the tool default", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 0],
      ],
      polygon: true,
      backgroundColor: "#ffc9c9",
      fillStyle: "cross-hatch",
    } as never)
    const markup = render(withSelection([line]))
    expect(pressed(markup, "Cross-hatch")).toBe(true)
  })
})
