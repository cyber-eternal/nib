import { EditorCore, type NibElement, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { getTheme } from "../../src/theme/themes"
import { CanvasBackgroundPicker } from "../../src/ui/style/CanvasBackgroundPicker"
import { StyleBar } from "../../src/ui/style/StyleBar"
import { styleModel } from "../../src/ui/style/model"
import { moreMenuSections } from "../../src/ui/style/moreMenu"
import { ARROWHEAD_OPTIONS } from "../../src/ui/style/options"
import { StyleGroupPanel } from "../../src/ui/style/panels"

const theme = getTheme("whiteboard")
const noop = () => {}

const attrsOf = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))].map(([, attrs = ""]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

const coreWith = (els: NibElement[]): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() })
  core.selectElements(els.map((e) => e.id))
  return core
}

const rect = (patch: Record<string, unknown> = {}) =>
  newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, ...patch } as never)

const bar = (core: EditorCore) =>
  renderToStaticMarkup(createElement(StyleBar, { core, theme, onRequestLink: noop }))

const panel = (core: EditorCore, group: string) =>
  renderToStaticMarkup(createElement(StyleGroupPanel, { core, theme, group: group as never }))

describe("StyleBar markup", () => {
  it("renders nothing when there is nothing to style", () => {
    expect(bar(new EditorCore())).toBe("")
  })

  it("is a labelled toolbar of popover buttons for the selection's groups", () => {
    const markup = bar(coreWith([rect()]))
    const toolbar = attrsOf(markup, "div").find((d) => d.role === "toolbar")!
    expect(toolbar["aria-label"]).toBe("Style")
    const labels = attrsOf(markup, "button").map((b) => b["aria-label"])
    expect(labels).toEqual(["Stroke colour", "Fill", "Stroke", "Edges", "Opacity", "Arrange", "More actions"])
    const more = attrsOf(markup, "button").find((b) => b["aria-label"] === "More actions")!
    expect(more["aria-haspopup"]).toBe("menu")
    const fill = attrsOf(markup, "button").find((b) => b["aria-label"] === "Fill")!
    expect(fill["aria-haspopup"]).toBe("dialog")
    expect(fill["aria-expanded"]).toBe("false")
    expect(fill["aria-keyshortcuts"]).toBeTruthy()
  })

  it("shows a Closed shape toggle for lines", () => {
    const l = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    } as never)
    const closed = attrsOf(bar(coreWith([l])), "button").find((b) => b["aria-label"] === "Closed shape")!
    expect(closed["aria-pressed"]).toBe("false")
  })

  it("draws a dash for a mixed stroke colour instead of the first element's", () => {
    const markup = bar(coreWith([rect({ strokeColor: "#e03131" }), rect({ x: 80, strokeColor: "#1971c2" })]))
    expect(markup).toContain('class="sc-stylebar-cap" data-mixed="true"')
  })
})

