import { updateBoundArrow } from "../geometry/binding"
import { layoutBoundText } from "../geometry/boundText"
import type { Point } from "../math/vector"
import { newElement } from "../model/element"
import type { AppState, ArrowElement, Arrowhead, NibElement, TextElement } from "../model/types"
import { indicesBetween } from "../model/zindex"
import { measureMultiline } from "../render/textMeasure"
import { NOTE_STYLE, buildClassBox, classBoxSize, isClassBox, parseClassDiagram } from "./mermaidClass"
import {
  type LayeredLayout,
  type LayoutItem,
  boxExitPoint,
  detourPoint,
  layoutLayered,
  rebased,
} from "./mermaidLayout"
import { buildSequence, parseSequence } from "./mermaidSequence"
import {
  DIRECTIONS,
  type Statement,
  cleanLabel,
  mergeStyles,
  parseStyleProps,
  statementsOf,
} from "./mermaidSyntax"

export type MermaidDirection = "TD" | "TB" | "BT" | "LR" | "RL"
export type MermaidDiagramKind = "flowchart" | "sequence" | "class"
export type MermaidEdgeEnd =
  | "arrow"
  | "circle"
  | "cross"
  | "triangle"
  | "diamond"
  | "diamond_outline"
  | "lollipop"

/** The subset of Mermaid's `style`/`classDef` properties Nib applies. */
export interface MermaidStyle {
  fill?: string
  stroke?: string
  strokeWidth?: number
  /** Label colour. */
  color?: string
  dashed?: boolean
}

export interface MermaidNode {
  id: string
  label: string
  shape: "rectangle" | "ellipse" | "diamond"
  rounded: boolean
  style?: MermaidStyle
  /** Class diagrams: the stereotype, attribute lines and method lines of the class box. */
  annotation?: string
  members?: string[]
  methods?: string[]
  /** A class diagram note, drawn as a sticky note. */
  note?: boolean
}

export interface MermaidEdge {
  from: string
  to: string
  label: string | null
  style: "solid" | "dashed" | "thick"
  /** True when the link has a marker at its target end. */
  arrow: boolean
  head: MermaidEdgeEnd | null
  tail: MermaidEdgeEnd | null
  /** Class diagram multiplicities, shown next to each end. */
  fromLabel?: string
  toLabel?: string
  /** From `linkStyle`. */
  stroke?: string
  strokeWidth?: number
}

/** A flowchart subgraph or class diagram namespace; it becomes a frame around its nodes. */
export interface MermaidSubgraph {
  id: string
  label: string
  /** Nodes directly inside it (not those of nested subgraphs). */
  nodes: string[]
  parent: string | null
  /** Its own `direction`, or null to follow the enclosing one. */
  direction: MermaidDirection | null
}

export interface MermaidParticipant {
  id: string
  label: string
  actor: boolean
}

export type MermaidMessageHead = "arrow" | "open" | "cross" | null

export interface MermaidMessage {
  kind: "message"
  from: string
  to: string
  label: string
  dashed: boolean
  head: MermaidMessageHead
  /** Set for two-way messages (`<<->>`). */
  tail: MermaidMessageHead
}

export interface MermaidNote {
  kind: "note"
  placement: "left" | "right" | "over"
  actors: string[]
  text: string
}

/** loop / alt / opt / par / critical / break, with else / and / option sections. */
export interface MermaidBlock {
  kind: "block"
  type: string
  label: string
  phase: "start" | "section" | "end"
}

export type MermaidStep = MermaidMessage | MermaidNote | MermaidBlock

export interface MermaidParseResult {
  ok: boolean
  error?: string
  kind: MermaidDiagramKind
  nodes: MermaidNode[]
  edges: MermaidEdge[]
  direction: MermaidDirection
  subgraphs: MermaidSubgraph[]
  /** Sequence diagrams only. */
  participants: MermaidParticipant[]
  steps: MermaidStep[]
  /** Lines and features that were skipped, for the import dialog to show. */
  warnings: string[]
}

interface ParsedNode extends MermaidNode {
  explicit: boolean
  classes: string[]
}

const SHAPES: { open: string; close: string[]; shape: MermaidNode["shape"]; rounded: boolean }[] = [
  { open: "(((", close: [")))"], shape: "ellipse", rounded: false },
  { open: "((", close: ["))"], shape: "ellipse", rounded: false },
  { open: "([", close: ["])"], shape: "rectangle", rounded: true },
  { open: "[[", close: ["]]"], shape: "rectangle", rounded: false },
  { open: "[(", close: [")]"], shape: "rectangle", rounded: true },
  { open: "{{", close: ["}}"], shape: "diamond", rounded: false },
  { open: "[/", close: ["/]", "\\]"], shape: "rectangle", rounded: false },
  { open: "[\\", close: ["\\]", "/]"], shape: "rectangle", rounded: false },
  { open: "{", close: ["}"], shape: "diamond", rounded: false },
  { open: "[", close: ["]"], shape: "rectangle", rounded: false },
  { open: "(", close: [")"], shape: "rectangle", rounded: true },
  { open: ">", close: ["]"], shape: "rectangle", rounded: false },
]

