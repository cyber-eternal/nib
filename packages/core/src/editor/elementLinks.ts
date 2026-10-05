const PREFIX = "#element="
const ID = /^[A-Za-z0-9_-]{1,128}$/

/** The link that jumps to element `id` on this canvas. */
export const elementLink = (id: string): string => `${PREFIX}${id}`

/** The element id an `#element=<id>` link points at, or null for any other link. */
export const elementIdFromLink = (link: string | null | undefined): string | null => {
  if (typeof link !== "string") return null
  const value = link.trim()
  const id = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : null
  return id && ID.test(id) ? id : null
}

export const isElementLink = (link: string | null | undefined): boolean => elementIdFromLink(link) !== null
