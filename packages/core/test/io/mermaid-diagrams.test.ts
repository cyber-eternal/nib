import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { mermaidToElements, parseMermaid } from "../../src/io/mermaid"
import { normalizeElements } from "../../src/io/nibFile"
import type { ArrowElement, FrameElement, NibElement, TextElement } from "../../src/model/types"
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

const inside = (el: NibElement, box: NibElement) =>
  el.x >= box.x - 0.5 &&
  el.y >= box.y - 0.5 &&
  el.x + el.width <= box.x + box.width + 0.5 &&
  el.y + el.height <= box.y + box.height + 0.5

const overlaps = (a: NibElement, b: NibElement) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const labelOf = (els: NibElement[], container: NibElement) =>
  (els.find((e) => e.type === "text" && e.containerId === container.id) as TextElement | undefined)
    ?.originalText

const shapeLabelled = (els: NibElement[], text: string) =>
  els.find((e) => e.type !== "text" && labelOf(els, e) === text)!

describe("flowchart subgraphs become frames", () => {
  const src = `flowchart LR
    subgraph api [API layer]
      A[Gateway] --> B[Auth]
    end
    subgraph data
      C[(Store)]
    end
    B --> C
    D[Client] --> A`

  test("each subgraph is a named frame and its nodes are its children", () => {
    const els = build(src)
    const frames = els.filter((e): e is FrameElement => e.type === "frame")
    expect(frames.map((f) => f.name).sort()).toEqual(["API layer", "data"])
    const api = frames.find((f) => f.name === "API layer")!
    for (const name of ["Gateway", "Auth"]) {
      const shape = shapeLabelled(els, name)
      expect(shape.frameId).toBe(api.id)
      expect(inside(shape, api)).toBe(true)
    }
    const client = shapeLabelled(els, "Client")
    expect(client.frameId).toBeNull()
    expect(inside(client, api)).toBe(false)
  })

  test("frames don't overlap each other or outside nodes, and sit below their contents", () => {
    const els = build(src)
    const frames = els.filter((e) => e.type === "frame")
    expect(overlaps(frames[0]!, frames[1]!)).toBe(false)
    expect(
      overlaps(frames.find((f) => (f as FrameElement).name === "data")!, shapeLabelled(els, "Client")),
    ).toBe(false)
    const firstFrame = Math.max(...frames.map((f) => els.indexOf(f)))
    const firstShape = Math.min(...els.filter((e) => e.type === "rectangle").map((e) => els.indexOf(e)))
    expect(firstFrame).toBeLessThan(firstShape)
  })

  test("an arrow between two subgraphs belongs to neither frame", () => {
    const els = build(src)
    const auth = shapeLabelled(els, "Auth")
    const store = shapeLabelled(els, "Store")
    const arrow = els.find(
      (e): e is ArrowElement =>
        e.type === "arrow" && e.startBinding?.elementId === auth.id && e.endBinding?.elementId === store.id,
    )!
    expect(arrow.frameId).toBeNull()
  })

  test("nested subgraphs nest their frames, and inner subgraphs claim their nodes", () => {
    const parsed = parseMermaid(`flowchart TD
      subgraph outer
        X --> Y
        subgraph inner
          Y --> Z
        end
      end`)
    expect(parsed.subgraphs.map((s) => [s.id, s.parent, s.nodes])).toEqual([
      ["outer", null, ["X"]],
      ["inner", "outer", ["Y", "Z"]],
    ])
    const els = build(`flowchart TD
      subgraph outer
        X --> Y
        subgraph inner
          Y --> Z
        end
      end`)
    const outer = els.find((e) => e.type === "frame" && (e as FrameElement).name === "outer")!
    const inner = els.find((e) => e.type === "frame" && (e as FrameElement).name === "inner")!
    expect(inside(inner, outer)).toBe(true)
    expect(inside(shapeLabelled(els, "Y"), inner)).toBe(true)
    expect(inside(shapeLabelled(els, "X"), inner)).toBe(false)
  })

  test("a subgraph's own direction lays its nodes out that way", () => {
    const els = build(`flowchart TD
      subgraph row
        direction LR
        P --> Q --> R
      end`)
    const [p, q, r] = ["P", "Q", "R"].map((n) => shapeLabelled(els, n))
    expect(p!.x).toBeLessThan(q!.x)
    expect(q!.x).toBeLessThan(r!.x)
    expect(Math.abs(p!.y - r!.y)).toBeLessThan(1)
  })

  test("a link to a subgraph points at its frame instead of inventing a node", () => {
    const parsed = parseMermaid("flowchart LR\n subgraph S\n A\n end\n B --> S")
    expect(parsed.nodes.map((n) => n.id).sort()).toEqual(["A", "B"])
    const els = build("flowchart LR\n subgraph S\n A\n end\n B --> S")
    const frame = els.find((e) => e.type === "frame")!
    const arrow = els.find((e): e is ArrowElement => e.type === "arrow")!
    expect(arrow.endBinding).toBeNull()
    const tip = arrow.points[arrow.points.length - 1]!
    const [tx, ty] = [arrow.x + tip[0], arrow.y + tip[1]]
    const onEdge =
      Math.abs(tx - frame.x) < 1 ||
      Math.abs(tx - (frame.x + frame.width)) < 1 ||
      Math.abs(ty - frame.y) < 1 ||
      Math.abs(ty - (frame.y + frame.height)) < 1
    expect(onEdge).toBe(true)
  })

  test("titles with spaces, quoted titles and a missing end are all read", () => {
    const parsed = parseMermaid('flowchart TD\n subgraph "Big group"\n A\n end\n subgraph Two words\n B')
    expect(parsed.subgraphs.map((s) => s.label)).toEqual(["Big group", "Two words"])
    expect(parsed.subgraphs.map((s) => s.nodes)).toEqual([["A"], ["B"]])
    expect(parsed.warnings.some((w) => w.includes("Two words"))).toBe(true)
  })

  test("subgraphs no longer produce a 'not imported' warning", () => {
    expect(parseMermaid("flowchart TD\n subgraph one\n A\n end").warnings).toEqual([])
  })

  test("frames and their children survive a save and reload", () => {
    const els = build(src)
    const back = normalizeElements(JSON.parse(JSON.stringify(els)))
    expect(back.filter((e) => e.type === "frame")).toHaveLength(2)
    expect(back.filter((e) => e.frameId).length).toBeGreaterThan(0)
  })
})

