import { type HTMLAttributes, type ReactNode, type RefObject, useEffect, useId, useRef } from "react"
import { isAnyLayerOpen, tabbablesIn } from "../../hooks/useLayer"
import { IconButton } from "../primitives/IconButton"
import { isImeKey } from "../primitives/ime"
import { PanelIcons } from "./icons"
import "./panels.css"

export interface SideSheetProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "children"> {
  title: string
  onClose: () => void
  /** Label of the header close button. */
  closeLabel?: string
  /** Where focus goes on open: an element, the sheet itself, or by default the body's first control. */
  initialFocus?: RefObject<HTMLElement | null> | "sheet"
  /** Sits between the title and the close button. */
  actions?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

/**
 * A non-modal panel docked to the right edge, below the top-right actions and above the tray, so neither
 * is ever covered. Escape inside it closes it unless a popover opened from it is on top; focus
 * returns to whatever opened it.
 */
export const SideSheet = ({
  title,
  onClose,
  closeLabel = "Close",
  initialFocus,
  actions,
  footer,
  children,
  className,
  onKeyDown,
  ...rest
}: SideSheetProps) => {
  const ref = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const latest = useRef({ initialFocus })
  latest.current = { initialFocus }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const initial = latest.current.initialFocus
    const target =
      initial === "sheet"
        ? ref.current
        : (initial?.current ?? (body.current ? tabbablesIn(body.current)[0] : null) ?? ref.current)
    target?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || (ref.current?.contains(active) ?? false)
      if (lost && opener?.isConnected && !ref.current?.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <aside
      ref={ref}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={["sc-sheet", className ?? ""].filter(Boolean).join(" ")}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.key !== "Escape" || e.defaultPrevented || isImeKey(e)) return
        // a popover opened from the sheet owns this Escape; the layer stack closes it
        if (isAnyLayerOpen()) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
      {...rest}
    >
      <header className="sc-sheet-head">
        <h2 id={titleId} className="sc-sheet-title">
          {title}
        </h2>
        <div className="sc-sheet-actions">
          {actions}
          <IconButton
            label={closeLabel}
            icon={PanelIcons.close}
            size="s"
            tooltipSide="bottom"
            onClick={onClose}
          />
        </div>
      </header>
      <div ref={body} className="sc-sheet-body">
        {children}
      </div>
      {footer ? <footer className="sc-sheet-foot">{footer}</footer> : null}
    </aside>
  )
}
