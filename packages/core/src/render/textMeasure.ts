import type { FontFamily, TextElement } from "../model/types"
import { DEFAULT_LINE_HEIGHT } from "../model/types"

export const FONT_STACKS: Record<FontFamily, string> = {
  hand: '"Shantell Sans", "Comic Sans MS", cursive',
  normal: '"Nunito", "Helvetica Neue", Arial, sans-serif',
  code: '"Cascadia Code", "SF Mono", Menlo, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SF Mono", Menlo, monospace',
}

export const fontString = (fontSize: number, fontFamily: FontFamily): string =>
  `${fontSize}px ${FONT_STACKS[fontFamily] ?? FONT_STACKS.hand}`

export interface TextMetrics {
  width: number
  height: number
  lineWidths: number[]
}

export type MeasureFn = (text: string, font: string) => number

let measureText: MeasureFn = (text) => text.length * 8

export const setTextMeasurer = (fn: MeasureFn): void => {
  measureText = fn
}

export const measureLine = (text: string, fontSize: number, fontFamily: FontFamily): number =>
  measureText(text, fontString(fontSize, fontFamily))

/** Width of `text` in a full CSS font shorthand, for chrome labels that use their own fonts. */
export const measureWithFont = (text: string, font: string): number => measureText(text, font)

export const lineHeightPx = (fontSize: number, lineHeight = DEFAULT_LINE_HEIGHT): number =>
  fontSize * lineHeight

export const measureMultiline = (
  text: string,
  fontSize: number,
  fontFamily: FontFamily,
  lineHeight = DEFAULT_LINE_HEIGHT,
): TextMetrics => {
  const lines = text.split("\n")
  const lineWidths = lines.map((l) => measureLine(l, fontSize, fontFamily))
  return {
    width: Math.max(0, ...lineWidths),
    height: lines.length * lineHeightPx(fontSize, lineHeight),
    lineWidths,
  }
}

/** Greedy word wrap; long words are broken so text never overflows its box. */
export const wrapText = (
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: FontFamily,
): string => {
  if (maxWidth <= 0) return text
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      out.push("")
      continue
    }
    let line = ""
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word
      if (measureLine(candidate, fontSize, fontFamily) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      if (measureLine(word, fontSize, fontFamily) <= maxWidth) {
        line = word
        continue
      }
      let chunk = ""
      for (const ch of word) {
        if (measureLine(chunk + ch, fontSize, fontFamily) > maxWidth && chunk) {
          out.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      line = chunk
    }
    out.push(line)
  }
  return out.join("\n")
}

export const measuredTextSize = (el: TextElement): { width: number; height: number } => {
  const m = measureMultiline(el.text, el.fontSize, el.fontFamily, el.lineHeight)
  return { width: m.width, height: m.height }
}
