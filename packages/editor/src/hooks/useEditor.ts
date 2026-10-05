import type { EditorCore } from "@nib/core"
import { useCallback, useRef, useSyncExternalStore } from "react"

/**
 * A counter that bumps on every core change, for components that really draw every frame. The counter
 * lives outside the render so getSnapshot stays stable, which useSyncExternalStore requires.
 */
export const useCoreVersion = (core: EditorCore): number => {
  const tick = useRef(0)
  const subscribe = useCallback(
    (onChange: () => void) =>
      core.subscribe(() => {
        tick.current += 1
        onChange()
      }),
    [core],
  )
  const read = () => tick.current
  return useSyncExternalStore(subscribe, read, read)
}

export type Equality<T> = (a: T, b: T) => boolean

/** Equal when both are arrays (or plain objects) holding the same values, one level deep. */
export const shallowEqual = <T>(a: T, b: T): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/**
 * Subscribes to a slice of an external store: the component re-renders only when `select` returns
 * something not `equals` to the last value.
 */
export const useStoreSelector = <T>(
  subscribe: (cb: () => void) => () => void,
  select: () => T,
  equals: Equality<T> = Object.is,
): T => {
  const latest = useRef({ select, equals })
  latest.current = { select, equals }
  const cache = useRef<{ value: T } | null>(null)
  const getSnapshot = useCallback(() => {
    const next = latest.current.select()
    const prev = cache.current
    if (prev && latest.current.equals(prev.value, next)) return prev.value
    cache.current = { value: next }
    return next
  }, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** useStoreSelector over the core, its history (undo availability) included. */
export const useCoreSelector = <T>(
  core: EditorCore,
  select: (core: EditorCore) => T,
  equals: Equality<T> = Object.is,
): T => {
  const subscribe = useCallback(
    (cb: () => void) => {
      const offCore = core.subscribe(cb)
      const offHistory = core.history.subscribe(cb)
      return () => {
        offCore()
        offHistory()
      }
    },
    [core],
  )
  return useStoreSelector(subscribe, () => select(core), equals)
}

const countCache = new WeakMap<EditorCore, { version: number; count: number }>()

/** Live element count, rescanned only when the scene (static version) changes. */
export const elementCountOf = (core: EditorCore): number => {
  const hit = countCache.get(core)
  if (hit && hit.version === core.staticVersion) return hit.count
  const count = core.scene.getNonDeleted().length
  countCache.set(core, { version: core.staticVersion, count })
  return count
}
