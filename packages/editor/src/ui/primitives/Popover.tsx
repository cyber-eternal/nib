import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import { createPortal } from "react-dom"
import {
  type DismissReason,
  type InitialFocus,
  LayerScope,
  useLayer,
  useLayerHost,
} from "../../hooks/useLayer"
import { type Align, type Side, computePlacement } from "./position"

export type PopoverAnchor = RefObject<HTMLElement | null> | { x: number; y: number }

export interface PopoverProps {
  open: boolean
  onClose: (reason: DismissReason) => void
  /** An element to sit against, or a viewport point (context menus). */
  anchor: PopoverAnchor
  /** Defaults to "top": popovers rise out of the tray. Flips when there is no room. */
  side?: Side
  align?: Align
  offset?: number
  /** ARIA role of the container; "none" for a bare container whose child supplies the role (a Menu). */
  contentRole?: "dialog" | "listbox" | "group" | "none"
  label?: string
  labelledBy?: string
  initialFocus?: InitialFocus
  /** More elements whose presses neither count as outside nor close the popover. */
  ignore?: readonly RefObject<HTMLElement | null>[]
  className?: string
  id?: string
  children?: ReactNode
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const isPoint = (a: PopoverAnchor): a is { x: number; y: number } => !("current" in a)

/** A non-modal floating layer, portalled and position: fixed so no scrolling panel can clip it. */
export const Popover = ({
  open,
  onClose,
  anchor,
  side = "top",
  align = "center",
  offset = 8,
  contentRole = "dialog",
  label,
  labelledBy,
  initialFocus,
  ignore,
  className,
  id,
  children,
}: PopoverProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const host = useLayerHost()
  const anchorRef = isPoint(anchor) ? null : anchor
  const point = isPoint(anchor) ? anchor : null
  const px = point?.x
  const py = point?.y

  const place = useCallback(() => {
    const el = ref.current
    if (!el) return
    let rect: { x: number; y: number; width: number; height: number }
    if (px !== undefined && py !== undefined) rect = { x: px, y: py, width: 0, height: 0 }
    else {
      const a = anchorRef?.current?.getBoundingClientRect()
      if (!a) return
      rect = { x: a.left, y: a.top, width: a.width, height: a.height }
    }
    // measuring unclamped resets a scrolled popover to the top; put the scroll back afterwards
    const scrollTop = el.scrollTop
    el.style.maxHeight = "none"
    el.style.maxWidth = "none"
    const p = computePlacement({
      anchor: rect,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      side,
      align,
      offset,
      slide: px !== undefined,
    })
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
    el.style.maxHeight = `${p.maxHeight}px`
    el.style.maxWidth = `${p.maxWidth}px`
    el.dataset.side = p.side
    el.dataset.placed = ""
    el.scrollTop = scrollTop
  }, [anchorRef, px, py, side, align, offset])

  // placed before useLayer's effect so initial focus lands on a positioned, visible element
  useIsoLayoutEffect(() => {
    if (!open) return
    place()
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null
    if (ref.current) ro?.observe(ref.current)
    if (anchorRef?.current) ro?.observe(anchorRef.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      ro?.disconnect()
    }
  }, [open, place, anchorRef])

  const ignoreRefs = useMemo(
    () => (anchorRef ? [anchorRef, ...(ignore ?? [])] : (ignore ?? [])),
    [anchorRef, ignore],
  )

  // read before useLayer's effect moves focus in: a pointer-opened popover must not hand its anchor the
  // focus on close, or Space, Enter and the arrows go to that button instead of the board
  const anchorHadFocus = useRef(false)
  useIsoLayoutEffect(() => {
    if (!open) return
    const a = anchorRef?.current
    anchorHadFocus.current = !!a && a.contains(document.activeElement)
  }, [open, anchorRef])
  const restoreTo = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return anchorHadFocus.current ? (anchorRef?.current ?? null) : null
      },
    }),
    [anchorRef],
  )

  const layer = useLayer({
    open,
    ref,
    onDismiss: onClose,
    ignore: ignoreRefs,
    initialFocus,
    restoreFocus: anchorRef ? restoreTo : true,
  })

  if (!open) return null
  const bare = contentRole === "none"
  const node = (
    <div
      ref={ref}
      id={id}
      className={["sc-popover", className ?? ""].filter(Boolean).join(" ")}
      role={bare ? undefined : contentRole}
      aria-label={bare ? undefined : label}
      aria-labelledby={bare ? undefined : labelledBy}
      tabIndex={-1}
      style={{ zIndex: layer.zIndex }}
    >
      <LayerScope id={layer.id}>{children}</LayerScope>
    </div>
  )
  return host ? createPortal(node, host) : node
}
