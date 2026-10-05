import { layoutBoundText } from "../geometry/boundText"
import { randomId } from "../math/random"
import { newElement } from "../model/element"
import type { AppState, FontFamily, NibElement, TextElement } from "../model/types"
import { lineHeightPx, measureMultiline } from "../render/textMeasure"
import type {
  MermaidDirection,
  MermaidEdge,
  MermaidEdgeEnd,
  MermaidNode,
  MermaidParseResult,
  MermaidStyle,
  MermaidSubgraph,
} from "./mermaid"
import {
  DIRECTIONS,
  type Statement,
  cleanLabel,
  mergeStyles,
  parseStyleProps,
  splitTopLevel,
} from "./mermaidSyntax"

const NAME = /^(?:`([^`]+)`|([\p{L}\p{N}_$][\p{L}\p{N}_$-]*))(~[^~]*~)?/u
const RELATION = /^(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?/
const QUOTED = /^"([^"]*)"/

const END_FOR: Record<string, MermaidEdgeEnd> = {
  "<|": "triangle",
  "|>": "triangle",
  "*": "diamond",
  o: "diamond_outline",
  "<": "arrow",
  ">": "arrow",
  "()": "lollipop",
}

const generic = (g: string | undefined): string => (g ? `<${g.slice(1, -1).replace(/~/g, "")}>` : "")
const displayMember = (text: string): string => text.trim().replace(/~([^~]*)~/g, "<$1>")

interface ClassRef {
  id: string
  label: string
  length: number
}

const readName = (text: string): ClassRef | null => {
  const m = NAME.exec(text)
  if (!m) return null
  const id = m[1] ?? m[2]!
  return { id, label: `${id}${generic(m[3])}`, length: m[0].length }
}

/** Reads a `classDiagram`: classes with their members, relations, notes and namespaces. */
export const parseClassDiagram = (statements: readonly Statement[]): MermaidParseResult => {
  const nodes = new Map<string, MermaidNode>()
  const edges: MermaidEdge[] = []
  const warnings: string[] = []
  const subgraphs: MermaidSubgraph[] = []
  const namespaceStack: MermaidSubgraph[] = []
  const classDefs = new Map<string, MermaidStyle>()
  const nodeClasses = new Map<string, string[]>()
  const nodeStyles = new Map<string, MermaidStyle>()
  let direction: MermaidDirection = "TB"
  let openClass: MermaidNode | null = null
  let notes = 0
  const noted = new Set<string>()
  const noteOnce = (key: string, message: string) => {
    if (noted.has(key)) return
    noted.add(key)
    warnings.push(message)
  }

  const inNamespace = new Set<string>()
  // a class joins the namespace it is declared in, even when a relation mentioned it earlier
  const claim = (id: string) => {
    const ns = namespaceStack[namespaceStack.length - 1]
    if (!ns || inNamespace.has(id)) return
    inNamespace.add(id)
    ns.nodes.push(id)
  }
  const ensure = (ref: ClassRef): MermaidNode => {
    let node = nodes.get(ref.id)
    if (!node) {
      node = { id: ref.id, label: ref.label, shape: "rectangle", rounded: false, members: [], methods: [] }
      nodes.set(ref.id, node)
      claim(ref.id)
    } else if (ref.label !== ref.id && node.label === node.id) {
      node.label = ref.label
    }
    return node
  }
  const addMember = (node: MermaidNode, raw: string) => {
    const text = raw.trim()
    if (!text) return
    const annotation = /^<<(.+)>>$/.exec(text)
    if (annotation) {
      node.annotation = annotation[1]!.trim()
      return
    }
    // mermaid's rule: anything with parentheses is a method
    if (text.includes("(")) node.methods!.push(displayMember(text))
    else node.members!.push(displayMember(text))
  }
  const addClasses = (id: string, names: string) => {
    for (const cls of names
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean))
      nodeClasses.set(id, [...(nodeClasses.get(id) ?? []), cls])
  }

  for (const { text, line } of statements) {
    if (openClass) {
      const close = text.lastIndexOf("}")
      if (close >= 0) {
        addMember(openClass, text.slice(0, close))
        openClass = null
      } else addMember(openClass, text)
      continue
    }
    if (/^classDiagram(?:-v2)?\b/.test(text)) continue
    const dir = /^direction\s+(\w+)$/i.exec(text)
    if (dir) {
      const d = dir[1]!.toUpperCase()
      if (DIRECTIONS.has(d)) direction = d as MermaidDirection
      continue
    }
    const ns = /^namespace\s+(.+?)\s*\{?$/.exec(text)
    if (ns) {
      const label = cleanLabel(ns[1]!)
      const sg: MermaidSubgraph = {
        id: `namespace:${label}:${subgraphs.length}`,
        label,
        nodes: [],
        parent: namespaceStack[namespaceStack.length - 1]?.id ?? null,
        direction: null,
      }
      subgraphs.push(sg)
      namespaceStack.push(sg)
      continue
    }
    if (text === "}") {
      if (namespaceStack.length > 0) namespaceStack.pop()
      continue
    }
    if (/^(?:click|link|callback)\b/.test(text)) {
      noteOnce("click", "Click handlers and links are not imported.")
      continue
    }
    const classDef = /^classDef\s+(\S+)\s+(.+)$/.exec(text)
    if (classDef) {
      for (const name of classDef[1]!.split(","))
        classDefs.set(name, { ...classDefs.get(name), ...parseStyleProps(classDef[2]!) })
      continue
    }
    const cssClass = /^cssClass\s+"([^"]+)"\s+(\S+)$/.exec(text)
    if (cssClass) {
      for (const id of splitTopLevel(cssClass[1]!)) addClasses(id, cssClass[2]!)
      continue
    }
    const style = /^style\s+(\S+)\s+(.+)$/.exec(text)
    if (style) {
      nodeStyles.set(style[1]!, { ...nodeStyles.get(style[1]!), ...parseStyleProps(style[2]!) })
      continue
    }
    const note = /^note\s+(?:for\s+(\S+)\s+)?"([\s\S]*)"$/i.exec(text)
    if (note) {
      const id = `note:${notes++}`
      nodes.set(id, {
        id,
        label: cleanLabel(note[2]!.replace(/\\n/g, "\n")),
        shape: "rectangle",
        rounded: false,
        note: true,
      })
      const target = note[1] ? readName(note[1]) : null
      if (target)
        edges.push({
          from: id,
          to: ensure(target).id,
          label: null,
          style: "dashed",
          arrow: false,
          head: null,
          tail: null,
        })
      continue
    }
    const annotation = /^<<(.+?)>>\s*(.+)$/.exec(text)
    if (annotation) {
      const ref = readName(annotation[2]!.trim())
      if (ref) {
        ensure(ref).annotation = annotation[1]!.trim()
        continue
      }
    }
    const decl = /^class\s+(.+)$/.exec(text)
    if (decl) {
      let rest = decl[1]!.trim()
      const ref = readName(rest)
      if (!ref) {
        warnings.push(`Line ${line}: could not read "${text}", so it was skipped.`)
        continue
      }
      const node = ensure(ref)
      claim(ref.id)
      rest = rest.slice(ref.length).trim()
      const label = /^\[\s*"?([^"\]]*)"?\s*\]/.exec(rest)
      if (label) {
        node.label = cleanLabel(label[1]!)
        rest = rest.slice(label[0].length).trim()
      }
      const cls = /^:::([\p{L}\p{N}_-]+)/u.exec(rest)
      if (cls) {
        addClasses(ref.id, cls[1]!)
        rest = rest.slice(cls[0].length).trim()
      }
      if (rest.startsWith("{")) {
        const body = rest.slice(1)
        const close = body.lastIndexOf("}")
        if (close >= 0) addMember(node, body.slice(0, close))
        else {
          addMember(node, body)
          openClass = node
        }
      }
      continue
    }
    if (readRelation(text, ensure, edges)) continue
    const memberOf = /^(.+?)\s*:\s*(.+)$/.exec(text)
    const owner = memberOf ? readName(memberOf[1]!) : null
    if (memberOf && owner && owner.length === memberOf[1]!.length) {
      addMember(ensure(owner), memberOf[2]!)
      continue
    }
    const bare = readName(text)
    if (bare && bare.length === text.length) {
      ensure(bare)
      continue
    }
    warnings.push(`Line ${line}: could not read "${text}", so it was skipped.`)
  }
  if (openClass)
    warnings.push(`The class ${openClass.id} has no closing }, so its members end at the diagram's end.`)

  for (const node of nodes.values()) {
    const style = mergeStyles(
      classDefs.get("default"),
      ...(nodeClasses.get(node.id) ?? []).map((c) => classDefs.get(c)),
      nodeStyles.get(node.id),
    )
    if (style) node.style = style
  }

  const base = { kind: "class" as const, direction, warnings, participants: [], steps: [] }
  if (nodes.size === 0)
    return {
      ...base,
      ok: false,
      error: "No classes found in that diagram.",
      nodes: [],
      edges: [],
      subgraphs: [],
    }
  return { ...base, ok: true, nodes: [...nodes.values()], edges, subgraphs }
}

