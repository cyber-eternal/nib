import { isEmbeddableLink, normalizeLink } from "../io/links"

interface ParsedLink {
  host: string
  path: string
  query: string
}

// core has no DOM or URL global, so links are split by hand; isSafeLink has already vetted them
const LINK = /^https?:\/\/(?:[^/?#@\s]*@)?([^/?#:\s]+)(?::\d+)?([^?#]*)(?:\?([^#]*))?/i

const parse = (link: string): ParsedLink | null => {
  const m = LINK.exec(link)
  return m ? { host: m[1]!.toLowerCase(), path: m[2] || "/", query: m[3] ?? "" } : null
}

const param = (query: string, name: string): string | null => {
  for (const part of query.split("&")) {
    const eq = part.indexOf("=")
    const key = eq < 0 ? part : part.slice(0, eq)
    if (key === name) return eq < 0 ? "" : part.slice(eq + 1)
  }
  return null
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/

/** "1h2m3s", "90" or "90s" as whole seconds, or null. */
const parseStart = (t: string | null): number | null => {
  if (!t) return null
  if (/^\d+s?$/.test(t)) return Number.parseInt(t, 10)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  if (!m || !(m[1] || m[2] || m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

const youtube = ({ host, path, query }: ParsedLink): string | null => {
  let id: string | null = null
  if (host === "youtu.be") id = path.slice(1).split("/")[0] ?? null
  else if (path === "/watch") id = param(query, "v")
  else id = /^\/(?:embed|shorts|live|v)\/([^/]+)/.exec(path)?.[1] ?? null
  if (!id || !YOUTUBE_ID.test(id)) return null
  const start = parseStart(param(query, "t") ?? param(query, "start"))
  return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`
}

/**
 * Every origin embedSource can return, as CSP source expressions. The desktop and web CSPs list
 * these in frame-src, and a test keeps the two in step.
 */
export const EMBED_FRAME_ORIGINS: readonly string[] = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://figma.com",
  "https://*.figma.com",
  "https://www.loom.com",
  "https://gist.github.com",
  "https://codepen.io",
  "https://codesandbox.io",
  "https://stackblitz.com",
  "https://*.stackblitz.com",
  "https://excalidraw.com",
  "https://*.excalidraw.com",
  "https://open.spotify.com",
]

const ends = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`)

/**
 * The address to load in a sandboxed frame for an allowlisted embed link
 * (YouTube, Vimeo, Figma, Loom, gists, CodePen, CodeSandbox, StackBlitz,
 * Excalidraw, Spotify), rewritten to the site's embed form, or null when the
 * link is unsafe or not on the allowlist.
 */
export const embedSource = (link: string): string | null => {
  const normalized = normalizeLink(link)
  if (!normalized || !isEmbeddableLink(normalized)) return null
  const parsed = parse(normalized)
  if (!parsed) return null
  const { host, path, query } = parsed
  const secure = normalized.replace(/^http:/i, "https:")
  if (ends(host, "youtube.com") || host === "youtu.be" || ends(host, "youtube-nocookie.com"))
    return youtube(parsed)
  if (ends(host, "vimeo.com")) {
    if (host === "player.vimeo.com") return secure
    const id = /^\/(?:video\/)?(\d+)/.exec(path)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : null
  }
  if (ends(host, "figma.com"))
    return path.startsWith("/embed")
      ? secure
      : `https://www.figma.com/embed?embed_host=nib&url=${encodeURIComponent(secure)}`
  if (ends(host, "loom.com")) {
    const id = /^\/(?:share|embed)\/([A-Za-z0-9]+)/.exec(path)?.[1]
    return id ? `https://www.loom.com/embed/${id}` : null
  }
  if (host === "gist.github.com") {
    const m = /^\/([^/]+)\/([0-9a-f]+)/i.exec(path)
    return m ? `https://gist.github.com/${m[1]}/${m[2]}.pibb` : null
  }
  if (ends(host, "codepen.io")) {
    const m = /^\/([^/]+)\/(?:pen|embed)\/([^/]+)/.exec(path)
    return m ? `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` : null
  }
  if (ends(host, "codesandbox.io")) {
    const id = /^\/(?:s|embed|p\/sandbox)\/([^/]+)/.exec(path)?.[1]
    return id ? `https://codesandbox.io/embed/${id}` : null
  }
  if (ends(host, "stackblitz.com")) {
    if (param(query, "embed") !== null) return secure
    return `${secure.split("#")[0]}${query ? "&" : "?"}embed=1`
  }
  if (host === "open.spotify.com") {
    if (path.startsWith("/embed/")) return secure
    const m = /^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(path)
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null
  }
  return secure
}
