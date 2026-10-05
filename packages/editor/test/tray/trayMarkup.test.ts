import { EditorCore, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { getTheme } from "../../src/theme/themes"
import { ICON_STROKE, Icons } from "../../src/ui/Icons"
import { FreehandOptions } from "../../src/ui/tray/FreehandOptions"
import { MarkerTray } from "../../src/ui/tray/MarkerTray"
import { MoreDrawer } from "../../src/ui/tray/MoreDrawer"
import { DRAWER_ITEMS, armPen, writePencilDefault } from "../../src/ui/tray/trayModel"

const noop = () => {}
const prefs = { get: () => null, set: noop }

const attrsOf = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))].map(([, attrs = ""]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

const render = (core: EditorCore, extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    createElement(MarkerTray, {
      core,
      caps: getTheme("whiteboard").caps,
      prefs,
      onInsertImage: noop,
      onOpenMermaid: noop,
      ...extra,
    }),
  )

const tools = (markup: string) => attrsOf(markup, "button").filter((b) => b["data-tool"])

describe("MarkerTray markup", () => {
  it("is one labelled toolbar with a single tab stop", () => {
    const markup = render(new EditorCore())
    const bar = attrsOf(markup, "div").find((d) => d.role === "toolbar")!
    expect(bar["aria-label"]).toBe("Tools")
    expect(bar["aria-orientation"]).toBe("horizontal")
    expect(markup).toContain('class="tray-dock"')
  })

  it("renders the twelve tray markers in order with names, keys and aria-pressed", () => {
    const list = tools(render(new EditorCore()))
    expect(list.map((b) => b["data-tool"])).toEqual([
      "selection",
      "hand",
      "rectangle",
      "diamond",
      "parallelogram",
      "ellipse",
      "arrow",
      "line",
      "freedraw",
      "pencil",
      "text",
      "eraser",
    ])
    for (const b of list) {
      expect(b["aria-label"]).toBeTruthy()
      expect(b["aria-pressed"]).toMatch(/^(true|false)$/)
    }
    const pencil = list.find((b) => b["data-tool"] === "pencil")!
    expect(pencil["aria-keyshortcuts"]).toBe("P")
    expect(pencil["aria-label"]).toBe("Pencil, snaps shapes")
    const parallelogram = list.find((b) => b["data-tool"] === "parallelogram")!
    expect(parallelogram["aria-keyshortcuts"]).toBe("G")
    expect(parallelogram["aria-label"]).toBe("Parallelogram")
    const pen = list.find((b) => b["data-tool"] === "freedraw")!
    expect(pen["aria-keyshortcuts"]).toBe("7")
    expect(pen["aria-label"]).toBe("Pen")
  })

  it("lifts the active tool and only it", () => {
    const core = new EditorCore()
    core.setTool("pencil")
    const list = tools(render(core))
    expect(list.filter((b) => b["aria-pressed"] === "true").map((b) => b["data-tool"])).toEqual(["pencil"])
    const slots = attrsOf(render(core), "span").filter((s) => s.class === "tray-slot")
    expect(slots.filter((s) => "data-lifted" in s)).toHaveLength(1)
  })

  it("gives the held pen an options popup, and other markers none", () => {
    const core = new EditorCore()
    core.setTool("freedraw")
    const pen = tools(render(core)).find((b) => b["data-tool"] === "freedraw")!
    expect(pen["aria-haspopup"]).toBe("dialog")
    expect(pen["aria-expanded"]).toBe("false")
    core.setTool("rectangle")
    const rect = tools(render(core)).find((b) => b["data-tool"] === "rectangle")!
    expect(rect["aria-haspopup"]).toBeUndefined()
  })

  it("has a More disclosure that lifts and shows the held drawer tool", () => {
    const core = new EditorCore()
    let more = attrsOf(render(core), "button").find((b) => b["data-testid"] === "tray-more")!
    expect(more["aria-haspopup"]).toBe("dialog")
    expect(more["aria-expanded"]).toBe("false")
    expect(more["aria-label"]).toBe("More tools")
    expect(more["data-lifted"]).toBeUndefined()
    core.setTool("frame")
    more = attrsOf(render(core), "button").find((b) => b["data-testid"] === "tray-more")!
    expect(more["aria-label"]).toBe("More tools (Frame selected)")
    expect(more["data-lifted"]).toBe("true")
  })

  it("shows five named caps, rings the current stroke and offers a custom cap", () => {
    const markup = render(new EditorCore())
    const group = attrsOf(markup, "div").find((d) => d["aria-label"] === "Stroke colour")!
    expect(group.role).toBe("group")
    const caps = attrsOf(markup, "button").filter((b) => (b.class ?? "").includes("sc-swatch"))
    expect(caps.map((c) => c["aria-label"])).toEqual(["Black", "Blue", "Red", "Green", "Orange"])
    expect(caps.map((c) => c["aria-pressed"])).toEqual(["true", "false", "false", "false", "false"])
    const custom = attrsOf(markup, "button").find((b) => b.class === "tray-cap-custom")!
    expect(custom["aria-label"]).toBe("More colours")
    expect(custom["aria-haspopup"]).toBe("dialog")
  })

  it("rings the custom cap and none of the five for a custom colour", () => {
    const el = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, strokeColor: "#7048e8" })
    const core = new EditorCore()
    core.scene.insert({ ...el, index: core.scene.nextIndex() })
    core.selectElements([el.id])
    const markup = render(core)
    const caps = attrsOf(markup, "button").filter((b) => (b.class ?? "").includes("sc-swatch"))
    expect(caps.every((c) => c["aria-pressed"] === "false")).toBe(true)
    const custom = attrsOf(markup, "button").find((b) => b.class === "tray-cap-custom")!
    expect(custom["aria-label"]).toBe("Custom colour: Violet")
    expect(custom["data-selected"]).toBe("true")
  })

  it("keeps only Select, Hand and Laser in view mode", () => {
    const core = new EditorCore()
    core.setAppState({ viewMode: true })
    const markup = render(core)
    expect(tools(markup).map((b) => b["data-tool"])).toEqual(["selection", "hand", "laser"])
    expect(markup).not.toContain("tray-caps")
  })

  it("leaves out hidden tools", () => {
    const markup = render(new EditorCore(), { hiddenTools: ["embeddable", "eraser"] })
    expect(tools(markup).map((b) => b["data-tool"])).not.toContain("eraser")
  })

  it("holds the pencil on the Pen when the pen remembers Correct shapes", () => {
    const store = new Map<string, string>()
    const memory = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string | null) => void (v === null ? store.delete(k) : store.set(k, v)),
    }
    writePencilDefault(memory, true)
    const core = new EditorCore()
    armPen(core, memory)
    const list = tools(render(core, { prefs: memory }))
    const pen = list.find((b) => b["data-tool"] === "freedraw")!
    const pencil = list.find((b) => b["data-tool"] === "pencil")!
    expect(core.appState.activeTool).toBe("pencil")
    expect(pen["aria-pressed"]).toBe("true")
    expect(pen["aria-label"]).toBe("Pen, corrects shapes")
    expect(pen["aria-haspopup"]).toBe("dialog")
    expect(pencil["aria-pressed"]).toBe("false")
  })

  it("marks the held marker kept while Keep tool active is on", () => {
    const core = new EditorCore()
    core.setTool("rectangle")
    core.toggleToolLock()
    const markup = render(core)
    const rect = tools(markup).find((b) => b["data-tool"] === "rectangle")!
    expect(rect["aria-label"]).toBe("Rectangle, kept active")
    expect(markup).toContain("tray-marker-kept")
    core.setTool("frame")
    const more = attrsOf(render(core), "button").find((b) => b["data-testid"] === "tray-more")!
    expect(more["aria-label"]).toBe("More tools (Frame selected, kept active)")
    core.toggleToolLock()
    expect(render(core)).not.toContain("tray-marker-kept")
  })

  it("names the caps with the theme's own names", () => {
    const kraft = getTheme("kraft")
    const markup = render(new EditorCore(), { caps: kraft.caps, theme: kraft })
    const caps = attrsOf(markup, "button").filter((b) => (b.class ?? "").includes("sc-swatch"))
    expect(caps.map((c) => c["aria-label"])).toEqual(["Black", "Crimson", "Navy", "Green", "Ochre"])
  })

  it("keeps More and the colour out of the region that scrolls", () => {
    const markup = render(new EditorCore())
    const start = markup.indexOf('class="tray-tools"')
    const more = markup.indexOf('data-testid="tray-more"')
    expect(start).toBeGreaterThan(-1)
    const region = markup.slice(start, more)
    expect(region).toContain('data-tool="eraser"')
    expect(region).not.toContain("tray-caps")
    expect(markup.indexOf("tray-caps")).toBeGreaterThan(more)
  })

  it("renders the twelve tray markers in one toolbar", () => {
    const markup = render(new EditorCore())
    expect(markup).toContain('role="toolbar"')
    expect(tools(markup)).toHaveLength(12)
  })
})