// a single - or . may sit inside an id (my-node, a.b); two in a row start a link
const ID = /^[\p{L}\p{N}_$](?:[\p{L}\p{N}_$]|[.-](?=[\p{L}\p{N}_$]))*/u
const CLASS_SUFFIX = /^:::([\p{L}\p{N}_-]+)/u
const END_MARK = "(?:>|[ox](?![\\p{L}\\p{N}_$]))"
const PLAIN_LINK = new RegExp(`^([<ox])?(-{2,}|={2,}|-\\.+-|~{3,})(${END_MARK})?`, "u")
const TEXT_LINK_START = /^([<ox])?(--|==|-\.)(?=\s)/
const TEXT_LINK_END: Record<string, RegExp> = {
  "--": new RegExp(`^(.*?)\\s*(?:-{2,}(${END_MARK})|-{3,})`, "u"),
  "==": new RegExp(`^(.*?)\\s*(?:={2,}(${END_MARK})|={3,})`, "u"),
  "-.": new RegExp(`^(.*?)\\s*\\.-+(${END_MARK})?`, "u"),
}

const endOf = (mark: string | undefined): MermaidEdgeEnd | null =>
  mark === ">" || mark === "<" ? "arrow" : mark === "o" ? "circle" : mark === "x" ? "cross" : null

interface Link {
  label: string | null
  style: MermaidEdge["style"]
  head: MermaidEdgeEnd | null
  tail: MermaidEdgeEnd | null
  invisible: boolean
}

class StatementReader {
  private i = 0
  constructor(private readonly s: string) {}

  private get rest(): string {
    return this.s.slice(this.i)
  }
  private skipSpace(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++
  }
  atEnd(): boolean {
    this.skipSpace()
    return this.i >= this.s.length
  }

  readGroup(): ParsedNode[] | null {
    this.skipSpace()
    const first = this.readNode()
    if (!first) return null
    const group = [first]
    for (;;) {
      this.skipSpace()
      if (this.s[this.i] !== "&") return group
      this.i++
      this.skipSpace()
      const next = this.readNode()
      if (!next) return null
      group.push(next)
    }
  }

  private readNode(): ParsedNode | null {
    const id = ID.exec(this.rest)?.[0]
    if (!id) return null
    this.i += id.length
    const shaped = this.readShape()
    const cls = CLASS_SUFFIX.exec(this.rest)
    if (cls) this.i += cls[0].length
    if (shaped === undefined) return null
    const classes = cls ? [cls[1]!] : []
    return shaped
      ? { id, label: shaped.label, shape: shaped.shape, rounded: shaped.rounded, explicit: true, classes }
      : { id, label: id, shape: "rectangle", rounded: false, explicit: false, classes }
  }

  // null when there is no shape, undefined when a shape was opened but never closed
  private readShape(): { label: string; shape: MermaidNode["shape"]; rounded: boolean } | null | undefined {
    const rest = this.rest
    let opened = false
    for (const { open, close, shape, rounded } of SHAPES) {
      if (!rest.startsWith(open)) continue
      opened = true
      const body = rest.slice(open.length)
      const quoted = /^\s*"([^"]*)"\s*/.exec(body)
      const candidates = quoted ? [quoted[0].length] : close.map((c) => body.indexOf(c)).filter((n) => n >= 0)
      for (const at of candidates.sort((a, b) => a - b)) {
        const closer = close.find((c) => body.startsWith(c, at))
        if (!closer) continue
        this.i += open.length + at + closer.length
        return { label: cleanLabel(quoted ? quoted[1]! : body.slice(0, at)), shape, rounded }
      }
    }
    return opened ? undefined : null
  }

  readLink(): Link | null {
    this.skipSpace()
    const rest = this.rest
    const textStart = TEXT_LINK_START.exec(rest)
    if (textStart) {
      const end = TEXT_LINK_END[textStart[2]!]!.exec(rest.slice(textStart[0].length))
      if (end && end[1]!.trim()) {
        this.i += textStart[0].length + end[0].length
        return this.withPipeLabel({
          label: cleanLabel(end[1]!),
          style: styleOf(textStart[2]!),
          head: endOf(end[2]),
          tail: endOf(textStart[1]),
          invisible: false,
        })
      }
    }
    const plain = PLAIN_LINK.exec(rest)
    // a bare -- or == only opens a "-- text -->" link
    if (!plain || ((plain[2] === "--" || plain[2] === "==") && !plain[3])) return null
    this.i += plain[0].length
    return this.withPipeLabel({
      label: null,
      style: styleOf(plain[2]!),
      head: endOf(plain[3]),
      tail: endOf(plain[1]),
      invisible: plain[2]!.startsWith("~"),
    })
  }

  private withPipeLabel(link: Link): Link {
    this.skipSpace()
    if (this.s[this.i] !== "|") return link
    const close = this.s.indexOf("|", this.i + 1)
    if (close < 0) return link
    const label = cleanLabel(this.s.slice(this.i + 1, close))
    this.i = close + 1
    return { ...link, label: label || link.label }
  }
}

