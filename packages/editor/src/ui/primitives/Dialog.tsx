import { type ReactNode, useId, useRef } from "react"
import { createPortal } from "react-dom"
import { type InitialFocus, LayerScope, tabbablesIn, useLayer, useLayerHost } from "../../hooks/useLayer"
import { IconButton } from "./IconButton"

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Visible title; it also names the dialog (aria-labelledby). */
  title: ReactNode
  hideTitle?: boolean
  description?: ReactNode
  /** Controls that stay put above the scrolling body, such as a search field. */
  tools?: ReactNode
  /**
   * Names the scrolling body and makes it a tab stop, so the keyboard can scroll it: browsers only do
   * that themselves for a scroller without focusable children.
   */
  bodyLabel?: string
  children?: ReactNode
  footer?: ReactNode
  size?: "s" | "m" | "l"
  initialFocus?: InitialFocus
  /** Defaults to true. Turn off for dialogs holding unsaved input. */
  dismissOnBackdrop?: boolean
  /** Label of the header close button; null leaves it out. */
  closeLabel?: string | null
  role?: "dialog" | "alertdialog"
  className?: string
}

const closeIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/** Modal dialog: labelled, aria-modal, focus trapped and restored, Escape closes it from anywhere inside. */
export const Dialog = ({
  open,
  onClose,
  title,
  hideTitle,
  description,
  tools,
  bodyLabel,
  children,
  footer,
  size = "m",
  initialFocus,
  dismissOnBackdrop = true,
  closeLabel = "Close",
  role = "dialog",
  className,
}: DialogProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const host = useLayerHost()
  const layer = useLayer({
    open,
    ref,
    modal: true,
    onDismiss: onClose,
    dismissOnOutside: dismissOnBackdrop,
    // the body's first control, not the header close button
    initialFocus: initialFocus ?? (() => (body.current ? tabbablesIn(body.current)[0] : null)),
  })

  if (!open) return null
  const node = (
    <div className="sc-dialog-backdrop" style={{ zIndex: layer.zIndex }}>
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={["sc-dialog", className ?? ""].filter(Boolean).join(" ")}
        data-size={size}
      >
        <LayerScope id={layer.id}>
          <header className="sc-dialog-head">
            <h2 id={titleId} className={hideTitle ? "sc-visually-hidden" : "sc-dialog-title"}>
              {title}
            </h2>
            {closeLabel ? (
              <IconButton label={closeLabel} icon={closeIcon} size="s" tooltip={false} onClick={onClose} />
            ) : null}
          </header>
          {description ? (
            <p id={descId} className="sc-dialog-desc">
              {description}
            </p>
          ) : null}
          {tools ? <div className="sc-dialog-tools">{tools}</div> : null}
          <div
            ref={body}
            className="sc-dialog-body"
            role={bodyLabel ? "region" : undefined}
            aria-label={bodyLabel}
            tabIndex={bodyLabel ? 0 : undefined}
          >
            {children}
          </div>
          {footer ? <footer className="sc-dialog-foot">{footer}</footer> : null}
        </LayerScope>
      </div>
    </div>
  )
  return host ? createPortal(node, host) : node
}