describe("popover contents", () => {
  it("fill style offers zigzag and stays present but disabled for a transparent fill", () => {
    const radios = attrsOf(panel(coreWith([rect()]), "fill"), "button").filter((b) => b.role === "radio")
    expect(radios.map((r) => r["aria-label"])).toEqual(["Hachure", "Cross-hatch", "Solid", "Zigzag"])
    for (const r of radios) expect("disabled" in r).toBe(true)
  })

  it("names every swatch and the hex field", () => {
    const markup = panel(coreWith([rect({ strokeColor: "#e03131" })]), "strokeColor")
    const swatches = attrsOf(markup, "button").filter((b) => b.class === "sc-swatch")
    expect(swatches.length).toBeGreaterThan(13)
    for (const s of swatches) expect(s["aria-label"]).not.toMatch(/#/)
    expect(swatches.filter((s) => s["aria-pressed"] === "true").length).toBeGreaterThan(0)
    expect(markup).toContain(">Hex</label>")
    expect(markup).toContain('value="e03131"')
  })

  it("shows every arrowhead as an icon option, none cut off", () => {
    const a = newElement("arrow", {
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
      endArrowhead: "triangle",
    } as never)
    const markup = panel(coreWith([a]), "arrow")
    expect(ARROWHEAD_OPTIONS).toHaveLength(13)
    const groups = attrsOf(markup, "div").filter((d) => d.role === "group")
    expect(groups.map((g) => g["aria-label"])).toEqual(["Start arrowhead", "End arrowhead"])
    expect(markup).not.toContain("<select")
    const pressed = attrsOf(markup, "button").filter((b) => b["aria-pressed"] === "true")
    expect(pressed.map((b) => b["aria-label"])).toEqual(["None", "Triangle"])
  })

  it("text offers the five families, size presets plus a custom field, and alignment", () => {
    const t = newElement("text", { x: 0, y: 0, width: 30, height: 20, text: "a", originalText: "a" } as never)
    const markup = panel(coreWith([t]), "text")
    const radios = attrsOf(markup, "button").filter((b) => b.role === "radio")
    for (const name of [
      "Hand-drawn",
      "Normal",
      "Code",
      "Serif",
      "Mono",
      "Small",
      "Extra large",
      "Centre text",
    ])
      expect(
        radios.some((r) => r["aria-label"] === name),
        name,
      ).toBe(true)
    expect(markup).toContain('aria-label="Font size in pixels"')
    expect(markup).not.toContain('aria-label="Vertical align"')
  })

  it("opacity is a slider with a tabular readout, Mixed for a mixed selection", () => {
    const markup = panel(coreWith([rect({ opacity: 40 }), rect({ x: 80, opacity: 100 })]), "opacity")
    expect(markup).toContain('type="range"')
    expect(markup).toContain(">Mixed</output>")
  })

  it("arrange shows align only for two or more units", () => {
    expect(panel(coreWith([rect()]), "arrange")).not.toContain('aria-label="Align left"')
    expect(panel(coreWith([rect(), rect({ x: 100 })]), "arrange")).toContain('aria-label="Align left"')
  })
})

describe("More actions menu", () => {
  const sections = (core: EditorCore) =>
    moreMenuSections(core, styleModel(core)!, { onRequestLink: noop, onTidy: noop, notify: noop })

  it("ends with Delete alone in an isolated danger section", () => {
    const s = sections(coreWith([rect()]))
    const last = s[s.length - 1]!
    expect(last.isolated).toBe(true)
    expect(last.items.map((i) => [i.label, i.danger])).toEqual([["Delete", true]])
  })

  it("offers Group only for two units and Ungroup only for a group", () => {
    const ids = (core: EditorCore) => sections(core).flatMap((s) => s.items.map((i) => i.id))
    expect(ids(coreWith([rect()]))).not.toContain("group")
    expect(ids(coreWith([rect(), rect({ x: 100 })]))).toContain("group")
    const grouped = coreWith([rect({ groupIds: ["g"] }), rect({ x: 100, groupIds: ["g"] })])
    expect(ids(grouped)).toContain("ungroup")
    expect(ids(grouped)).not.toContain("group")
  })

  it("offers text container actions when they apply", () => {
    const t = newElement("text", { x: 0, y: 0, width: 30, height: 20, text: "a", originalText: "a" } as never)
    const ids = sections(coreWith([t])).flatMap((s) => s.items.map((i) => i.id))
    expect(ids).toEqual(expect.arrayContaining(["wrap-rectangle", "wrap-diamond", "wrap-ellipse"]))
    const bindIds = sections(coreWith([t, rect({ x: 100 })])).flatMap((s) => s.items.map((i) => i.id))
    expect(bindIds).toContain("bind-text")
  })

  it("says where Unlock went after Lock, since locking takes the bar away", () => {
    const r = rect()
    const core = coreWith([r])
    const notify = vi.fn()
    const lock = moreMenuSections(core, styleModel(core)!, { onRequestLink: noop, onTidy: noop, notify })
      .flatMap((s) => s.items)
      .find((i) => i.id === "lock")!
    expect(lock.label).toBe("Lock")
    lock.onSelect()
    expect(core.scene.get(r.id)!.locked).toBe(true)
    expect(notify).toHaveBeenCalledWith("Locked. Right-click it to unlock.")
  })

  it("offers Unlock for a selected locked element and unlocks just that one", () => {
    const locked = rect({ locked: true })
    const core = new EditorCore()
    core.scene.insert({ ...locked, index: core.scene.nextIndex() })
    core.setAppState({ selectedElementIds: { [locked.id]: true } })
    const item = sections(core)
      .flatMap((s) => s.items)
      .find((i) => i.id === "lock")!
    expect(item.label).toBe("Unlock")
    item.onSelect()
    expect(core.scene.get(locked.id)!.locked).toBe(false)
  })
})

describe("CanvasBackgroundPicker", () => {
  it("shows the theme board as the default and marks the current colour", () => {
    const core = new EditorCore()
    const markup = renderToStaticMarkup(createElement(CanvasBackgroundPicker, { core, theme }))
    const first = attrsOf(markup, "button").find((b) => b.class === "sc-swatch")!
    expect(first["aria-label"]).toBe("Theme default")
    expect(first["aria-pressed"]).toBe("true")
  })
})