describe("layout quality", () => {
  test("a cycle's back edge doesn't scramble the layers", () => {
    const els = build("flowchart LR\n A --> B --> C\n C --> A")
    const [a, b, c] = ["A", "B", "C"].map((n) => shapeLabelled(els, n))
    expect(a!.x).toBeLessThan(b!.x)
    expect(b!.x).toBeLessThan(c!.x)
  })

  test("an edge that would cut through another node bends around it", () => {
    const els = build("flowchart LR\n A --> B --> C\n A --> C")
    const [a, b, c] = ["A", "B", "C"].map((n) => shapeLabelled(els, n))
    const skip = els.find(
      (e): e is ArrowElement =>
        e.type === "arrow" && e.startBinding?.elementId === a!.id && e.endBinding?.elementId === c!.id,
    )!
    expect(skip.points).toHaveLength(3)
    expect(skip.roundness).toEqual({ type: 2 })
    const mid = skip.points[1]!
    const [mx, my] = [skip.x + mid[0], skip.y + mid[1]]
    expect(mx > b!.x && mx < b!.x + b!.width && my > b!.y && my < b!.y + b!.height).toBe(false)
    const direct = els.find(
      (e): e is ArrowElement => e.type === "arrow" && e.startBinding?.elementId === a!.id && e !== skip,
    )!
    expect(direct.points).toHaveLength(2)
  })
})

