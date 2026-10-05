import { layoutBoundText } from "../geometry/boundText"
import { randomId } from "../math/random"
import type { Point } from "../math/vector"
import { newElement } from "../model/element"
import type { Arrowhead, NibElement, TextElement } from "../model/types"
import { lineHeightPx, measureMultiline } from "../render/textMeasure"
import type {
  MermaidBuildOptions,
  MermaidMessage,
  MermaidMessageHead,
  MermaidParseResult,
  MermaidParticipant,
  MermaidStep,
} from "./mermaid"
import { rebased } from "./mermaidLayout"
import { type Statement, cleanLabel } from "./mermaidSyntax"

// longest first, so "-->>" is not read as "-->" followed by ">"
const ARROWS = ["<<-->>", "<<->>", "-->>", "->>", "--x", "-x", "--)", "-)", "-->", "->"]
const PARTICIPANT = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*([\s\S]*)$/i
const BLOCK_START = /^(loop|alt|opt|par_over|par|critical|break|rect|box)\b\s*([\s\S]*)$/i
const BLOCK_SECTION = /^(else|and|option)\b\s*([\s\S]*)$/i

const headOf = (token: string): { dashed: boolean; head: MermaidMessageHead; tail: MermaidMessageHead } => {
  const dashed = token.includes("--")
  if (token.startsWith("<<")) return { dashed, head: "arrow", tail: "arrow" }
  if (token.endsWith(">>")) return { dashed, head: "arrow", tail: null }
  if (token.endsWith("x")) return { dashed, head: "cross", tail: null }
  if (token.endsWith(")")) return { dashed, head: "open", tail: null }
  return { dashed, head: null, tail: null }
}

const actorName = (raw: string): string => cleanLabel(raw.replace(/@\{[\s\S]*\}$/, "").trim())

const readMessage = (text: string): { from: string; to: string; token: string; label: string } | null => {
  const colon = text.indexOf(":")
  const head = colon >= 0 ? text.slice(0, colon) : text
  for (let i = 1; i < head.length; i++) {
    const token = ARROWS.find((a) => head.startsWith(a, i))
    if (!token) continue
    const from = head.slice(0, i).trim()
    const rest = head.slice(i + token.length).trim()
    // "my-xyz->>B" must not split at "-x"
    if (ARROWS.some((a) => rest.includes(a))) continue
    const to = rest.replace(/^[+-]\s*/, "")
    if (from && to) return { from, to, token, label: colon >= 0 ? text.slice(colon + 1) : "" }
  }
  return null
}

