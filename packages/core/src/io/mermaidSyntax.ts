import type { MermaidStyle } from "./mermaid"

export interface Statement {
  text: string
  line: number
}

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " " }

export const cleanLabel = (raw: string): string =>
  raw
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/^`([\s\S]*)`$/, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[#&](\w+);/g, (m, code: string) => {
      if (!/^\d+$/.test(code)) return ENTITIES[code.toLowerCase()] ?? m
      const point = Number(code)
      return point <= 0x10ffff ? String.fromCodePoint(point) : m
    })

/** Splits source into statements: one per line or `;`, without %% comments, YAML frontmatter or blank lines. */
export const statementsOf = (source: string): Statement[] => {
  const lines = source.split(/\r?\n/)
  let start = 0
  while (start < lines.length && lines[start]!.trim() === "") start++
  if (lines[start]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > start && l.trim() === "---")
    if (close > 0) start = close + 1
  }
  const out: Statement[] = []
  for (let n = start; n < lines.length; n++) {
    let current = ""
    let quoted = false
    const line = lines[n]!
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (ch === '"') quoted = !quoted
      if (!quoted && ch === "%" && line[i + 1] === "%") break
      if (!quoted && ch === ";") {
        if (current.trim()) out.push({ text: current.trim(), line: n + 1 })
        current = ""
        continue
      }
      current += ch
    }
    if (current.trim()) out.push({ text: current.trim(), line: n + 1 })
  }
  return out
}

/** Splits on commas that are not inside parentheses, so `rgb(1,2,3)` stays one value. */
export const splitTopLevel = (text: string, separator = ","): string[] => {
  const out: string[] = []
  let depth = 0
  let current = ""
  for (const ch of text) {
    if (ch === "(") depth++
    else if (ch === ")") depth = Math.max(0, depth - 1)
    if (ch === separator && depth === 0) {
      out.push(current)
      current = ""
      continue
    }
    current += ch
  }
  out.push(current)
  return out.map((s) => s.trim()).filter(Boolean)
}

// what normalizeElements would keep anyway; anything else in a diagram's style is dropped
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s]+\))$/i

const cssColor = (value: string): string | undefined => {
  const v = value.trim().replace(/\s*!important$/i, "")
  return CSS_COLOR.test(v) ? v : undefined
}

/** Reads `fill:#f9f,stroke:#333,stroke-width:4px,color:#fff,stroke-dasharray:5 5` into a style. */
export const parseStyleProps = (text: string): MermaidStyle => {
  const style: MermaidStyle = {}
  for (const part of splitTopLevel(text)) {
    const colon = part.indexOf(":")
    if (colon <= 0) continue
    const key = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (key === "fill" || key === "stroke" || key === "color") {
      const c = cssColor(value)
      if (c) style[key] = c
    } else if (key === "stroke-width") {
      const width = Number.parseFloat(value)
      if (Number.isFinite(width) && width > 0) style.strokeWidth = Math.min(16, Math.max(0.5, width))
    } else if (key === "stroke-dasharray") style.dashed = !/^(?:0|none)$/i.test(value)
  }
  return style
}

export const mergeStyles = (...styles: (MermaidStyle | undefined)[]): MermaidStyle | undefined => {
  const out: MermaidStyle = {}
  for (const s of styles) if (s) Object.assign(out, s)
  return Object.keys(out).length > 0 ? out : undefined
}

export const DIRECTIONS = new Set(["TD", "TB", "BT", "LR", "RL"])