describe("classDef, style and linkStyle", () => {
  test("classDef fill and stroke colour the nodes that use the class", () => {
    const els = build(`flowchart LR
      A:::hot --> B
      classDef hot fill:#ffc9c9,stroke:#e03131,stroke-width:3px
      style B fill:#d0ebff,color:#1971c2,stroke-dasharray: 4 2`)
    const a = shapeLabelled(els, "A")
    expect([a.backgroundColor, a.strokeColor, a.strokeWidth, a.fillStyle]).toEqual([
      "#ffc9c9",
      "#e03131",
      3,
      "solid",
    ])
    const b = shapeLabelled(els, "B")
    expect(b.backgroundColor).toBe("#d0ebff")
    expect(b.strokeStyle).toBe("dashed")
    const label = els.find((e) => e.type === "text" && e.containerId === b.id)!
    expect(label.strokeColor).toBe("#1971c2")
  })

  test("class statements and the default class apply too", () => {
    const parsed = parseMermaid(`flowchart LR
      A --> B
      classDef default fill:#f8f9fa
      classDef warn fill:#fff3bf
      class B warn`)
    expect(parsed.nodes.map((n) => n.style?.fill)).toEqual(["#f8f9fa", "#fff3bf"])
  })

  test("a colour that isn't a CSS colour is ignored", () => {
    const parsed = parseMermaid('flowchart LR\n A\n style A fill:url(javascript:alert(1)),stroke:"><script>')
    expect(parsed.nodes[0]!.style).toBeUndefined()
  })

  test("linkStyle colours links by their position, counting invisible ones", () => {
    const parsed = parseMermaid(`flowchart LR
      A ~~~ B
      B --> C
      linkStyle 1 stroke:#2f9e44,stroke-width:4px`)
    expect(parsed.edges.map((e) => [e.from, e.to, e.stroke, e.strokeWidth])).toEqual([
      ["B", "C", "#2f9e44", 4],
    ])
  })
})

