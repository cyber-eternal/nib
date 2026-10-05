import { type RefObject, useEffect, useLayoutEffect } from "react"

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/** Publishes an element's width or height as a custom property on the .nib root, for layout math. */
export const useMeasuredVar = (
  ref: RefObject<HTMLElement | null>,
  name: string,
  axis: "width" | "height" = "width",
): void => {
  useIsoLayoutEffect(() => {
    const el = ref.current
    const root = el?.closest<HTMLElement>(".nib")
    if (!el || !root) return
    const sync = () => {
      const size = axis === "width" ? el.offsetWidth : el.offsetHeight
      root.style.setProperty(name, `${Math.ceil(size)}px`)
    }
    sync()
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty(name)
    }
  }, [ref, name, axis])
}