const styleOf = (body: string): MermaidEdge["style"] =>
  body.includes("=") ? "thick" : body.includes(".") ? "dashed" : "solid"

const SUBGRAPH_TITLE = /^([^\s[\]"]+)\s*\[\s*([\s\S]*?)\s*\]$/

const emptyResult = (
  kind: MermaidDiagramKind,
  error: string,
  warnings: string[] = [],
): MermaidParseResult => ({
  ok: false,
  error,
  kind,
  nodes: [],
  edges: [],
  direction: "TD",
  subgraphs: [],
  participants: [],
  steps: [],
  warnings,
})

/** Reads flowchart / graph, sequenceDiagram and classDiagram sources. */
export const parseMermaid = (source: string): MermaidParseResult => {
  const statements = statementsOf(source)
  // mermaid always declares its diagram type first; anything else would be
  // guesswork, and guessing produces nonsense shapes
  const first = statements[0]?.text ?? ""
  if (/^(?:flowchart|graph)\b/i.test(first)) return parseFlowchart(statements)
  if (/^sequenceDiagram\b/.test(first)) return parseSequence(statements)
  if (/^classDiagram(?:-v2)?\b/.test(first)) return parseClassDiagram(statements)
  const word = /^([A-Za-z0-9-]+)/.exec(first)?.[1]
  // only a real diagram keyword is named back; the first word of plain text is not a diagram kind
  const kind = word && OTHER_DIAGRAM_KINDS.has(word.toLowerCase()) ? word : null
  return emptyResult(
    "flowchart",
    kind
      ? `Nib imports flowchart, sequence and class diagrams, not ${kind}.`
      : "Start your diagram with `flowchart TD`, `sequenceDiagram` or `classDiagram`.",
  )
}

/** Mermaid diagram types Nib does not import, lower-cased. */
const OTHER_DIAGRAM_KINDS: ReadonlySet<string> = new Set([
  "pie",
  "gantt",
  "erdiagram",
  "statediagram",
  "statediagram-v2",
  "journey",
  "gitgraph",
  "mindmap",
  "timeline",
  "quadrantchart",
  "requirementdiagram",
  "c4context",
  "c4container",
  "c4component",
  "c4dynamic",
  "c4deployment",
  "sankey",
  "sankey-beta",
  "xychart",
  "xychart-beta",
  "block",
  "block-beta",
  "packet",
  "packet-beta",
  "architecture",
  "architecture-beta",
  "kanban",
  "radar",
  "radar-beta",
  "treemap",
  "treemap-beta",
  "zenuml",
])

const parseFlowchart = (statements: readonly Statement[]): MermaidParseResult => {
  const nodes = new Map<string, MermaidNode>()
  const explicit = new Set<string>()
  const edges: MermaidEdge[] = []
  const warnings: string[] = []
  let direction: MermaidDirection = "TD"

  const subgraphs: MermaidSubgraph[] = []
  const mentioned = new Map<string, string[]>()
  const stack: MermaidSubgraph[] = []
  const claimed = new Map<string, string>()
  let generatedIds = 0

  const classDefs = new Map<string, MermaidStyle>()
  const nodeClasses = new Map<string, string[]>()
  const nodeStyles = new Map<string, MermaidStyle>()
  const linkStyles: { target: number | "default"; style: MermaidStyle }[] = []
  const edgeByLink = new Map<number, MermaidEdge>()
  let links = 0

  const register = (node: ParsedNode) => {
    if (!nodes.has(node.id) || node.explicit)
      nodes.set(node.id, { id: node.id, label: node.label, shape: node.shape, rounded: node.rounded })
    if (node.explicit) explicit.add(node.id)
    if (node.classes.length) nodeClasses.set(node.id, [...(nodeClasses.get(node.id) ?? []), ...node.classes])
    const open = stack[stack.length - 1]
    if (open) mentioned.get(open.id)!.push(node.id)
  }
  // like mermaid, the first subgraph to close claims a node, so inner subgraphs win over outer ones
  const close = (sg: MermaidSubgraph) => {
    for (const id of mentioned.get(sg.id) ?? []) if (!claimed.has(id)) claimed.set(id, sg.id)
  }
  const noted = new Set<string>()
  const noteOnce = (key: string, message: string) => {
    if (noted.has(key)) return
    noted.add(key)
    warnings.push(message)
  }

  for (const { text, line } of statements) {
    const header = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\b/i.exec(text)
    if (header) {
      if (header[1]) direction = header[1].toUpperCase() as MermaidDirection
      continue
    }
    const sub = /^subgraph(?:\s+([\s\S]*))?$/i.exec(text)
    if (sub) {
      const title = (sub[1] ?? "").trim()
      const bracketed = SUBGRAPH_TITLE.exec(title)
      let id: string
      let label: string
      if (bracketed) {
        id = bracketed[1]!
        label = cleanLabel(bracketed[2]!)
      } else {
        label = cleanLabel(title)
        id = label && !/\s/.test(label) ? label : `subgraph-${++generatedIds}`
      }
      const sg: MermaidSubgraph = {
        id,
        label,
        nodes: [],
        parent: stack[stack.length - 1]?.id ?? null,
        direction: null,
      }
      subgraphs.push(sg)
      mentioned.set(id, [])
      stack.push(sg)
      continue
    }
    if (/^end$/i.test(text)) {
      const sg = stack.pop()
      if (sg) close(sg)
      else warnings.push(`Line ${line}: "end" closes no subgraph, so it was skipped.`)
      continue
    }
    const dir = /^direction\s+(\w+)$/i.exec(text)
    if (dir) {
      const d = dir[1]!.toUpperCase()
      if (!DIRECTIONS.has(d)) continue
      const open = stack[stack.length - 1]
      if (open) open.direction = d as MermaidDirection
      else direction = d as MermaidDirection
      continue
    }
    const classDef = /^classDef\s+(\S+)\s+([\s\S]+)$/.exec(text)
    if (classDef) {
      for (const name of classDef[1]!.split(","))
        classDefs.set(name, { ...classDefs.get(name), ...parseStyleProps(classDef[2]!) })
      continue
    }
    const cls = /^class\s+(\S+)\s+(\S+)$/.exec(text)
    if (cls) {
      for (const id of cls[1]!.split(",")) nodeClasses.set(id, [...(nodeClasses.get(id) ?? []), cls[2]!])
      continue
    }
    const style = /^style\s+(\S+)\s+([\s\S]+)$/.exec(text)
    if (style) {
      nodeStyles.set(style[1]!, { ...nodeStyles.get(style[1]!), ...parseStyleProps(style[2]!) })
      continue
    }
    const linkStyle = /^linkStyle\s+(\S+)\s+([\s\S]+)$/.exec(text)
    if (linkStyle) {
      const parsedStyle = parseStyleProps(linkStyle[2]!)
      for (const target of linkStyle[1]!.split(",")) {
        if (target === "default") linkStyles.push({ target: "default", style: parsedStyle })
        else if (/^\d+$/.test(target)) linkStyles.push({ target: Number(target), style: parsedStyle })
      }
      continue
    }
    if (/^click\b/i.test(text)) {
      noteOnce("click", "Click handlers are not imported.")
      continue
    }

    const reader = new StatementReader(text)
    const stmtNodes: ParsedNode[] = []
    const stmtEdges: { edge: MermaidEdge | null }[] = []
    let group = reader.readGroup()
    let failed = group === null
    if (group) stmtNodes.push(...group)
    while (group && !reader.atEnd()) {
      const link = reader.readLink()
      const next = link ? reader.readGroup() : null
      if (!link || !next) {
        failed = true
        break
      }
      stmtNodes.push(...next)
      for (const a of group)
        for (const b of next)
          stmtEdges.push({
            edge: link.invisible
              ? null
              : {
                  from: a.id,
                  to: b.id,
                  label: link.label,
                  style: link.style,
                  arrow: link.head !== null,
                  head: link.head,
                  tail: link.tail,
                },
          })
      group = next
    }
    if (failed) {
      warnings.push(`Line ${line}: could not read "${text}", so it was skipped.`)
      continue
    }
    for (const n of stmtNodes) register(n)
    // linkStyle counts every link, invisible ones included
    for (const { edge } of stmtEdges) {
      const index = links++
      if (!edge) continue
      edges.push(edge)
      edgeByLink.set(index, edge)
    }
  }
  while (stack.length > 0) {
    const sg = stack.pop()!
    warnings.push(`Subgraph "${sg.label || sg.id}" has no end, so it was closed at the end of the diagram.`)
    close(sg)
  }

  // a link to a subgraph's id points at the subgraph, not at a node of that name
  const subgraphIds = new Set(subgraphs.map((s) => s.id))
  for (const id of subgraphIds) {
    if (!explicit.has(id)) {
      nodes.delete(id)
      claimed.delete(id)
    }
  }
  for (const [id, sg] of claimed) {
    if (nodes.has(id)) subgraphs.find((s) => s.id === sg)!.nodes.push(id)
  }
  for (const node of nodes.values()) {
    const s = mergeStyles(
      classDefs.get("default"),
      ...(nodeClasses.get(node.id) ?? []).map((c) => classDefs.get(c)),
      nodeStyles.get(node.id),
    )
    if (s) node.style = s
  }
  const applyLinkStyle = (edge: MermaidEdge, s: MermaidStyle) => {
    if (s.stroke) edge.stroke = s.stroke
    if (s.strokeWidth) edge.strokeWidth = s.strokeWidth
    if (s.dashed !== undefined)
      edge.style = s.dashed ? "dashed" : edge.style === "dashed" ? "solid" : edge.style
  }
  for (const { target, style: s } of linkStyles) {
    if (target === "default") for (const edge of edges) applyLinkStyle(edge, s)
    else {
      const edge = edgeByLink.get(target)
      if (edge) applyLinkStyle(edge, s)
    }
  }

  if (nodes.size === 0)
    return { ...emptyResult("flowchart", "No nodes found in that diagram.", warnings), direction }
  return {
    ok: true,
    kind: "flowchart",
    nodes: [...nodes.values()],
    edges,
    direction,
    subgraphs,
    participants: [],
    steps: [],
    warnings,
  }
}

/** Least distance between the bends of two edges that join the same nodes. */
const PARALLEL_SPREAD = 40
/** Room kept between the labels of such edges. */
const PARALLEL_LABEL_GAP = 12
const NODE_PADDING_X = 28
const NODE_PADDING_Y = 22
const MIN_WIDTH = 90
const MIN_HEIGHT = 48
const FRAME_PAD = 32
const FRAME_PAD_TOP = 40
const FRAME_MIN_W = 160
const FRAME_MIN_H = 90

const ARROWHEAD_FOR: Record<MermaidEdgeEnd, Arrowhead> = {
  arrow: "arrow",
  circle: "circle",
  cross: "bar",
  triangle: "triangle_outline",
  diamond: "diamond",
  diamond_outline: "diamond_outline",
  lollipop: "circle_outline",
}

// two different inner points make the bindings aim the loop's ends at different spots instead of one
const selfLoop = (el: NibElement): Point[] => {
  const inset = Math.min(el.width, el.height) * 0.25
  const reach = Math.max(28, Math.min(el.width, el.height) * 0.5)
  const right = el.x + el.width
  return [
    [right - inset, el.y],
    [right - inset, el.y - reach],
    [right + reach, el.y + inset],
    [right, el.y + inset],
  ]
}

export interface MermaidBuildOptions {
  appState: AppState
  origin: Point
  nextIndex(): string
}

/** Turns a parsed diagram into shapes, labels, frames and bound arrows, with keys above the scene. */
export const mermaidToElements = (parsed: MermaidParseResult, opts: MermaidBuildOptions): NibElement[] => {
  const elements = parsed.kind === "sequence" ? buildSequence(parsed, opts) : buildGraph(parsed, opts)
  if (elements.length === 0) return elements
  // keys continue from the caller's next index so the diagram lands above, and never ties with, the scene
  const first = opts.nextIndex()
  const keys = [first, ...indicesBetween(first, null, elements.length - 1)]
  return elements.map((el, i) => ({ ...el, index: keys[i]! }))
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const buildGraph = (parsed: MermaidParseResult, opts: MermaidBuildOptions): NibElement[] => {
  const { appState, origin } = opts
  const fontSize = 16
  const family = appState.currentItemFontFamily
  const nodeById = new Map(parsed.nodes.map((n) => [n.id, n]))
  const subgraphById = new Map(parsed.subgraphs.map((s) => [s.id, s]))
  const nodeCluster = new Map<string, string>()
  for (const sg of parsed.subgraphs) for (const id of sg.nodes) nodeCluster.set(id, sg.id)

  const classSizes = new Map<string, ReturnType<typeof classBoxSize>>()
  const sized = new Map<string, { w: number; h: number }>()
  for (const node of parsed.nodes) {
    if (isClassBox(node)) {
      const size = classBoxSize(node, family)
      classSizes.set(node.id, size)
      sized.set(node.id, { w: size.w, h: size.h })
      continue
    }
    const metrics = measureMultiline(node.label, fontSize, family)
    // a diamond only offers half its box to text, an ellipse about 1/sqrt2,
    // so the box has to grow to match the shape the label sits in
    const scale = node.shape === "diamond" ? 2 : node.shape === "ellipse" ? Math.SQRT2 : 1
    sized.set(node.id, {
      w: Math.max(MIN_WIDTH, metrics.width * scale + NODE_PADDING_X * 2),
      h: Math.max(MIN_HEIGHT, metrics.height * scale + NODE_PADDING_Y * 2),
    })
  }

  // the cluster an endpoint sits in: a node's subgraph, or the subgraph around a subgraph
  const clusterOf = (id: string): string | null =>
    subgraphById.has(id) && !nodeById.has(id)
      ? (subgraphById.get(id)!.parent ?? null)
      : (nodeCluster.get(id) ?? null)
  const memberKey = (id: string): string | null =>
    nodeById.has(id) ? `n:${id}` : subgraphById.has(id) ? `s:${id}` : null
  // which member of `cluster` an endpoint belongs to (itself or the subgraph holding it), or null if outside
  const memberAt = (id: string, cluster: string | null): string | null => {
    let key = memberKey(id)
    if (!key) return null
    let cur = clusterOf(id)
    while (cur !== cluster) {
      if (cur === null) return null
      key = `s:${cur}`
      cur = subgraphById.get(cur)!.parent
    }
    return key
  }
  const directionOf = (cluster: string | null): MermaidDirection =>
    cluster === null
      ? parsed.direction
      : (subgraphById.get(cluster)!.direction ?? directionOf(subgraphById.get(cluster)!.parent))

  const layouts = new Map<string | null, { w: number; h: number; layout: LayeredLayout }>()
  const layoutCluster = (cluster: string | null): { w: number; h: number } => {
    const items: LayoutItem[] = [
      ...parsed.nodes
        .filter((n) => (nodeCluster.get(n.id) ?? null) === cluster)
        .map((n) => ({ key: `n:${n.id}`, ...sized.get(n.id)! })),
      ...parsed.subgraphs
        .filter((s) => s.parent === cluster)
        .map((s) => ({ key: `s:${s.id}`, ...layoutCluster(s.id) })),
    ]
    const levelEdges: [string, string][] = []
    for (const e of parsed.edges) {
      const a = memberAt(e.from, cluster)
      const b = memberAt(e.to, cluster)
      if (a && b && a !== b) levelEdges.push([a, b])
    }
    const layout = layoutLayered(items, levelEdges, directionOf(cluster))
    const w = cluster === null ? layout.width : Math.max(FRAME_MIN_W, layout.width + FRAME_PAD * 2)
    const h =
      cluster === null ? layout.height : Math.max(FRAME_MIN_H, layout.height + FRAME_PAD_TOP + FRAME_PAD)
    layouts.set(cluster, { w, h, layout })
    return { w, h }
  }
  layoutCluster(null)

  const nodeBox = new Map<string, Box>()
  const frameBox = new Map<string, Box>()
  const place = (cluster: string | null, ox: number, oy: number) => {
    const { w, h, layout } = layouts.get(cluster)!
    const ix = cluster === null ? 0 : (w - layout.width) / 2
    const iy = cluster === null ? 0 : FRAME_PAD_TOP + (h - FRAME_PAD_TOP - FRAME_PAD - layout.height) / 2
    for (const [key, p] of layout.positions) {
      const id = key.slice(2)
      const x = ox + ix + p[0]
      const y = oy + iy + p[1]
      if (key.startsWith("n:")) nodeBox.set(id, { x, y, ...sized.get(id)! })
      else {
        const inner = layouts.get(id)!
        frameBox.set(id, { x, y, w: inner.w, h: inner.h })
        place(id, x, y)
      }
    }
  }
  place(null, origin[0], origin[1])

  const out: NibElement[] = []
  const frameIdOf = new Map<string, string>()
  for (const sg of parsed.subgraphs) {
    const box = frameBox.get(sg.id)
    if (!box) continue
    const frame = newElement("frame", {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      name: sg.label || sg.id,
    })
    frameIdOf.set(sg.id, frame.id)
    out.push(frame)
  }
  const frameFor = (cluster: string | null): string | null =>
    cluster ? (frameIdOf.get(cluster) ?? null) : null

  const shapeById = new Map<string, NibElement>()
  for (const node of parsed.nodes) {
    const box = nodeBox.get(node.id)!
    const style = node.note ? mergeStyles(NOTE_STYLE, node.style) : node.style
    const frameId = frameFor(nodeCluster.get(node.id) ?? null)
    const stroke = style?.stroke ?? appState.currentItemStrokeColor
    const fill = style?.fill ?? appState.currentItemBackgroundColor
    const fillStyle = style?.fill ? "solid" : appState.currentItemFillStyle
    const strokeWidth = style?.strokeWidth ?? appState.currentItemStrokeWidth
    const textColor = style?.color ?? appState.currentItemStrokeColor
    const classSize = classSizes.get(node.id)
    if (classSize) {
      const built = buildClassBox(node, box.x, box.y, classSize, {
        appState,
        frameId,
        stroke,
        fill,
        fillStyle,
        strokeWidth,
        textColor,
      })
      out.push(built.container, ...built.parts)
      shapeById.set(node.id, built.container)
      continue
    }
    const shape = newElement(node.shape, {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      frameId,
      strokeColor: stroke,
      backgroundColor: fill,
      fillStyle,
      strokeWidth,
      strokeStyle: style?.dashed ? "dashed" : "solid",
      roughness: appState.currentItemRoughness,
      roundness: node.rounded && node.shape === "rectangle" ? { type: 3 } : null,
    })
    const label = newElement("text", {
      x: shape.x,
      y: shape.y,
      width: 0,
      height: fontSize * 1.25,
      frameId,
      strokeColor: textColor,
      fontSize,
      fontFamily: family,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: shape.id,
      text: node.label,
      originalText: node.label,
    }) as TextElement

    const withBinding = { ...shape, boundElements: [{ id: label.id, type: "text" as const }] }
    const laid = layoutBoundText(withBinding, label)
    out.push(laid.container, laid.text)
    shapeById.set(node.id, laid.container)
  }

  // the innermost subgraph holding both ends, so an arrow is clipped only by a frame it lies inside
  const commonCluster = (a: string | null, b: string | null): string | null => {
    const chain = new Set<string>()
    for (let c = a; c; c = subgraphById.get(c)!.parent) chain.add(c)
    for (let c = b; c; c = subgraphById.get(c)!.parent) if (chain.has(c)) return c
    return null
  }
  const centerOf = (b: Box): Point => [b.x + b.w / 2, b.y + b.h / 2]
  const ends: { arrowId: string; fromLabel?: string; toLabel?: string; frameId: string | null }[] = []

  // edges joining the same two nodes would lie on top of each other, labels and all
  const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
  const pairs = new Map<string, MermaidEdge[]>()
  for (const edge of parsed.edges) {
    if (edge.from === edge.to) continue
    const key = pairKey(edge.from, edge.to)
    pairs.set(key, [...(pairs.get(key) ?? []), edge])
  }
  const labelSize = (edge: MermaidEdge): { w: number; h: number } => {
    if (!edge.label) return { w: 0, h: 0 }
    const m = measureMultiline(edge.label, fontSize - 2, family)
    return { w: m.width, h: m.height }
  }

  for (const edge of parsed.edges) {
    const from = shapeById.get(edge.from)
    const to = shapeById.get(edge.to)
    const fromFrame = from ? null : frameBox.get(edge.from)
    const toFrame = to ? null : frameBox.get(edge.to)
    if ((!from && !fromFrame) || (!to && !toFrame) || (fromFrame && fromFrame === toFrame)) continue
    const fromBox: Box = from ? { x: from.x, y: from.y, w: from.width, h: from.height } : fromFrame!
    const toBox: Box = to ? { x: to.x, y: to.y, w: to.width, h: to.height } : toFrame!
    let route: Point[]
    let bent = false
    if (from && from === to) route = selfLoop(from)
    else {
      const a = centerOf(fromBox)
      const b = centerOf(toBox)
      // an end at a frame stops at its border; an end at a shape is placed by its binding
      const start = from ? a : boxExitPoint(fromBox, b)
      const end = to ? b : boxExitPoint(toBox, a)
      route = [start, end]
      const others = [...nodeBox].filter(([id]) => id !== edge.from && id !== edge.to).map(([, box]) => box)
      const detour = from && to ? detourPoint(a, b, others) : null
      // the normal follows the pair's own order, so A->B and B->A bow out to opposite sides
      const [p, q] = edge.from < edge.to ? [start, end] : [end, start]
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const nx = -(q[1] - p[1]) / len
      const ny = (q[0] - p[0]) / len
      const siblings = pairs.get(pairKey(edge.from, edge.to)) ?? [edge]
      const spread = Math.max(
        PARALLEL_SPREAD,
        ...siblings.map((e) => {
          const size = labelSize(e)
          return Math.abs(nx) * size.w + Math.abs(ny) * size.h + PARALLEL_LABEL_GAP
        }),
      )
      const offset = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * spread
      if (detour || offset !== 0) {
        const base = detour ?? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        route = [start, [base[0] + nx * offset, base[1] + ny * offset], end]
        bent = true
      }
    }
    const frameId = frameFor(commonCluster(clusterOf(edge.from), clusterOf(edge.to)))
    const arrow = newElement("arrow", {
      ...rebased(route),
      frameId,
      strokeColor: edge.stroke ?? appState.currentItemStrokeColor,
      strokeWidth: edge.strokeWidth ?? (edge.style === "thick" ? 4 : appState.currentItemStrokeWidth),
      strokeStyle: edge.style === "dashed" ? "dashed" : "solid",
      roughness: appState.currentItemRoughness,
      roundness: (from && from === to) || bent ? { type: 2 } : null,
      startArrowhead: edge.tail ? ARROWHEAD_FOR[edge.tail] : null,
      endArrowhead: edge.head ? ARROWHEAD_FOR[edge.head] : null,
      startBinding: from ? { elementId: from.id, focus: 0, gap: 4 } : null,
      endBinding: to ? { elementId: to.id, focus: 0, gap: 4 } : null,
    })
    if (edge.fromLabel || edge.toLabel)
      ends.push({ arrowId: arrow.id, fromLabel: edge.fromLabel, toLabel: edge.toLabel, frameId })

    if (edge.label) {
      const label = newElement("text", {
        x: arrow.x,
        y: arrow.y,
        width: 0,
        height: fontSize * 1.25,
        frameId,
        strokeColor: appState.currentItemStrokeColor,
        fontSize: fontSize - 2,
        fontFamily: family,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: arrow.id,
        text: edge.label,
        originalText: edge.label,
      }) as TextElement
      const withBinding = { ...arrow, boundElements: [{ id: label.id, type: "text" as const }] }
      const laid = layoutBoundText(withBinding, label)
      out.push(laid.container, laid.text)
    } else {
      out.push(arrow)
    }
  }

  // arrows reference their shapes, so record the reverse links too
  const arrowsByShape = new Map<string, { id: string; type: "arrow" | "text" }[]>()
  for (const el of out) {
    if (el.type !== "arrow") continue
    for (const binding of [el.startBinding, el.endBinding]) {
      if (!binding) continue
      arrowsByShape.set(binding.elementId, [
        ...(arrowsByShape.get(binding.elementId) ?? []),
        { id: el.id, type: "arrow" },
      ])
    }
  }
  const linked = out.map((el) => {
    const extra = arrowsByShape.get(el.id)
    return extra ? { ...el, boundElements: [...(el.boundElements ?? []), ...extra] } : el
  })

  // solve the bindings now so arrows meet the shape outlines instead of
  // running to their centres
  const byId = new Map(linked.map((el) => [el.id, el]))
  const solved = linked.map((el) => (el.type === "arrow" ? updateBoundArrow(el, (id) => byId.get(id)) : el))
  const solvedById = new Map(solved.map((el) => [el.id, el]))
  const result = solved.map((el) => {
    if (el.type !== "text" || !el.containerId) return el
    const container = solvedById.get(el.containerId)
    return container && container.type === "arrow" ? layoutBoundText(container, el).text : el
  })
  for (const end of ends) {
    const arrow = solvedById.get(end.arrowId) as ArrowElement | undefined
    if (arrow) result.push(...endLabels(arrow, end, appState))
  }
  return result
}

// multiplicities sit just off each end, on the side away from the line
const endLabels = (
  arrow: ArrowElement,
  end: { fromLabel?: string; toLabel?: string; frameId: string | null },
  appState: AppState,
): NibElement[] => {
  const pts = arrow.points.map((p): Point => [arrow.x + p[0], arrow.y + p[1]])
  if (pts.length < 2) return []
  const out: NibElement[] = []
  const place = (text: string | undefined, tip: Point, toward: Point) => {
    if (!text) return
    const len = Math.hypot(toward[0] - tip[0], toward[1] - tip[1]) || 1
    const ux = (toward[0] - tip[0]) / len
    const uy = (toward[1] - tip[1]) / len
    const m = measureMultiline(text, 14, appState.currentItemFontFamily)
    const cx = tip[0] + ux * 18 - uy * 14
    const cy = tip[1] + uy * 18 + ux * 14
    out.push(
      newElement("text", {
        x: cx - m.width / 2,
        y: cy - m.height / 2,
        width: m.width,
        height: m.height,
        frameId: end.frameId,
        strokeColor: appState.currentItemStrokeColor,
        fontSize: 14,
        fontFamily: appState.currentItemFontFamily,
        textAlign: "center",
        text,
        originalText: text,
      }),
    )
  }
  place(end.fromLabel, pts[0]!, pts[1]!)
  place(end.toLabel, pts[pts.length - 1]!, pts[pts.length - 2]!)
  return out
}