/** Reads a `sequenceDiagram`: participants, messages, notes and loop/alt/opt/par blocks. */
export const parseSequence = (statements: readonly Statement[]): MermaidParseResult => {
  const participants = new Map<string, MermaidParticipant>()
  const steps: MermaidStep[] = []
  const warnings: string[] = []
  const blocks: string[] = []
  let numbering: { next: number; step: number } | null = null
  const noted = new Set<string>()
  const noteOnce = (key: string, message: string) => {
    if (noted.has(key)) return
    noted.add(key)
    warnings.push(message)
  }
  const participant = (id: string): string => {
    if (!participants.has(id)) participants.set(id, { id, label: id, actor: false })
    return id
  }

  for (const { text, line } of statements) {
    if (/^sequenceDiagram\b/.test(text)) continue
    const p = PARTICIPANT.exec(text)
    if (p) {
      if (/^create\b/i.test(text))
        noteOnce("create", "Created and destroyed participants are drawn for the whole diagram.")
      const id = actorName(p[2]!)
      const existing = participants.get(id)
      const label = p[3] ? actorName(p[3]) : (existing?.label ?? id)
      participants.set(id, { id, label, actor: p[1]!.toLowerCase() === "actor" })
      continue
    }
    const auto = /^autonumber\b\s*(.*)$/i.exec(text)
    if (auto) {
      const args = auto[1]!.trim()
      if (args === "off") numbering = null
      else {
        const [start, step] = args ? args.split(/\s+/).map(Number) : []
        numbering = {
          next: Number.isFinite(start) ? start! : 1,
          step: Number.isFinite(step) && step! > 0 ? step! : 1,
        }
      }
      continue
    }
    if (/^(?:activate|deactivate)\s/i.test(text)) {
      noteOnce("activation", "Activation bars are not drawn.")
      continue
    }
    if (/^destroy\s/i.test(text)) {
      noteOnce("create", "Created and destroyed participants are drawn for the whole diagram.")
      continue
    }
    if (/^(?:title|accTitle|accDescr)\b/i.test(text)) {
      noteOnce("title", "Diagram titles are not imported.")
      continue
    }
    if (/^(?:links?|properties|details)\s/i.test(text)) {
      noteOnce("links", "Participant menus and links are not imported.")
      continue
    }
    const note = NOTE.exec(text)
    if (note) {
      const placement = note[1]!.toLowerCase()
      steps.push({
        kind: "note",
        placement: placement === "over" ? "over" : placement === "left of" ? "left" : "right",
        actors: note[2]!.split(",").map((a) => participant(actorName(a))),
        text: cleanLabel(note[3]!),
      })
      continue
    }
    const start = BLOCK_START.exec(text)
    if (start) {
      const type = start[1]!.toLowerCase()
      blocks.push(type)
      if (type === "rect") noteOnce("rect", "Background highlights (rect) are not drawn.")
      if (type === "box") noteOnce("box", "Participant boxes are not drawn.")
      steps.push({ kind: "block", type, label: cleanLabel(start[2]!), phase: "start" })
      continue
    }
    const section = BLOCK_SECTION.exec(text)
    if (section && blocks.length > 0) {
      steps.push({
        kind: "block",
        type: section[1]!.toLowerCase(),
        label: cleanLabel(section[2]!),
        phase: "section",
      })
      continue
    }
    if (/^end$/i.test(text)) {
      const type = blocks.pop()
      if (type) steps.push({ kind: "block", type, label: "", phase: "end" })
      else warnings.push(`Line ${line}: "end" closes nothing, so it was skipped.`)
      continue
    }
    const m = readMessage(text)
    if (m) {
      const from = participant(actorName(m.from))
      const to = participant(actorName(m.to))
      let label = cleanLabel(m.label)
      if (numbering) {
        label = label ? `${numbering.next}. ${label}` : String(numbering.next)
        numbering.next += numbering.step
      }
      steps.push({ kind: "message", from, to, label, ...headOf(m.token) })
      continue
    }
    warnings.push(`Line ${line}: could not read "${text}", so it was skipped.`)
  }
  while (blocks.length > 0) {
    const type = blocks.pop()!
    warnings.push(`A ${type} block has no end, so it was closed at the end of the diagram.`)
    steps.push({ kind: "block", type, label: "", phase: "end" })
  }

  const base = {
    kind: "sequence" as const,
    direction: "LR" as const,
    warnings,
    nodes: [],
    edges: [],
    subgraphs: [],
  }
  if (participants.size === 0)
    return {
      ...base,
      ok: false,
      error: "No participants found in that diagram.",
      participants: [],
      steps: [],
    }
  return { ...base, ok: true, participants: [...participants.values()], steps }
}

const FONT = 16
const MESSAGE_FONT = 14
const BOX_PAD_X = 20
const BOX_MIN_W = 110
const BOX_MIN_H = 48
const COLUMN_GAP = 50
const SELF_REACH = 44
// room left of and right of a centred label, so the line still shows on both sides of it
const LINE_SHOWING = 100
const NOTE_FILL = "#fff3bf"
const NOTE_STROKE = "#f08c00"
const FRAMED_BLOCKS = new Set(["loop", "alt", "opt", "par", "par_over", "critical", "break"])

const HEAD_FOR: Record<NonNullable<MermaidMessageHead>, Arrowhead> = {
  arrow: "triangle",
  open: "arrow",
  cross: "bar",
}

interface OpenBlock {
  type: string
  label: string
  top: number
  actors: Set<string>
  sections: { y: number; type: string; label: string }[]
}

