import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ColorSwatch } from "../../src/ui/primitives/ColorSwatch"
import { Dialog } from "../../src/ui/primitives/Dialog"
import { IconButton } from "../../src/ui/primitives/IconButton"
import { Kbd } from "../../src/ui/primitives/Kbd"
import { Menu } from "../../src/ui/primitives/Menu"
import { Popover } from "../../src/ui/primitives/Popover"
import { Segmented } from "../../src/ui/primitives/Segmented"
import { Slider } from "../../src/ui/primitives/Slider"
import { Switch } from "../../src/ui/primitives/Switch"
import { ToastRegion } from "../../src/ui/primitives/Toast"
import { Toolbar } from "../../src/ui/primitives/Toolbar"

const noop = () => {}
const html = (
  // components with required props; the markup is what is under test, not the typing
  type: any,
  props: Record<string, unknown>,
  ...children: unknown[]
) => renderToStaticMarkup(createElement(type as never, props as never, ...(children as never[])))

const attrsOf = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))].map(([, attrs = ""]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

describe("Dialog", () => {
  it("is a labelled modal dialog", () => {
    const markup = html(
      Dialog,
      { open: true, onClose: noop, title: "Export image", description: "Choose a format" },
      "body",
    )
    const dialog = attrsOf(markup, "div").find((d) => d.role === "dialog")!
    expect(dialog["aria-modal"]).toBe("true")
    const title = attrsOf(markup, "h2")[0]!
    expect(dialog["aria-labelledby"]).toBe(title.id)
    expect(markup).toContain(">Export image</h2>")
    expect(dialog["aria-describedby"]).toBeTruthy()
    expect(markup).toContain('aria-label="Close"')
  })

  it("renders nothing while closed", () => {
    expect(html(Dialog, { open: false, onClose: noop, title: "x" })).toBe("")
  })
})

describe("Menu", () => {
  const markup = html(Menu, {
    label: "Main menu",
    sections: [
      {
        id: "file",
        label: "File",
        items: [
          { id: "save", label: "Save", shortcut: "Mod+S", onSelect: noop },
          { id: "open", label: "Open", disabled: true, onSelect: noop },
        ],
      },
      {
        id: "view",
        label: "View",
        items: [{ id: "grid", label: "Grid", kind: "checkbox", checked: true, onSelect: noop }],
      },
      {
        id: "danger",
        isolated: true,
        items: [{ id: "reset", label: "Reset canvas", danger: true, onSelect: noop }],
      },
    ],
    isMac: true,
  })
  const buttons = attrsOf(markup, "button")

  it("exposes role=menu with menuitem roles and one tab stop", () => {
    expect(attrsOf(markup, "div").find((d) => d.role === "menu")?.["aria-label"]).toBe("Main menu")
    expect(buttons.map((b) => b.role)).toEqual(["menuitem", "menuitem", "menuitemcheckbox", "menuitem"])
    expect(buttons.filter((b) => b.tabindex === "0")).toHaveLength(1)
    expect(buttons[0]!.tabindex).toBe("0")
  })

  it("shows shortcuts, checked and disabled state, group labels and an isolated danger section", () => {
    expect(buttons[0]!["aria-keyshortcuts"]).toBe("Meta+S")
    expect(markup).toContain("⌘S")
    expect(buttons[1]!["aria-disabled"]).toBe("true")
    expect(buttons[2]!["aria-checked"]).toBe("true")
    const groups = attrsOf(markup, "div").filter((d) => d.role === "group")
    expect(groups).toHaveLength(3)
    expect(groups[0]!["aria-labelledby"]).toBeTruthy()
    expect(groups[2]!["data-isolated"]).toBe("true")
    expect(buttons[3]!["data-danger"]).toBe("true")
    expect(attrsOf(markup, "hr")).toHaveLength(2)
  })
})

describe("controls", () => {
  it("IconButton is a named, typed toggle with its shortcut", () => {
    const markup = html(IconButton, {
      label: "Rectangle",
      icon: "R",
      pressed: true,
      shortcut: "R",
      lift: true,
    })
    const b = attrsOf(markup, "button")[0]!
    expect(b).toMatchObject({
      type: "button",
      "aria-label": "Rectangle",
      "aria-pressed": "true",
      "aria-keyshortcuts": "R",
    })
    expect(b["data-lift"]).toBe("true")
    expect(
      attrsOf(html(IconButton, { label: "Undo", icon: "U" }), "button")[0]!["aria-pressed"],
    ).toBeUndefined()
  })

  it("Segmented is a radio group with a single tab stop, and shows no choice when mixed", () => {
    const options = [
      { value: "sharp", label: "Sharp" },
      { value: "round", label: "Round" },
    ]
    const picked = attrsOf(
      html(Segmented, { label: "Edges", options, value: "round", onChange: noop }),
      "button",
    )
    expect(picked.map((b) => [b.role, b["aria-checked"], b.tabindex])).toEqual([
      ["radio", "false", "-1"],
      ["radio", "true", "0"],
    ])
    const mixed = attrsOf(html(Segmented, { label: "Edges", options, value: null, onChange: noop }), "button")
    expect(mixed.map((b) => b["aria-checked"])).toEqual(["false", "false"])
    expect(mixed[0]!.tabindex).toBe("0")
    expect(html(Segmented, { label: "Edges", options, value: null, onChange: noop })).toContain(
      'role="radiogroup"',
    )
  })

  it("Slider labels its range input and shows a tabular readout", () => {
    const markup = html(Slider, {
      label: "Opacity",
      value: 60,
      onChange: noop,
      format: (v: number) => `${v}%`,
    })
    const input = attrsOf(markup, "input")[0]!
    const label = attrsOf(markup, "label")[0]!
    expect(input.type).toBe("range")
    expect(label.for).toBe(input.id)
    expect(input["aria-valuetext"]).toBe("60%")
    expect(markup).toContain(">60%</output>")
    expect(html(Slider, { label: "Opacity", value: null, onChange: noop })).toContain(">Mixed</output>")
  })

  it("Switch, ColorSwatch, Kbd and Toolbar carry their roles and names", () => {
    expect(
      attrsOf(html(Switch, { label: "Grid", checked: true, onChange: noop }), "button")[0],
    ).toMatchObject({
      role: "switch",
      "aria-checked": "true",
    })
    expect(
      attrsOf(html(ColorSwatch, { color: "#e03131", name: "Red", selected: true }), "button")[0],
    ).toMatchObject({
      "aria-label": "Red",
      "aria-pressed": "true",
    })
    expect(html(Kbd, { chord: "Mod+Shift+E", isMac: true })).toBe('<kbd class="sc-kbd">⇧⌘E</kbd>')
    expect(html(Toolbar, { label: "Tools" }, "x")).toContain('role="toolbar"')
  })

  it("Popover renders a labelled dialog container when open and nothing when closed", () => {
    const anchor = { current: null }
    const open = html(Popover, { open: true, onClose: noop, anchor, label: "Stroke colour" }, "content")
    expect(attrsOf(open, "div")[0]).toMatchObject({
      role: "dialog",
      "aria-label": "Stroke colour",
      tabindex: "-1",
    })
    expect(html(Popover, { open: false, onClose: noop, anchor }, "content")).toBe("")
  })

  it("the toast region is a status live region even when empty", () => {
    const markup = html(ToastRegion, { toasts: [], onDismiss: noop })
    expect(attrsOf(markup, "div")[0]).toMatchObject({ role: "status", "aria-live": "polite" })
  })
})