describe("sequence diagrams", () => {
  const src = `sequenceDiagram
    participant A as Alice
    actor B as Bob
    A->>B: Hello Bob
    B-->>A: Hi Alice
    A-)A: Think
    Note over A,B: A note
    loop Every minute
      A->>+B: Ping
    end
    alt ok
      B-->>A: Pong
    else failed
      B--xA: Timeout
    end`

  test("reads participants, messages, notes and blocks", () => {
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    expect(parsed.kind).toBe("sequence")
    expect(parsed.participants).toEqual([
      { id: "A", label: "Alice", actor: false },
      { id: "B", label: "Bob", actor: true },
    ])
    const messages = parsed.steps.filter((s) => s.kind === "message")
    expect(messages.map((m) => [m.from, m.to, m.label, m.dashed, m.head])).toEqual([
      ["A", "B", "Hello Bob", false, "arrow"],
      ["B", "A", "Hi Alice", true, "arrow"],
      ["A", "A", "Think", false, "open"],
      ["A", "B", "Ping", false, "arrow"],
      ["B", "A", "Pong", true, "arrow"],
      ["B", "A", "Timeout", true, "cross"],
    ])
    expect(parsed.steps.filter((s) => s.kind === "block").map((s) => s.phase)).toEqual([
      "start",
      "end",
      "start",
      "section",
      "end",
    ])
    expect(parsed.warnings).toEqual([])
  })

  test("each participant gets a box at the top and bottom joined by a dashed lifeline, all one group", () => {
    const els = build(src)
    const alice = els.filter((e) => e.type === "rectangle" && labelOf(els, e) === "Alice")
    expect(alice).toHaveLength(2)
    expect(els.filter((e) => e.type === "ellipse" && labelOf(els, e) === "Bob")).toHaveLength(2)
    const group = alice[0]!.groupIds[0]!
    const lifeline = els.find((e) => e.type === "line" && e.groupIds.includes(group))!
    expect(lifeline.strokeStyle).toBe("dashed")
    expect(lifeline.width).toBe(0)
    expect(alice[1]!.groupIds).toEqual([group])
    expect(alice[1]!.y).toBeGreaterThan(alice[0]!.y)
  })

  test("messages run top to bottom between the lifelines, with their text and line style", () => {
    const els = build(src)
    const arrows = els.filter((e): e is ArrowElement => e.type === "arrow")
    expect(arrows.map((a) => labelOf(els, a))).toEqual([
      "Hello Bob",
      "Hi Alice",
      "Think",
      "Ping",
      "Pong",
      "Timeout",
    ])
    const ys = arrows.map((a) => a.y)
    expect([...ys].sort((p, q) => p - q)).toEqual(ys)
    const [hello, hi] = arrows
    expect(hello!.height).toBe(0)
    expect(hello!.strokeStyle).toBe("solid")
    expect(hi!.strokeStyle).toBe("dashed")
    // Bob answers leftwards: the arrow starts at Bob's lifeline
    expect(hi!.points[0]![0]).toBeGreaterThan(hi!.points[1]![0])
    const think = arrows[2]!
    expect(think.points).toHaveLength(4)
  })

  test("labels fit between lifelines and notes and blocks are drawn", () => {
    const els = build("sequenceDiagram\n A->>B: a very long message that needs a lot of room")
    const [a, b] = els.filter((e) => e.type === "rectangle" && e.y === 0)
    const label = els.find((e) => e.type === "text" && (e as TextElement).originalText.startsWith("a very"))!
    expect(Math.abs(b!.x + b!.width / 2 - (a!.x + a!.width / 2))).toBeGreaterThan(label.width)

    const full = build(src)
    const note = full.find((e) => e.type === "rectangle" && labelOf(full, e) === "A note")!
    expect(note.backgroundColor).toBe("#fff3bf")
    const frames = full.filter((e): e is FrameElement => e.type === "frame")
    expect(frames.map((f) => f.name)).toEqual(["loop Every minute", "alt ok"])
    expect(full.some((e) => e.type === "text" && (e as TextElement).text === "[failed]")).toBe(true)
  })

  test("autonumber numbers the messages", () => {
    const parsed = parseMermaid("sequenceDiagram\n autonumber\n A->>B: one\n B->>A: two")
    expect(parsed.steps.map((s) => (s.kind === "message" ? s.label : ""))).toEqual(["1. one", "2. two"])
  })

  test("a hyphenated participant isn't split at an x", () => {
    const parsed = parseMermaid("sequenceDiagram\n my-xyz->>B: hi")
    expect(parsed.participants.map((p) => p.id)).toEqual(["my-xyz", "B"])
  })

  test("unsupported statements are reported once", () => {
    const parsed = parseMermaid("sequenceDiagram\n activate A\n A->>B: x\n deactivate A\n ??? nonsense")
    expect(parsed.ok).toBe(true)
    expect(parsed.warnings).toHaveLength(2)
  })

  test("sequence keys continue from the caller's next index", () => {
    let calls = 0
    const els = mermaidToElements(parseMermaid("sequenceDiagram\n A->>B: x"), {
      appState: new EditorCore().appState,
      origin: [0, 0],
      nextIndex: () => {
        calls++
        return "a5"
      },
    })
    expect(calls).toBe(1)
    expect(els[0]!.index).toBe("a5")
    const indices = els.map((e) => e.index)
    expect(new Set(indices).size).toBe(indices.length)
    expect([...indices].sort()).toEqual(indices)
  })
})

