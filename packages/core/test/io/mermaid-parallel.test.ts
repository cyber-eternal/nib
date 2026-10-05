import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { absolutePointsOf } from "../../src/geometry/linear"
import { mermaidToElements, parseMermaid } from "../../src/io/mermaid"
import type { ArrowElement, NibElement, TextElement } from "../../src/model/types"
import { setTextMeasurer } from "../../src/render/textMeasure"

beforeAll(() => setTextMeasurer((t) => t.length * 9))

const build = (src: string) => {
  const parsed = parseMermaid(src)
  if (!parsed.ok) throw new Error(parsed.error)
  let n = 0
  return mermaidToElements(parsed, {
    appState: new EditorCore().appState,
    origin: [0, 0],
    nextIndex: () => `a${n++}`,
  })
}

const overlaps = (a: NibElement, b: NibElement) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const labelOf = (els: NibElement[], arrow: NibElement) =>
  els.find((e): e is TextElement => e.type === "text" && e.containerId === arrow.id)

const midpoint = (a: ArrowElement) => {
  const pts = absolutePointsOf(a)
  return pts[Math.floor(pts.length / 2)]!
}

describe("edges between the same two nodes are drawn apart", () => {
  test("a flowchart's two edges between API and Queue get separate paths and labels", () => {
    const els = build("flowchart LR\n  API -.->|events| Q[Queue]\n  Q -- retry --> API")
    const arrows = els.filter((e): e is ArrowElement => e.type === "arrow")
    expect(arrows).toHaveLength(2)
    const [a, b] = arrows as [ArrowElement, ArrowElement]
    expect(absolutePointsOf(a)).not.toEqual(absolutePointsOf(b))
    const [ma, mb] = [midpoint(a), midpoint(b)]
    expect(Math.hypot(ma[0] - mb[0], ma[1] - mb[1])).toBeGreaterThan(30)
    const la = labelOf(els, a)!
    const lb = labelOf(els, b)!
    expect([la.originalText, lb.originalText].sort()).toEqual(["events", "retry"])
    expect(overlaps(la, lb)).toBe(false)
    for (const arrow of arrows) {
      expect(arrow.startBinding).not.toBeNull()
      expect(arrow.endBinding).not.toBeNull()
    }
  })

  test("in a top-down chart wide labels are pushed far enough apart sideways", () => {
    const els = build("flowchart TD\n  A -->|a long first label| B\n  A -->|another long label| B\n  A --> B")
    const arrows = els.filter((e): e is ArrowElement => e.type === "arrow")
    expect(arrows).toHaveLength(3)
    const labels = arrows.map((a) => labelOf(els, a)).filter((l): l is TextElement => !!l)
    expect(labels).toHaveLength(2)
    expect(overlaps(labels[0]!, labels[1]!)).toBe(false)
    const mids = arrows.map((a) => midpoint(a)[0]).sort((x, y) => x - y)
    expect(mids[1]! - mids[0]!).toBeGreaterThan(20)
    expect(mids[2]! - mids[1]!).toBeGreaterThan(20)
  })

  test("a class diagram's two relations between the same classes do not overlap", () => {
    const els = build("classDiagram\n  Customer --> Order : owns\n  Order ..> Customer : depends")
    const arrows = els.filter((e): e is ArrowElement => e.type === "arrow")
    expect(arrows).toHaveLength(2)
    const la = labelOf(els, arrows[0]!)!
    const lb = labelOf(els, arrows[1]!)!
    expect(overlaps(la, lb)).toBe(false)
  })

  test("a single edge stays straight", () => {
    const els = build("flowchart LR\n  A --> B")
    const arrow = els.find((e): e is ArrowElement => e.type === "arrow")!
    expect(absolutePointsOf(arrow)).toHaveLength(2)
    expect(arrow.roundness).toBeNull()
  })
})

describe("the import error names only real diagram kinds", () => {
  test("plain text gets the how-to-start message", () => {
    const parsed = parseMermaid("hello world, not a diagram")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toBe("Start your diagram with `flowchart TD`, `sequenceDiagram` or `classDiagram`.")
  })

  test("a known but unsupported kind is named", () => {
    for (const [src, kind] of [
      ['pie title Pets\n  "Dogs" : 3', "pie"],
      ["erDiagram\n  A ||--o{ B : has", "erDiagram"],
      ["stateDiagram-v2\n  [*] --> Still", "stateDiagram-v2"],
      ["gantt\n  title A", "gantt"],
    ] as const) {
      const parsed = parseMermaid(src)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok)
        expect(parsed.error).toBe(`Nib imports flowchart, sequence and class diagrams, not ${kind}.`)
    }
  })
})
