/** Arrow-key move in a grid of `count` cells laid out `cols` wide; null for keys that don't move. */
export const gridMove = (index: number, key: string, cols: number, count: number): number | null => {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case "ArrowRight":
      return index >= last ? 0 : index + 1
    case "ArrowLeft":
      return index <= 0 ? last : index - 1
    case "ArrowDown":
      return index + cols <= last ? index + cols : index % cols
    case "ArrowUp": {
      if (index - cols >= 0) return index - cols
      const col = index % cols
      const lastRowStart = last - (last % cols)
      return Math.min(lastRowStart + col, last)
    }
    case "Home":
      return 0
    case "End":
      return last
    default:
      return null
  }
}
