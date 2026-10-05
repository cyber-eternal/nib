import type { EditorCore } from "@nib/core"
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { type TrayFit, type TraySnapshot, snapshotKey, trayFit, traySnapshot } from "./trayModel"

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/** Re-renders only when something the tray shows changes, not on every pointer frame. */
export const useTraySnapshot = (core: EditorCore): TraySnapshot => {
  const cache = useRef<{ key: string; snap: TraySnapshot } | null>(null)
  const subscribe = useCallback((cb: () => void) => core.subscribe(cb), [core])
  const read = useCallback(() => {
    const snap = traySnapshot(core)
    const key = snapshotKey(snap)
    if (cache.current?.key === key) return cache.current.snap
    cache.current = { key, snap }
    return snap
  }, [core])
  return useSyncExternalStore(subscribe, read, read)
}

export const NARROW_QUERY = "(max-width: 759px)"

export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof matchMedia !== "function") return () => {}
      const mq = matchMedia(query)
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    [query],
  )
  const read = () => typeof matchMedia === "function" && matchMedia(query).matches
  return useSyncExternalStore(subscribe, read, () => false)
}

export type { TrayFit }

const pxVar = (style: CSSStyleDeclaration, name: string, fallback = 0): number => {
  const v = Number.parseFloat(style.getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}

/**
 * Lays the tray out by measurement: beside the ledge end where the whole tray fits, stacked under
 * it otherwise, and only then are the caps collapsed or the markers scrolled. The layout is published as
 * data-tray-layout on the .nib root, where the shell's stylesheet moves the ledge end and help.
 */
export const useTrayFit = (
  dock: RefObject<HTMLElement | null>,
  narrow: boolean,
  capCount: number,
): TrayFit => {
  const [fit, setFit] = useState<TrayFit>({ layout: "side", collapse: narrow, scroll: false })
  const current = useRef(fit)
  current.current = fit

  const measure = useCallback(() => {
    const el = dock.current
    const row = el?.querySelector<HTMLElement>(".tray-row")
    const root = el?.closest<HTMLElement>(".nib")
    if (!el || !row || !root) return
    const tools = row.querySelector<HTMLElement>(".tray-tools")
    const first = row.firstElementChild
    const last = row.lastElementChild
    if (!first || !last) return
    // the row's own scrollWidth misses content squeezed into its end padding, so add up what it holds
    const rowStyle = getComputedStyle(row)
    const natural =
      last.getBoundingClientRect().right -
      first.getBoundingClientRect().left +
      (Number.parseFloat(rowStyle.paddingLeft) || 0) +
      (Number.parseFloat(rowStyle.paddingRight) || 0) +
      (tools ? tools.scrollWidth - tools.clientWidth : 0)
    const style = getComputedStyle(root)
    const next = trayFit({
      content: natural + el.offsetWidth - el.clientWidth,
      collapsed: current.current.collapse,
      capCell: el.querySelector<HTMLElement>(".tray-cap-custom")?.offsetWidth ?? 0,
      capCount,
      narrow,
      viewport: root.clientWidth || window.innerWidth,
      ledge: pxVar(style, "--ledge-w"),
      corner: pxVar(style, "--corner-w"),
      gap: pxVar(style, "--chrome-gap", 12),
    })
    const prev = current.current
    if (next.layout !== prev.layout || next.collapse !== prev.collapse || next.scroll !== prev.scroll) {
      current.current = next
      setFit(next)
    }
  }, [dock, narrow, capCount])

  // content changes (view mode, held tool) can resize the row without resizing a dock already at max width
  useIsoLayoutEffect(measure)

  useIsoLayoutEffect(() => {
    const root = dock.current?.closest<HTMLElement>(".nib")
    if (!root) return
    root.dataset.trayLayout = fit.layout
    return () => {
      delete root.dataset.trayLayout
    }
  }, [dock, fit.layout])

  useEffect(() => {
    const el = dock.current
    if (!el) return
    window.addEventListener("resize", measure)
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    // the shell publishes the ledge and corner widths as inline custom properties on its root
    const mo = typeof MutationObserver === "function" ? new MutationObserver(measure) : null
    for (let n = el.parentElement; n; n = n.parentElement)
      mo?.observe(n, { attributes: true, attributeFilter: ["style", "class"] })
    return () => {
      window.removeEventListener("resize", measure)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [dock, measure])

  return narrow && !fit.collapse ? { ...fit, collapse: true } : fit
}