describe("class diagrams", () => {
  const src = `classDiagram
    class Animal {
      <<abstract>>
      +String name
      +int age
      +makeSound() void
    }
    class Duck
    Duck : +swim()
    Animal <|-- Duck : extends
    Animal "1" *-- "many" Leg : has
    Duck ..> Pond
    note for Duck "can fly"`

  test("reads classes with members, methods and stereotypes", () => {
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    expect(parsed.kind).toBe("class")
    const animal = parsed.nodes.find((n) => n.id === "Animal")!
    expect(animal.annotation).toBe("abstract")
    expect(animal.members).toEqual(["+String name", "+int age"])
    expect(animal.methods).toEqual(["+makeSound() void"])
    expect(parsed.nodes.find((n) => n.id === "Duck")!.methods).toEqual(["+swim()"])
    expect(parsed.warnings).toEqual([])
  })

  test("relations keep their kind, label and multiplicities", () => {
    const parsed = parseMermaid(src)
    const rel = parsed.edges.map((e) => [e.from, e.to, e.tail, e.head, e.style, e.label])
    expect(rel).toEqual([
      ["Animal", "Duck", "triangle", null, "solid", "extends"],
      ["Animal", "Leg", "diamond", null, "solid", "has"],
      ["Duck", "Pond", null, "arrow", "dashed", null],
      ["note:0", "Duck", null, null, "dashed", null],
    ])
    expect(parsed.edges[1]).toMatchObject({ fromLabel: "1", toLabel: "many" })
  })

  test("a class becomes a grouped box with name, attribute and method compartments", () => {
    const els = build(src)
    const animal = els.find((e) => e.type === "rectangle" && labelOf(els, e)?.includes("Animal"))!
    expect(labelOf(els, animal)).toBe("«abstract»\nAnimal")
    const group = animal.groupIds[0]!
    const parts = els.filter((e) => e.groupIds.includes(group) && e.id !== animal.id)
    expect(parts.filter((e) => e.type === "line")).toHaveLength(2)
    const texts = parts.filter((e): e is TextElement => e.type === "text" && !e.containerId)
    expect(texts.map((t) => t.text)).toEqual(["+String name\n+int age", "+makeSound() void"])
    for (const part of parts) expect(inside(part, animal)).toBe(true)
  })

  test("relations are bound arrows with UML ends, and multiplicities sit by the ends", () => {
    const els = build(src)
    const animal = els.find((e) => e.type === "rectangle" && labelOf(els, e)?.includes("Animal"))!
    const arrows = els.filter((e): e is ArrowElement => e.type === "arrow")
    const inherit = arrows.find((a) => labelOf(els, a) === "extends")!
    expect(inherit.startBinding?.elementId).toBe(animal.id)
    expect(inherit.startArrowhead).toBe("triangle_outline")
    expect(arrows.find((a) => labelOf(els, a) === "has")!.startArrowhead).toBe("diamond")
    expect(els.some((e) => e.type === "text" && (e as TextElement).text === "many")).toBe(true)
    const note = els.find((e) => e.type === "rectangle" && labelOf(els, e) === "can fly")!
    expect(note.backgroundColor).toBe("#fff3bf")
  })

  test("namespaces become frames", () => {
    const els = build("classDiagram\n namespace Shapes {\n class Square\n class Circle\n }\n class Canvas")
    const frame = els.find((e): e is FrameElement => e.type === "frame")!
    expect(frame.name).toBe("Shapes")
    expect(shapeLabelled(els, "Square").frameId).toBe(frame.id)
    expect(shapeLabelled(els, "Canvas").frameId).toBeNull()
  })

  test("a class mentioned before its namespace still joins it", () => {
    const parsed = parseMermaid("classDiagram\n A --> Pond\n namespace Water {\n class Pond\n }")
    expect(parsed.subgraphs[0]!.nodes).toEqual(["Pond"])
  })

  test("generics are shown with angle brackets", () => {
    const parsed = parseMermaid("classDiagram\n class Box~T~ {\n +List~T~ items\n }")
    const box = parsed.nodes[0]!
    expect([box.id, box.label, box.members]).toEqual(["Box", "Box<T>", ["+List<T> items"]])
  })
})