const readRelation = (
  text: string,
  ensure: (ref: ClassRef) => MermaidNode,
  edges: MermaidEdge[],
): boolean => {
  const left = readName(text)
  if (!left) return false
  let rest = text.slice(left.length).trimStart()
  const fromCard = QUOTED.exec(rest)
  if (fromCard) rest = rest.slice(fromCard[0].length).trimStart()
  const rel = RELATION.exec(rest)
  if (!rel) return false
  rest = rest.slice(rel[0].length).trimStart()
  const toCard = QUOTED.exec(rest)
  if (toCard) rest = rest.slice(toCard[0].length).trimStart()
  const right = readName(rest)
  if (!right) return false
  rest = rest.slice(right.length).trim()
  if (rest && !rest.startsWith(":")) return false
  const label = rest ? cleanLabel(rest.slice(1)) || null : null
  ensure(left)
  ensure(right)
  const head = rel[3] ? END_FOR[rel[3]]! : null
  const edge: MermaidEdge = {
    from: left.id,
    to: right.id,
    label,
    style: rel[2] === ".." ? "dashed" : "solid",
    arrow: head !== null,
    head,
    tail: rel[1] ? END_FOR[rel[1]]! : null,
  }
  if (fromCard?.[1]) edge.fromLabel = fromCard[1]
  if (toCard?.[1]) edge.toLabel = toCard[1]
  edges.push(edge)
  return true
}

