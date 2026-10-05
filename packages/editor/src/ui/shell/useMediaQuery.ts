import { useCallback, useSyncExternalStore } from "react"

/** The narrow-window layout of the brief: the tray scrolls and the top-right folds into one menu. */
export const NARROW_QUERY = "(max-width: 759px)"

const mql = (query: string): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia(query) : null

export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (cb: () => void) => {
      const list = mql(query)
      list?.addEventListener("change", cb)
      return () => list?.removeEventListener("change", cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => mql(query)?.matches ?? false,
    () => false,
  )
}
