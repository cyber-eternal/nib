export type NavMove = "next" | "prev" | "first" | "last"
export type Orientation = "vertical" | "horizontal" | "both"

export const navMoveFor = (key: string, orientation: Orientation): NavMove | null => {
  if (key === "Home") return "first"
  if (key === "End") return "last"
  const v = orientation !== "horizontal"
  const h = orientation !== "vertical"
  if ((v && key === "ArrowDown") || (h && key === "ArrowRight")) return "next"
  if ((v && key === "ArrowUp") || (h && key === "ArrowLeft")) return "prev"
  return null
}

/** Index after a roving-focus move, skipping disabled entries; -1 when nothing is enabled. */
export const moveIndex = (
  disabled: readonly boolean[],
  current: number,
  move: NavMove,
  wrap = true,
): number => {
  const enabled: number[] = []
  disabled.forEach((d, i) => {
    if (!d) enabled.push(i)
  })
  if (enabled.length === 0) return -1
  if (move === "first") return enabled[0]!
  if (move === "last") return enabled[enabled.length - 1]!
  if (move === "next") {
    const after = enabled.find((i) => i > current)
    return after ?? (wrap ? enabled[0]! : enabled.includes(current) ? current : enabled[enabled.length - 1]!)
  }
  const from = current < 0 ? disabled.length : current
  const before = [...enabled].reverse().find((i) => i < from)
  return before ?? (wrap ? enabled[enabled.length - 1]! : enabled.includes(current) ? current : enabled[0]!)
}

/**
 * Typeahead target. A one-letter query (or the same letter repeated) cycles through matches after the
 * current entry; a longer query refines from the current entry.
 */
export const typeaheadIndex = (
  labels: readonly string[],
  disabled: readonly boolean[],
  current: number,
  query: string,
): number => {
  const q = query.toLocaleLowerCase()
  if (!q || labels.length === 0) return -1
  const cycling = [...q].every((c) => c === q[0])
  const needle = cycling ? q[0]! : q
  const start = cycling ? current + 1 : Math.max(current, 0)
  const n = labels.length
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n
    if (!disabled[i] && labels[i]!.trim().toLocaleLowerCase().startsWith(needle)) return i
  }
  return -1
}

export const TYPEAHEAD_RESET_MS = 500

/** Accumulates typed characters into a query that resets after a pause. */
export class Typeahead {
  private query = ""
  private at = Number.NEGATIVE_INFINITY

  push(char: string, now: number): string {
    this.query = now - this.at > TYPEAHEAD_RESET_MS ? char : this.query + char
    this.at = now
    return this.query
  }

  reset(): void {
    this.query = ""
    this.at = Number.NEGATIVE_INFINITY
  }
}
