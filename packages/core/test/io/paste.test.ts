import { describe, expect, test } from "vitest"
import {
  classifyPaste,
  clipboardSummary,
  copyStyleFrom,
  parseTable,
  serializeClipboard,
} from "../../src/io/clipboard"
import { isEmbeddableLink, linkHost } from "../../src/io/links"
import { newElement } from "../../src/model/element"

describe("classifyPaste", () => {
  test("Nib and Excalidraw clipboard JSON is a scene", () => {
    const own = serializeClipboard([newElement("rectangle", { width: 10, height: 10 })], {})
    expect(classifyPaste(own).kind).toBe("scene")
    const excalidraw = JSON.stringify({
      type: "excalidraw/clipboard",
      elements: [{ id: "a", type: "ellipse", x: 0, y: 0, width: 5, height: 5 }],
      files: {},
    })
    const result = classifyPaste(excalidraw)
    expect(result.kind).toBe("scene")
    expect(result.kind === "scene" && result.payload.elements[0]!.type).toBe("ellipse")
  })

  test("a URL is a link, and an embeddable one says so", () => {
    expect(classifyPaste("  https://example.com/a?b=1 ")).toEqual({
      kind: "url",
      url: "https://example.com/a?b=1",
      embeddable: false,
    })
    expect(classifyPaste("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      kind: "url",
      embeddable: true,
    })
    expect(classifyPaste("www.figma.com/file/abc")).toEqual({
      kind: "url",
      url: "https://www.figma.com/file/abc",
      embeddable: true,
    })
  })

  test("unsafe and multi-word text is not a link", () => {
    expect(classifyPaste("javascript:alert(1)").kind).toBe("text")
    expect(classifyPaste("see https://example.com for more").kind).toBe("text")
  })

  test("SVG markup is an image, with or without an XML prolog", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    expect(classifyPaste(svg)).toEqual({ kind: "svg", svg })
    expect(classifyPaste(`<?xml version="1.0"?>\n<!-- made by hand -->\n${svg}`).kind).toBe("svg")
    expect(classifyPaste("<div>not svg</div>").kind).toBe("text")
  })

  test("Mermaid source is a diagram, also inside a ```mermaid fence", () => {
    expect(classifyPaste("flowchart LR\n  A --> B")).toEqual({
      kind: "mermaid",
      source: "flowchart LR\n  A --> B",
    })
    expect(classifyPaste("```mermaid\nsequenceDiagram\n A->>B: hi\n```")).toMatchObject({ kind: "mermaid" })
    expect(classifyPaste("classDiagram\n Animal <|-- Duck").kind).toBe("mermaid")
  })

  test("prose that happens to start with 'graph' stays text", () => {
    expect(classifyPaste("graph theory is fun\nA --> B means an edge").kind).toBe("text")
  })

  test("tab-separated cells are a table", () => {
    expect(classifyPaste("Name\tQty\nApples\t3\nPears\t5\n")).toEqual({
      kind: "table",
      rows: [
        ["Name", "Qty"],
        ["Apples", "3"],
        ["Pears", "5"],
      ],
    })
  })

  test("plain text is text and blank text is empty", () => {
    expect(classifyPaste("hello there")).toEqual({ kind: "text", text: "hello there" })
    expect(classifyPaste("  \n ").kind).toBe("empty")
  })
})

describe("parseTable", () => {
  test("CSV needs a numeric column, so ordinary sentences with commas stay text", () => {
    expect(parseTable("Hello, world\nfoo, bar")).toBeNull()
    expect(parseTable('Month,Sales\nJan,"1,200"\nFeb,950')).toEqual([
      ["Month", "Sales"],
      ["Jan", "1,200"],
      ["Feb", "950"],
    ])
  })

  test("ragged rows, one column and indentation-only columns are not tables", () => {
    expect(parseTable("a\tb\nc")).toBeNull()
    expect(parseTable("\tfoo\n\tbar")).toBeNull()
    expect(parseTable("just one cell")).toBeNull()
  })

  test("Windows line endings and quoted CSV cells are handled", () => {
    expect(parseTable('"a ""b""",2\r\nc,3\r\n')).toEqual([
      ['a "b"', "2"],
      ["c", "3"],
    ])
  })

  test("very large ranges stay text instead of becoming thousands of shapes", () => {
    const big = Array.from({ length: 100 }, (_, i) => `r${i}\t${i}\t${i}\t${i}\t${i}`).join("\n")
    expect(parseTable(big)).toBeNull()
  })
})

describe("embeddable links", () => {
  test("the allowlist matches hosts, not look-alikes or user-info tricks", () => {
    expect(isEmbeddableLink("https://youtu.be/abc")).toBe(true)
    expect(isEmbeddableLink("https://player.vimeo.com/video/1")).toBe(true)
    expect(isEmbeddableLink("https://gist.github.com/u/1")).toBe(true)
    expect(isEmbeddableLink("https://youtube.com.evil.example/x")).toBe(false)
    expect(isEmbeddableLink("https://youtube.com@evil.example/x")).toBe(false)
    expect(isEmbeddableLink("https://github.com/u/r")).toBe(false)
    expect(linkHost("https://user:pw@Example.COM:8080/x")).toBe("example.com")
  })
})

describe("copy styles carry text and arrowhead settings", () => {
  test("from a labelled shape: its stroke and fill plus its label's font", () => {
    const rect = newElement("rectangle", { strokeColor: "#e03131", backgroundColor: "#ffc9c9" })
    const label = newElement("text", {
      fontFamily: "code",
      fontSize: 28,
      textAlign: "right",
      verticalAlign: "bottom",
    })
    expect(copyStyleFrom(rect, label)).toMatchObject({
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fontFamily: "code",
      fontSize: 28,
      textAlign: "right",
      verticalAlign: "bottom",
    })
  })

  test("from an arrow: its arrowheads", () => {
    const arrow = newElement("arrow", { startArrowhead: "dot", endArrowhead: "triangle" })
    expect(copyStyleFrom(arrow)).toMatchObject({ startArrowhead: "dot", endArrowhead: "triangle" })
    expect(copyStyleFrom(newElement("rectangle", {})).fontSize).toBeUndefined()
  })
})

describe("plain-text summary", () => {
  test("lists the copied text top to bottom", () => {
    const els = [
      newElement("text", { x: 0, y: 50, text: "second" }),
      newElement("rectangle", { x: 0, y: 0 }),
      newElement("text", { x: 0, y: 0, text: "first" }),
    ]
    expect(clipboardSummary(els)).toBe("first\nsecond")
  })
})