describe("More drawer markup", () => {
  it("is nothing while closed", () => {
    const markup = renderToStaticMarkup(
      createElement(MoreDrawer, {
        open: false,
        onClose: noop,
        anchor: { current: null },
        items: DRAWER_ITEMS,
        tool: "selection",
        locked: false,
        onPick: noop,
      }),
    )
    expect(markup).toBe("")
  })

  it("is a labelled grid of named markers with roving focus and the lock as a toggle", () => {
    const markup = renderToStaticMarkup(
      createElement(MoreDrawer, {
        open: true,
        onClose: noop,
        anchor: { x: 0, y: 0 } as never,
        items: DRAWER_ITEMS,
        tool: "laser",
        locked: true,
        onPick: noop,
      }),
    )
    const pop = attrsOf(markup, "div").find((d) => d.role === "dialog")!
    expect(pop["aria-label"]).toBe("More tools")
    const cells = attrsOf(markup, "button")
    expect(cells).toHaveLength(7)
    expect(cells.filter((c) => c.tabindex === "0")).toHaveLength(1)
    const laser = cells.find((c) => c["data-tool"] === "laser")!
    expect(laser.tabindex).toBe("0")
    expect(laser["aria-pressed"]).toBe("true")
    expect(laser["aria-keyshortcuts"]).toBe("K")
    const lock = cells.find((c) => c["data-kind"] === "lock")!
    expect(lock["aria-label"]).toBe("Keep tool active")
    expect(lock["aria-pressed"]).toBe("true")
    const mermaid = cells.find((c) => c["data-kind"] === "action" && c["aria-label"])!
    expect(mermaid["aria-label"]).toBe("Mermaid to diagram")
    expect(mermaid["aria-pressed"]).toBeUndefined()
    for (const name of ["Image", "Frame", "Embed", "Laser", "Lasso", "Mermaid", "Keep tool"])
      expect(markup).toContain(`>${name}</span>`)
    expect(markup).not.toContain(">Library</span>")
  })
})

