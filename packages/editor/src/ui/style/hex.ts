export type HexResult = { ok: true; color: string } | { ok: false; error: string }

export const HEX_HINT = "Use 3 or 6 hex digits, like #1e1e1e"

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Reads what the user typed in a hex field. Accepts "#abc", "abc", "#aabbcc" and "aabbcc" (any case,
 * surrounding space ignored) and returns "#aabbcc" in lower case; "transparent" only when allowed.
 */
export const parseHexInput = (raw: string, opts: { allowTransparent?: boolean } = {}): HexResult => {
  const s = raw.trim()
  if (s === "") return { ok: false, error: "Enter a colour" }
  if (opts.allowTransparent && /^(transparent|none)$/i.test(s)) return { ok: true, color: "transparent" }
  const m = HEX.exec(s)
  if (!m) return { ok: false, error: HEX_HINT }
  let h = m[1]!.toLowerCase()
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  return { ok: true, color: `#${h}` }
}

/** "#AABBCC", "#abc" and "abc" all read as "#aabbcc"; anything else is returned trimmed and lower-cased. */
export const normalizeColor = (color: string): string => {
  const r = parseHexInput(color, { allowTransparent: true })
  return r.ok ? r.color : color.trim().toLowerCase()
}

export const sameColor = (a: string, b: string): boolean => normalizeColor(a) === normalizeColor(b)

/** The text a hex field shows for a colour: "aabbcc" without the hash, or "" for mixed and transparent. */
export const hexDraft = (color: string | null): string => {
  if (color === null) return ""
  const n = normalizeColor(color)
  if (n === "transparent") return ""
  return n.startsWith("#") ? n.slice(1) : n
}
