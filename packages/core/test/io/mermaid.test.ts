import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { mermaidToElements, parseMermaid } from "../../src/io/mermaid"
import { newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { setTextMeasurer } from "../../src/render/textMeasure"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

const edges = (src: string) => parseMermaid(src).edges.map((e) => [e.from, e.to, e.label])

describe("IO mermaid", () => {
  test("an inserted diagram gets unique z-indices above existing content", () => {
    const core = new EditorCore()
    core.transact(() => {
      for (let i = 0; i < 2; i++)
        core.scene.insert(
          newElement("rectangle", { x: i * 50, y: 0, width: 40, height: 40, index: core.scene.nextIndex() }),
        )
    })
    const existing = new Set(core.scene.getElements().map((e) => e.id))
    const diagram = mermaidToElements(parseMermaid("flowchart TD\n A --> B"), {
      appState: core.appState,
      origin: [0, 0],
      nextIndex: () => core.scene.nextIndex(),
    })
    core.addElements(diagram)

    const ordered = core.scene.getElements()
    const indices = ordered.map((e) => e.index)
    expect(new Set(indices).size).toBe(indices.length)
    const firstNew = ordered.findIndex((e) => !existing.has(e.id))
    expect(ordered.slice(firstNew).every((e) => !existing.has(e.id))).toBe(true)
  })

  test("edge labels stay on their own edge in a chain", () => {
    expect(edges("flowchart TD\n A -->|x| B --> C -->|z| D")).toEqual([
      ["A", "B", "x"],
      ["B", "C", null],
      ["C", "D", "z"],
    ])
  })

  test("inline edge label syntax is understood", () => {
    expect(edges("flowchart LR\n A -- yes --> B")).toEqual([["A", "B", "yes"]])
  })

  test("a trailing comment does not drop the edge", () => {
    expect(edges("flowchart LR\n A --> B %% why this link exists")).toEqual([["A", "B", null]])
  })

  test("the & shorthand expands into one edge per node", () => {
    expect(edges("flowchart LR\n A & B --> C")).toEqual([
      ["A", "C", null],
      ["B", "C", null],
    ])
  })

  test("a :::class suffix does not hide the node", () => {
    expect(edges("flowchart LR\n A:::hot --> B")).toEqual([["A", "B", null]])
  })

  test("circle, cross and bidirectional connectors still create edges", () => {
    expect(edges("flowchart LR\n A --o B\n C --x D\n E <--> F").map((e) => [e[0], e[1]])).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["E", "F"],
    ])
  })

  test("non-ASCII node ids are accepted", () => {
    const parsed = parseMermaid("flowchart LR\n Привет --> Мир")
    expect(parsed.ok).toBe(true)
    expect(parsed.edges).toHaveLength(1)
  })
})

describe("IO mermaid syntax coverage", () => {
  test("YAML frontmatter and %%{init}%% directives are skipped", () => {
    const parsed = parseMermaid("---\ntitle: Flow\n---\n%%{init: {'theme':'dark'}}%%\nflowchart LR\n A --> B")
    expect(parsed.ok).toBe(true)
    expect(parsed.direction).toBe("LR")
    expect(parsed.edges.map((e) => [e.from, e.to])).toEqual([["A", "B"]])
  })

  test("a quoted label may contain link syntax", () => {
    const parsed = parseMermaid('flowchart TD\n A["a --> b"] --> C')
    expect(parsed.nodes.find((n) => n.id === "A")!.label).toBe("a --> b")
    expect(edges('flowchart TD\n A["a --> b"] --> C')).toEqual([["A", "C", null]])
  })

  test("dotted and thick links can carry inline text", () => {
    const parsed = parseMermaid("flowchart LR\n A -. maybe .-> B\n B == sure ==> C")
    expect(parsed.edges.map((e) => [e.label, e.style])).toEqual([
      ["maybe", "dashed"],
      ["sure", "thick"],
    ])
  })

  test("circle, cross and two-way ends map to arrowheads", () => {
    const parsed = parseMermaid("flowchart LR\n A --o B\n C --x D\n E <--> F\n G --- H")
    expect(parsed.edges.map((e) => [e.tail, e.head])).toEqual([
      [null, "circle"],
      [null, "cross"],
      ["arrow", "arrow"],
      [null, null],
    ])
  })

  test("statements split on semicolons and keep dashed ids whole", () => {
    expect(edges("graph TD; my-node --> b.c; b.c --> d")).toEqual([
      ["my-node", "b.c", null],
      ["b.c", "d", null],
    ])
  })

  test("a line that can't be read is reported instead of silently dropped", () => {
    const parsed = parseMermaid("flowchart TD\n A --> B\n C -->\n D[unclosed")
    expect(parsed.ok).toBe(true)
    expect(parsed.edges).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(2)
    expect(parsed.warnings[0]).toContain("Line 3")
  })

  test("a self-loop is drawn as a curved arrow with length", () => {
    const els = mermaidToElements(parseMermaid("flowchart TD\n A --> A"), {
      appState: new EditorCore().appState,
      origin: [0, 0],
      nextIndex: () => "a0",
    })
    const arrow = els.find((e) => e.type === "arrow") as ArrowElement
    const [first, last] = [arrow.points[0]!, arrow.points[arrow.points.length - 1]!]
    expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeGreaterThan(5)
    expect(arrow.roundness).toEqual({ type: 2 })
  })
})
