import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { layerController } from "../../hooks/useLayer"
import {
  TOAST_DURATION,
  TOAST_MAX,
  type Toast,
  type ToastKind,
  pauseAfter,
  pushToast,
  removeToast,
} from "./toastQueue"

export interface NotifyOptions {
  kind?: ToastKind
  duration?: number
  action?: { label: string; run: () => void }
  id?: string
}

export interface ToastApi {
  notify(message: string, opts?: NotifyOptions): string
  dismiss(id: string): void
}

const ToastContext = createContext<ToastApi | null>(null)

let seq = 0

/** Provides notify() and renders the live region (always mounted, so the first message is announced). */
export const ToastProvider = ({ children, max = TOAST_MAX }: { children?: ReactNode; max?: number }) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: string) => setToasts((q) => removeToast(q, id)), [])
  const notify = useCallback(
    (message: string, opts: NotifyOptions = {}) => {
      const id = opts.id ?? `toast-${++seq}`
      const toast: Toast = {
        id,
        message,
        kind: opts.kind ?? "info",
        duration: opts.duration ?? TOAST_DURATION,
        action: opts.action,
      }
      setToasts((q) => pushToast(q, toast, max))
      return id
    },
    [max],
  )
  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastApi => {
  const api = useContext(ToastContext)
  if (!api) throw new Error("useToast needs a <ToastProvider> above it")
  return api
}

/** The toast API when a ToastProvider is above, else null (standalone use and tests). */
export const useOptionalToast = (): ToastApi | null => useContext(ToastContext)

export interface ToastRegionProps {
  toasts: readonly Toast[]
  onDismiss: (id: string) => void
}

const subscribeLayers = (cb: () => void) => layerController.stack.subscribe(cb)
const anyLayerOpen = () => layerController.isAnyOpen()
const noLayer = () => false

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const holds = (region: HTMLElement | null) => ({
  focus: !!region && region.contains(document.activeElement),
  hover: !!region?.matches(":hover"),
})

/**
 * Bottom-centre stack above the tray; hovering or focusing it pauses every timer. While a popover, menu or
 * dialog is open the stack sits under it, so a toast never takes the clicks meant for the open layer.
 */
export const ToastRegion = ({ toasts, onDismiss }: ToastRegionProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const layered = useSyncExternalStore(subscribeLayers, anyLayerOpen, noLayer)

  // WebKit and Firefox send no focusout when a focused action leaves with its toast
  useIsoLayoutEffect(() => {
    setPaused((p) => pauseAfter(p, { kind: "changed", ...holds(ref.current) }))
  }, [toasts])

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className="sc-toasts"
      data-layered={layered || undefined}
      onPointerEnter={() => setPaused((p) => pauseAfter(p, { kind: "enter" }))}
      onPointerLeave={() => setPaused((p) => pauseAfter(p, { kind: "leave", ...holds(ref.current) }))}
      onFocus={() => setPaused((p) => pauseAfter(p, { kind: "focus" }))}
      onBlur={(e) =>
        setPaused((p) =>
          pauseAfter(p, {
            kind: "blur",
            focus: !!ref.current?.contains(e.relatedTarget as Node | null),
            hover: holds(ref.current).hover,
          }),
        )
      }
    >
      {toasts.map((t) => (
        <ToastView
          key={t.id}
          toast={t}
          paused={paused}
          onDismiss={onDismiss}
          onAct={() => setPaused((p) => pauseAfter(p, { kind: "acted" }))}
        />
      ))}
    </div>
  )
}

const ToastView = ({
  toast,
  paused,
  onDismiss,
  onAct,
}: { toast: Toast; paused: boolean; onDismiss: (id: string) => void; onAct: () => void }) => {
  const remaining = useRef(toast.duration)
  useEffect(() => {
    remaining.current = toast.duration
  }, [toast])
  useEffect(() => {
    if (paused || toast.duration <= 0) return
    const started = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [paused, toast, onDismiss])

  return (
    <div className="sc-toast" data-kind={toast.kind} data-action={toast.action ? "" : undefined}>
      <span className="sc-toast-message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="sc-toast-action"
          onClick={() => {
            onAct()
            toast.action!.run()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  )
}