const HEADER_SIZE = 16
const MEMBER_SIZE = 14
const PAD_X = 14
const SECTION_PAD = 6
const EMPTY_SECTION = 12
const MIN_WIDTH = 120

export const isClassBox = (node: MermaidNode): boolean =>
  node.members !== undefined || node.methods !== undefined || node.annotation !== undefined

const headerText = (node: MermaidNode): string =>
  node.annotation ? `«${node.annotation}»\n${node.label}` : node.label

interface ClassBoxSize {
  w: number
  h: number
  header: number
  members: number
  methods: number
}

const sectionHeight = (lines: readonly string[], family: FontFamily): number =>
  lines.length === 0
    ? EMPTY_SECTION
    : measureMultiline(lines.join("\n"), MEMBER_SIZE, family).height + SECTION_PAD * 2

export const classBoxSize = (node: MermaidNode, family: FontFamily): ClassBoxSize => {
  const header = measureMultiline(headerText(node), HEADER_SIZE, family)
  const members = node.members ?? []
  const methods = node.methods ?? []
  const widest = Math.max(
    header.width,
    members.length ? measureMultiline(members.join("\n"), MEMBER_SIZE, family).width : 0,
    methods.length ? measureMultiline(methods.join("\n"), MEMBER_SIZE, family).width : 0,
  )
  const headerH = Math.max(header.height, lineHeightPx(HEADER_SIZE)) + 18
  const membersH = sectionHeight(members, family)
  const methodsH = sectionHeight(methods, family)
  return {
    w: Math.max(MIN_WIDTH, widest + PAD_X * 2),
    h: headerH + membersH + methodsH,
    header: headerH,
    members: membersH,
    methods: methodsH,
  }
}

interface ClassBoxProps {
  appState: AppState
  frameId: string | null
  stroke: string
  fill: string
  fillStyle: NibElement["fillStyle"]
  strokeWidth: number
  textColor: string
}

/**
 * A UML class box: the rectangle (which arrows bind to) labelled with the class name, then attribute
 * and method compartments, all in one group.
 */
export const buildClassBox = (
  node: MermaidNode,
  x: number,
  y: number,
  size: ClassBoxSize,
  props: ClassBoxProps,
): { container: NibElement; parts: NibElement[] } => {
  const { appState, frameId } = props
  const family = appState.currentItemFontFamily
  const groupIds = [randomId()]
  const common = {
    frameId,
    groupIds,
    strokeColor: props.stroke,
    roughness: appState.currentItemRoughness,
  }
  const rect = newElement("rectangle", {
    ...common,
    x,
    y,
    width: size.w,
    height: size.h,
    backgroundColor: props.fill,
    fillStyle: props.fillStyle,
    strokeWidth: props.strokeWidth,
  })
  const title = newElement("text", {
    ...common,
    strokeColor: props.textColor,
    x,
    y,
    width: 0,
    height: lineHeightPx(HEADER_SIZE),
    fontSize: HEADER_SIZE,
    fontFamily: family,
    textAlign: "center",
    // top, so relaying out the label after an edit keeps it in the header compartment
    verticalAlign: "top",
    containerId: rect.id,
    text: headerText(node),
    originalText: headerText(node),
  }) as TextElement
  const laid = layoutBoundText({ ...rect, boundElements: [{ id: title.id, type: "text" as const }] }, title)
  const container = laid.container
  const parts: NibElement[] = [laid.text]

  const divider = (at: number) =>
    newElement("line", {
      ...common,
      x,
      y: at,
      width: size.w,
      height: 0,
      strokeWidth: props.strokeWidth,
      points: [
        [0, 0],
        [size.w, 0],
      ],
    })
  const section = (lines: readonly string[], top: number) => {
    if (lines.length === 0) return
    const text = lines.join("\n")
    const metrics = measureMultiline(text, MEMBER_SIZE, family)
    parts.push(
      newElement("text", {
        ...common,
        strokeColor: props.textColor,
        x: x + PAD_X,
        y: top + SECTION_PAD,
        width: metrics.width,
        height: metrics.height,
        fontSize: MEMBER_SIZE,
        fontFamily: family,
        textAlign: "left",
        text,
        originalText: text,
      }),
    )
  }
  parts.push(divider(y + size.header))
  section(node.members ?? [], y + size.header)
  parts.push(divider(y + size.header + size.members))
  section(node.methods ?? [], y + size.header + size.members)
  return { container, parts }
}

/** Sticky-note colours for class diagram notes, as Mermaid draws them. */
export const NOTE_STYLE: MermaidStyle = { fill: "#fff3bf", stroke: "#f08c00" }
