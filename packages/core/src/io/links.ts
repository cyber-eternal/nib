const ELEMENT_LINK = /^#element=[A-Za-z0-9_-]{1,128}$/
const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const WEB_LINK = /^https?:\/\/[^/?#\s]/i

// URL parsers drop tabs and newlines silently, which can disguise a scheme such as "java\tscript:"
const hasControlChars = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * True for links Nib is willing to store and open: http, https, mailto and
 * element links (`#element=<id>`). Anything else (javascript:, data:,
 * file:, custom app schemes) could run code or reach outside the browser.
 */
export const isSafeLink = (url: string): boolean => {
  if (typeof url !== "string") return false
  const value = url.trim()
  if (!value || hasControlChars(value)) return false
  if (ELEMENT_LINK.test(value)) return true
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase()
  if (scheme === "mailto") return value.length > "mailto:".length
  return (scheme === "http" || scheme === "https") && WEB_LINK.test(value)
}

/** Turns what a user typed into a storable link (adding https:// when no scheme is given), or null. */
export const normalizeLink = (url: string): string | null => {
  if (typeof url !== "string") return null
  const value = url.trim()
  if (!value) return null
  if (ELEMENT_LINK.test(value)) return value
  const candidate = SCHEME.test(value) ? value : `https://${value}`
  return isSafeLink(candidate) ? candidate : null
}

// hosts whose pages are meant to be framed; anything else pastes as a plain link
const EMBED_HOSTS = [
  /(?:^|\.)youtube\.com$/,
  /^youtu\.be$/,
  /(?:^|\.)youtube-nocookie\.com$/,
  /(?:^|\.)vimeo\.com$/,
  /(?:^|\.)figma\.com$/,
  /(?:^|\.)loom\.com$/,
  /^gist\.github\.com$/,
  /(?:^|\.)codepen\.io$/,
  /(?:^|\.)codesandbox\.io$/,
  /(?:^|\.)stackblitz\.com$/,
  /(?:^|\.)excalidraw\.com$/,
  /^open\.spotify\.com$/,
]

/** The lower-case host of an http(s) link, ignoring any user:password@ part, or null. */
export const linkHost = (url: string): string | null => {
  if (!isSafeLink(url)) return null
  const m = /^https?:\/\/(?:[^/?#@\s]*@)?([^/?#:\s]+)/i.exec(url.trim())
  return m ? m[1]!.toLowerCase() : null
}

/** True for a safe link to a site Nib embeds (YouTube, Vimeo, Figma, Loom, gists, CodePen…). */
export const isEmbeddableLink = (url: string): boolean => {
  const host = linkHost(url)
  return host !== null && EMBED_HOSTS.some((re) => re.test(host))
}