describe("pen options", () => {
  const options = (checked: boolean) =>
    renderToStaticMarkup(
      createElement(FreehandOptions, {
        open: true,
        onClose: noop,
        anchor: { x: 0, y: 0 } as never,
        core: new EditorCore(),
        prefs,
        checked,
      }),
    )

  it("holds a Correct shapes switch that reflects the held marker", () => {
    const pen = options(false)
    expect(attrsOf(pen, "div").find((d) => d.role === "dialog")!["aria-label"]).toBe("Pen options")
    const sw = attrsOf(pen, "button").find((b) => b.role === "switch")!
    expect(sw["aria-checked"]).toBe("false")
    expect(pen).toContain("Correct shapes")
    const pencil = options(true)
    expect(attrsOf(pencil, "div").find((d) => d.role === "dialog")!["aria-label"]).toBe("Pencil options")
    expect(attrsOf(pencil, "button").find((b) => b.role === "switch")!["aria-checked"]).toBe("true")
  })
})

describe("Icons", () => {
  it("draws every icon in one stroke weight, 1.75px at 20px", () => {
    expect((ICON_STROKE * 20) / 24).toBeCloseTo(1.75)
    const markup = renderToStaticMarkup(createElement("div", null, ...Object.values(Icons)))
    const svgs = attrsOf(markup, "svg")
    expect(svgs).toHaveLength(Object.keys(Icons).length)
    for (const s of svgs) {
      expect(s["stroke-width"]).toBe(String(ICON_STROKE))
      expect(s.stroke).toBe("currentColor")
      expect(s["aria-hidden"]).toBe("true")
    }
  })

  it("has the new tray and shell icons", () => {
    for (const name of ["pen", "pencil", "more", "theme", "export", "presentation", "mermaid", "chevronUp"])
      expect(Icons).toHaveProperty(name)
  })
})
