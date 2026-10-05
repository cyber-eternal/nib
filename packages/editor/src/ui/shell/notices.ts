import { type LibraryItem, elementIdFromLink, mergeLibraryItems } from "@nib/core"

/** Why a link would not open: its element was deleted, or it is a kind of link Nib never opens. */
export const refusedLinkMessage = (link: string): string =>
  elementIdFromLink(link)
    ? "The linked element was deleted."
    : "That link can't be opened. Only web and mail links work."

export interface LibraryImport {
  items: LibraryItem[]
  added: number
  message: string
}

/** An imported file merges like a drop on the sheet, so importing the same library twice adds nothing. */
export const importIntoLibrary = (
  existing: readonly LibraryItem[],
  incoming: readonly LibraryItem[],
): LibraryImport => {
  const items = mergeLibraryItems(existing, incoming)
  const added = items.length - existing.length
  return {
    items,
    added,
    message:
      added === 0
        ? "Those items are already in your library."
        : `Added ${added} ${added === 1 ? "item" : "items"} to the library.`,
  }
}

const fileName = (path: string): string => path.split(/[/\\]/).pop() || path

/**
 * Export to Excalidraw has its own confirmation; the document label's "Saved" is for saves. `written` is
 * the path the save picker wrote, where the user may have renamed the file, or true for a browser download,
 * which keeps the suggested name.
 */
export const exportedMessage = (written: string | true, baseName: string): string =>
  `Exported ${written === true ? `${baseName}.excalidraw` : fileName(written)}.`

/** A cut that neither clipboard took deletes nothing, so it says so rather than passing for a copy. */
export const CUT_REFUSED = "Couldn't cut: the clipboard isn't available. Nothing was removed."

/** Core rolled back a gesture whose tool threw. */
export const TOOL_ERROR = "That change could not be completed and was undone."

/** True at most once per `gapMs`, so a tool that throws on every pointer move cannot flood the toasts. */
export const throttle = (gapMs: number, now: () => number = Date.now): (() => boolean) => {
  let last = Number.NEGATIVE_INFINITY
  return () => {
    const t = now()
    if (t - last < gapMs) return false
    last = t
    return true
  }
}
