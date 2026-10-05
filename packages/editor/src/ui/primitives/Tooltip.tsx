import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLayerHost } from "../../hooks/useLayer"
import { Kbd } from "./Kbd"
import { type Side, computePlacement } from "./position"

export const TOOLTIP_DELAY = 400
/** After a tooltip closes, the next one within this window opens at once (moving along the tray). */
export const TOOLTIP_GRACE = 300

const warm = { open: 0, closedAt: Number.NEGATIVE_INFINITY }

// one bubble at a time: a hovered swatch and a keyboard-focused one never both speak
let hideShown: (() => void) | null = null

export const tooltipDelay = (now: number, state: { open: number; closedAt: number } = warm): number =>
  state.open > 0 || now - state.closedAt < TOOLTIP_GRACE ? 0 : TOOLTIP_DELAY

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const focusVisible = (el: Element): boolean => {
  try {
    return el.matches(":focus-visible")
  } catch {
    return true
  }
}

export interface TooltipProps {
  label: string
  shortcut?: string
  side?: Side
  disabled?: boolean
  /** One focusable element; the tooltip anchors to it. */
  children: ReactNode
}

/**
 * Name and shortcut on hover or keyboard focus. Visual only (aria-hidden): the trigger carries its name
 * in aria-label and its shortcut in aria-keyshortcuts.
 */
export const Tooltip = ({ label, shortcut, side = "top", disabled, children }: TooltipProps) => {
  const wrap = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const host = useLayerHost()

  const show = useCallback(() => {
    if (disabled) return
    window.clearTimeout(timer.current)
    const delay = tooltipDelay(Date.now())
    if (delay === 0) setOpen(true)
    else timer.current = window.setTimeout(() => setOpen(true), delay)
  }, [disabled])

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    if (hideShown && hideShown !== hide) hideShown()
    hideShown = hide
    warm.open++
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide()
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      if (hideShown === hide) hideShown = null
      warm.open--
      warm.closedAt = Date.now()
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open, hide])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useIsoLayoutEffect(() => {
    const el = bubble.current
    const anchor = wrap.current?.firstElementChild
    if (!open || !el || !anchor) return
    const a = anchor.getBoundingClientRect()
    const p = computePlacement({
      anchor: { x: a.left, y: a.top, width: a.width, height: a.height },
      size: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      side,
      offset: 8,
    })
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
    el.dataset.side = p.side
    el.dataset.placed = ""
  }, [open, side, label, shortcut])

  const tip = open ? (
    <div ref={bubble} className="sc-tooltip" aria-hidden="true">
      <span>{label}</span>
      {shortcut ? <Kbd chord={shortcut} className="sc-tooltip-kbd" /> : null}
    </div>
  ) : null

  return (
    <span
      ref={wrap}
      className="sc-tooltip-anchor"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") show()
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // pointer focus already had its hover; only keyboard focus should raise a tooltip
        if (focusVisible(e.target)) show()
      }}
      onBlur={hide}
    >
      {children}
      {tip && host ? createPortal(tip, host) : tip}
    </span>
  )
}