/** Lifelines with participant boxes at both ends, horizontal message arrows and notes, top to bottom. */
export const buildSequence = (parsed: MermaidParseResult, opts: MermaidBuildOptions): NibElement[] => {
  const { appState, origin } = opts
  const family = appState.currentItemFontFamily
  const stroke = appState.currentItemStrokeColor
  const roughness = appState.currentItemRoughness
  const strokeWidth = appState.currentItemStrokeWidth
  const participants = parsed.participants
  const column = new Map(participants.map((p, i) => [p.id, i]))

  const boxes = participants.map((p) => {
    const m = measureMultiline(p.label, FONT, family)
    return { w: Math.max(BOX_MIN_W, m.width + BOX_PAD_X * 2), h: Math.max(BOX_MIN_H, m.height + 24) }
  })
  const boxH = Math.max(...boxes.map((b) => b.h))

  // columns start a box apart and widen until every message label fits between its two lifelines
  const centers: number[] = []
  boxes.forEach((b, i) => {
    centers.push(i === 0 ? b.w / 2 : centers[i - 1]! + boxes[i - 1]!.w / 2 + COLUMN_GAP + b.w / 2)
  })
  const labelWidth = (text: string) => (text ? measureMultiline(text, MESSAGE_FONT, family).width : 0)
  // a self message's label is centred on the loop's far side, and an arrow label wraps past 90% of its width
  const selfReach = (label: string) => Math.max(SELF_REACH, labelWidth(label) / 0.9 + 4)
  const selfExtent = new Map<string, number>()
  const spans = parsed.steps
    .filter((s): s is MermaidMessage => s.kind === "message")
    .map((s) => {
      const a = column.get(s.from)!
      const b = column.get(s.to)!
      if (a !== b) return { lo: Math.min(a, b), hi: Math.max(a, b), need: labelWidth(s.label) + LINE_SHOWING }
      const extent = selfReach(s.label) + labelWidth(s.label) / 2
      selfExtent.set(s.from, Math.max(selfExtent.get(s.from) ?? 0, extent))
      return { lo: a, hi: a, need: extent + 24 }
    })
    .sort((x, y) => x.hi - x.lo - (y.hi - y.lo))
  for (const span of spans) {
    const hi = span.lo === span.hi ? Math.min(span.hi + 1, centers.length - 1) : span.hi
    const deficit = span.need - (centers[hi]! - centers[span.lo]!)
    if (deficit <= 0 || hi === span.lo) continue
    for (let i = hi; i < centers.length; i++) centers[i]! += deficit
  }

  const x0 = origin[0]
  const y0 = origin[1]
  const xOf = (id: string) => x0 + centers[column.get(id)!]!
  const halfBox = (id: string) => boxes[column.get(id)!]!.w / 2

  const frames: NibElement[] = []
  const notes: NibElement[] = []
  const messages: NibElement[] = []
  const open: OpenBlock[] = []
  let y = y0 + boxH + 36

  const textEl = (text: string, size: number, extra: Record<string, unknown> = {}) =>
    newElement("text", {
      x: 0,
      y: 0,
      width: 0,
      height: lineHeightPx(size),
      strokeColor: stroke,
      fontSize: size,
      fontFamily: family,
      textAlign: "center",
      verticalAlign: "middle",
      text,
      originalText: text,
      ...extra,
    }) as TextElement
  const labelled = (container: NibElement, text: string, size: number, out: NibElement[]) => {
    if (!text) {
      out.push(container)
      return
    }
    const label = textEl(text, size, { containerId: container.id })
    const laid = layoutBoundText({ ...container, boundElements: [{ id: label.id, type: "text" }] }, label)
    out.push(laid.container, laid.text)
  }
  const touch = (...ids: string[]) => {
    for (const block of open) for (const id of ids) block.actors.add(id)
  }

  for (const step of parsed.steps) {
    if (step.kind === "message") {
      touch(step.from, step.to)
      const labelH = step.label ? measureMultiline(step.label, MESSAGE_FONT, family).height : 0
      const self = step.from === step.to
      const lineY = y + (self ? 0 : labelH / 2 + 4)
      const fx = xOf(step.from)
      const reach = selfReach(step.label)
      const loopH = Math.max(28, labelH + 24)
      const route: Point[] = self
        ? [
            [fx, lineY],
            [fx + reach, lineY],
            [fx + reach, lineY + loopH],
            [fx, lineY + loopH],
          ]
        : [
            [fx, lineY],
            [xOf(step.to), lineY],
          ]
      const arrow = newElement("arrow", {
        ...rebased(route),
        strokeColor: stroke,
        strokeWidth,
        strokeStyle: step.dashed ? "dashed" : "solid",
        roughness,
        startArrowhead: step.tail ? HEAD_FOR[step.tail] : null,
        endArrowhead: step.head ? HEAD_FOR[step.head] : null,
      })
      labelled(arrow, step.label, MESSAGE_FONT, messages)
      y += self ? loopH + 28 : Math.max(44, labelH + 30)
      continue
    }
    if (step.kind === "note") {
      touch(...step.actors)
      const m = measureMultiline(step.text, MESSAGE_FONT, family)
      const xs = step.actors.map(xOf)
      let w = Math.max(80, m.width + 24)
      const h = m.height + 20
      let x: number
      if (step.placement === "over") {
        const lo = Math.min(...xs)
        const hi = Math.max(...xs)
        w = Math.max(w, hi - lo + 40)
        x = (lo + hi) / 2 - w / 2
      } else if (step.placement === "left") x = Math.min(...xs) - 12 - w
      else x = Math.max(...xs) + 12
      const box = newElement("rectangle", {
        x,
        y,
        width: w,
        height: h,
        strokeColor: NOTE_STROKE,
        backgroundColor: NOTE_FILL,
        fillStyle: "solid",
        strokeWidth: 1,
        roughness,
      })
      labelled(box, step.text, MESSAGE_FONT, notes)
      y += h + 16
      continue
    }
    if (step.phase === "start") {
      open.push({ type: step.type, label: step.label, top: y, actors: new Set(), sections: [] })
      y += 20
    } else if (step.phase === "section") {
      const block = open[open.length - 1]
      if (block) block.sections.push({ y: y + 4, type: step.type, label: step.label })
      y += 28
    } else {
      const block = open.pop()
      if (!block) continue
      y += 8
      if (FRAMED_BLOCKS.has(block.type)) frames.push(...blockFrame(block, y))
      y += 24
    }
  }

  function blockFrame(block: OpenBlock, bottom: number): NibElement[] {
    const ids = block.actors.size > 0 ? [...block.actors] : participants.map((p) => p.id)
    let lo = Math.min(...ids.map((id) => xOf(id) - halfBox(id))) - 12
    let hi = Math.max(...ids.map((id) => xOf(id) + halfBox(id))) + 12
    // a self message loops out to the right of its lifeline
    hi = Math.max(hi, ...ids.map((id) => xOf(id) + (selfExtent.get(id) ?? 0) + 12))
    lo = Math.min(lo, hi - 160)
    const name = block.label ? `${block.type} ${block.label}` : block.type
    const frame = newElement("frame", {
      x: lo,
      y: block.top,
      width: hi - lo,
      height: bottom - block.top,
      name,
    })
    const out: NibElement[] = [frame]
    for (const section of block.sections) {
      out.push(
        newElement("line", {
          ...rebased([
            [lo, section.y],
            [hi, section.y],
          ]),
          strokeColor: stroke,
          strokeWidth: 1,
          strokeStyle: "dashed",
          roughness,
        }),
      )
      const text = section.label ? `[${section.label}]` : `[${section.type}]`
      const m = measureMultiline(text, MESSAGE_FONT, family)
      out.push(
        newElement("text", {
          x: lo + 8,
          y: section.y + 4,
          width: m.width,
          height: m.height,
          strokeColor: stroke,
          fontSize: MESSAGE_FONT,
          fontFamily: family,
          textAlign: "left",
          text,
          originalText: text,
        }),
      )
    }
    return out
  }

  const bottom = y
  const lifelines: NibElement[] = []
  participants.forEach((p, i) => {
    const groupIds = [randomId()]
    const cx = x0 + centers[i]!
    const { w } = boxes[i]!
    const shape = p.actor ? "ellipse" : "rectangle"
    const box = (top: number) =>
      newElement(shape, {
        x: cx - w / 2,
        y: top,
        width: w,
        height: boxH,
        groupIds,
        strokeColor: stroke,
        backgroundColor: appState.currentItemBackgroundColor,
        fillStyle: appState.currentItemFillStyle,
        strokeWidth,
        roughness,
        roundness: shape === "rectangle" ? { type: 3 } : null,
      })
    lifelines.push(
      newElement("line", {
        ...rebased([
          [cx, y0 + boxH],
          [cx, bottom],
        ]),
        groupIds,
        strokeColor: stroke,
        strokeWidth: 1,
        strokeStyle: "dashed",
        roughness,
      }),
    )
    for (const top of [y0, bottom]) {
      const container = box(top)
      const label = textEl(p.label, FONT, { containerId: container.id, groupIds })
      const laid = layoutBoundText({ ...container, boundElements: [{ id: label.id, type: "text" }] }, label)
      lifelines.push(laid.container, laid.text)
    }
  })

  return [...frames, ...lifelines, ...notes, ...messages]
}
