import { beforeAll, describe, expect, test } from "vitest"
import { mermaidToElements, parseMermaid } from "../src/io/mermaid"
import { DEFAULT_APP_STATE } from "../src/model/types"
import { setTextMeasurer } from "../src/render/textMeasure"

beforeAll(() => setTextMeasurer((t) => t.length * 9))

const build = (src: string) => {
  const parsed = parseMermaid(src)
  if (!parsed.ok) throw new Error(parsed.error)
  let n = 0
  return mermaidToElements(parsed, {
    appState: DEFAULT_APP_STATE,
    origin: [0, 0],
    nextIndex: () => `a${n++}`,
  })
}

describe("parseMermaid", () => {
  test("reads nodes, shapes and direction", () => {
    const parsed = parseMermaid(`flowchart LR
      A[Start] --> B{Decision}
      B --> C((Done))`)
    expect(parsed.ok).toBe(true)
    expect(parsed.direction).toBe("LR")
    expect(parsed.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"])
    expect(parsed.nodes.find((n) => n.id === "B")!.shape).toBe("diamond")
    expect(parsed.nodes.find((n) => n.id === "C")!.shape).toBe("ellipse")
    expect(parsed.nodes.find((n) => n.id === "A")!.label).toBe("Start")
    expect(parsed.edges).toHaveLength(2)
  })

  test("reads edge labels written either way", () => {
    const parsed = parseMermaid(`graph TD
      A -->|yes| B
      A -->|no| C`)
    expect(parsed.edges.map((e) => e.label)).toEqual(["yes", "no"])
  })

  test("distinguishes dashed, thick and plain links", () => {
    const parsed = parseMermaid(`flowchart TD
      A --> B
      B -.-> C
      C ==> D
      D --- E`)
    expect(parsed.edges.map((e) => e.style)).toEqual(["solid", "dashed", "thick", "solid"])
    expect(parsed.edges.map((e) => e.arrow)).toEqual([true, true, true, false])
  })

  test("handles a chain on one line", () => {
    const parsed = parseMermaid("flowchart LR\n A --> B --> C")
    expect(parsed.edges).toHaveLength(2)
    expect(parsed.edges[1]).toMatchObject({ from: "B", to: "C" })
  })

  test("ignores styling and subgraph directives", () => {
    const parsed = parseMermaid(`flowchart TD
      subgraph one
      A --> B
      end
      style A fill:#f9f
      classDef big font-size:20px`)
    expect(parsed.ok).toBe(true)
    expect(parsed.nodes).toHaveLength(2)
  })

  test("explains itself when the diagram type is not one it imports", () => {
    const parsed = parseMermaid('pie title Pets\n "Dogs" : 386')
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain("flowchart")
  })
})

describe("mermaidToElements", () => {
  test("creates a labelled shape per node and a bound arrow per edge", () => {
    const els = build("flowchart TD\n A[One] --> B[Two]")
    const shapes = els.filter((e) => e.type === "rectangle")
    const texts = els.filter((e) => e.type === "text")
    const arrows = els.filter((e) => e.type === "arrow")
    expect(shapes).toHaveLength(2)
    expect(texts).toHaveLength(2)
    expect(arrows).toHaveLength(1)

    const arrow = arrows[0] as { startBinding: { elementId: string }; endBinding: { elementId: string } }
    expect(shapes.some((s) => s.id === arrow.startBinding.elementId)).toBe(true)
    expect(shapes.some((s) => s.id === arrow.endBinding.elementId)).toBe(true)
  })

  test("labels sit inside their shape", () => {
    const els = build("flowchart TD\n A[Hello there]")
    const shape = els.find((e) => e.type === "rectangle")!
    const text = els.find((e) => e.type === "text")!
    expect(text.x).toBeGreaterThanOrEqual(shape.x)
    expect(text.x + text.width).toBeLessThanOrEqual(shape.x + shape.width + 1)
    expect(text.y).toBeGreaterThanOrEqual(shape.y - 1)
  })

  test("a top-down diagram stacks its ranks downward", () => {
    const els = build("flowchart TD\n A --> B\n B --> C")
    const rects = els.filter((e) => e.type === "rectangle")
    const ys = rects.map((r) => r.y).sort((a, b) => a - b)
    expect(ys[0]!).toBeLessThan(ys[1]!)
    expect(ys[1]!).toBeLessThan(ys[2]!)
  })

  test("a left-right diagram spreads its ranks sideways", () => {
    const els = build("flowchart LR\n A --> B\n B --> C")
    const rects = els.filter((e) => e.type === "rectangle")
    const xs = rects.map((r) => r.x).sort((a, b) => a - b)
    expect(xs[0]!).toBeLessThan(xs[1]!)
    expect(xs[1]!).toBeLessThan(xs[2]!)
  })

  test("shapes know about the arrows attached to them", () => {
    const els = build("flowchart TD\n A --> B")
    const shape = els.find((e) => e.type === "rectangle")!
    expect(shape.boundElements?.some((b) => b.type === "arrow")).toBe(true)
  })

  test("a cycle still terminates and lays out", () => {
    const els = build("flowchart TD\n A --> B\n B --> C\n C --> A")
    expect(els.filter((e) => e.type === "rectangle")).toHaveLength(3)
  })

  test("edge labels become bound text on the arrow", () => {
    const els = build("flowchart TD\n A -->|maybe| B")
    const arrow = els.find((e) => e.type === "arrow")!
    const label = els.find((e) => e.type === "text" && e.containerId === arrow.id)
    expect(label).toBeDefined()
    expect((label as { originalText: string }).originalText).toBe("maybe")
  })
})
