/** Roving focus in a wrapped grid of `count` cells, `columns` wide; null for keys the grid ignores. */
export const gridMove = (index: number, count: number, columns: number, key: string): number | null => {
  if (count <= 0) return null
  const last = count - 1
  const cols = Math.max(1, columns)
  switch (key) {
    case "ArrowRight":
      return index >= last ? 0 : index + 1
    case "ArrowLeft":
      return index <= 0 ? last : index - 1
    case "ArrowDown":
      return index + cols <= last ? index + cols : index % cols
    case "ArrowUp": {
      if (index - cols >= 0) return index - cols
      const column = index % cols
      const lastRowStart = last - (last % cols)
      return Math.min(lastRowStart + column, last)
    }
    case "Home":
      return 0
    case "End":
      return last
    default:
      return null
  }
}
