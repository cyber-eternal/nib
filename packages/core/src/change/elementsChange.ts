import type { Scene } from "../model/scene"
import type { AppState, NibElement } from "../model/types"

type ElementMap = ReadonlyMap<string, NibElement>
type Snapshot = ReadonlyMap<string, NibElement | null>

/** Document settings a step changed (the canvas background), as they were before and after it. */
export interface StateChange {
  readonly before: Partial<AppState>
  readonly after: Partial<AppState>
}

/** `null` on either side means "did not exist", which makes inverse() total. */
export interface ElementsChange {
  readonly before: Snapshot
  readonly after: Snapshot
  readonly state?: StateChange
}

const asMap = (src: Scene | ElementMap): ElementMap =>
  "getElements" in src ? new Map(src.getElements().map((e) => [e.id, e])) : src

/** Bookkeeping fields: a change that touches only these is not an edit. */
const BOOKKEEPING = new Set(["version", "versionNonce", "updated"])

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false
  return true
}

/** True when two versions of an element differ only in bookkeeping fields. */
export const sameContent = (a: NibElement, b: NibElement): boolean => {
  const ao = a as unknown as Record<string, unknown>
  const bo = b as unknown as Record<string, unknown>
  for (const k of Object.keys(ao)) if (!BOOKKEEPING.has(k) && !deepEqual(ao[k], bo[k])) return false
  for (const k of Object.keys(bo)) if (!BOOKKEEPING.has(k) && !(k in ao) && bo[k] !== undefined) return false
  return true
}

export const ElementsChange = {
  from(prev: Scene | ElementMap, next: Scene | ElementMap): ElementsChange {
    const p = asMap(prev)
    const n = asMap(next)
    const before = new Map<string, NibElement | null>()
    const after = new Map<string, NibElement | null>()
    for (const [id, el] of n) {
      const old = p.get(id)
      if (old === el || (old && sameContent(old, el))) continue
      before.set(id, old ?? null)
      after.set(id, el)
    }
    for (const [id, el] of p) {
      if (!n.has(id)) {
        before.set(id, el)
        after.set(id, null)
      }
    }
    return { before, after }
  },

  inverse(c: ElementsChange): ElementsChange {
    return c.state
      ? { before: c.after, after: c.before, state: { before: c.state.after, after: c.state.before } }
      : { before: c.after, after: c.before }
  },

  isEmpty(c: ElementsChange): boolean {
    return c.after.size === 0 && !c.state
  },

  compose(a: ElementsChange, b: ElementsChange): ElementsChange {
    const before = new Map(a.before)
    const after = new Map(a.after)
    for (const [id, el] of b.after) {
      if (!before.has(id)) before.set(id, b.before.get(id) ?? null)
      after.set(id, el)
    }
    if (!a.state && !b.state) return { before, after }
    const state: StateChange = {
      before: { ...b.state?.before, ...a.state?.before },
      after: { ...a.state?.after, ...b.state?.after },
    }
    return { before, after, state }
  },

  /** `c` plus the document settings that differ between `prev` and `next`, if any do. */
  withState(
    c: ElementsChange,
    prev: Partial<AppState>,
    next: Partial<AppState>,
    keys: readonly (keyof AppState)[],
  ): ElementsChange {
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const k of keys) {
      if (prev[k] === next[k]) continue
      before[k] = prev[k]
      after[k] = next[k]
    }
    if (Object.keys(after).length === 0) return c
    return { ...c, state: { before: before as Partial<AppState>, after: after as Partial<AppState> } }
  },
}
