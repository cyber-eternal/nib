const SCENE_EXT = /\.(nibd|excalidraw)$/i

/** The name as the label shows it, without the file extension. */
export const displayName = (name: string): string => name.replace(SCENE_EXT, "") || "Untitled"

/**
 * The document name after an inline rename: trimmed, keeping the original extension, or null when the
 * edit should be dropped (empty, or unchanged).
 */
export const renamedTo = (current: string, draft: string): string | null => {
  const next = draft.trim().replace(/[\\/:]+/g, "-")
  if (!next) return null
  const ext = SCENE_EXT.exec(current)?.[0] ?? ""
  const full = SCENE_EXT.test(next) ? next : `${next}${ext}`
  return full === current ? null : full
}

/** What the name's tooltip shows for a path: a browser file handle ("fsa:<id>/Name.nibd") has only its name. */
export const pathLabel = (path: string | null): string => {
  if (!path) return "Not saved yet"
  if (!path.startsWith("fsa:")) return path
  return path.slice(path.indexOf("/") + 1) || path
}
