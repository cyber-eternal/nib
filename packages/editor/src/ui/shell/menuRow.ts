export type RowMove = { to: "chip"; index: number } | { to: "before" } | { to: "after" }

/**
 * Two-dimensional keys inside the main menu's inline theme row: Left and Right walk the swatches
 * (wrapping), Up and Down leave the row for the items above and below it.
 */
export const themeRowMove = (key: string, index: number, count: number): RowMove | null => {
  if (count <= 0 || index < 0) return null
  switch (key) {
    case "ArrowRight":
      return { to: "chip", index: (index + 1) % count }
    case "ArrowLeft":
      return { to: "chip", index: (index - 1 + count) % count }
    case "ArrowDown":
      return { to: "after" }
    case "ArrowUp":
      return { to: "before" }
    default:
      return null
  }
}

/** ArrowRight (or Enter, Space) on an item that owns a submenu opens it. */
export const opensSubmenu = (key: string): boolean => key === "ArrowRight"
