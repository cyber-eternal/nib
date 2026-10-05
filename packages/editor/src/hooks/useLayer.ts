import {
  type ReactNode,
  type RefObject,
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  type DismissReason,
  type LayerEntry,
  type LayerHit,
  LayerStack,
  trapTabIndex,
} from "../ui/primitives/layerStack"

export type { DismissReason } from "../ui/primitives/layerStack"

interface LayerHandlers {
  element(): HTMLElement | null
  ignores(target: Node): boolean
  dismiss(reason: DismissReason): void
}

interface KeyEventLike {
  key: string
  shiftKey: boolean
  defaultPrevented: boolean
  isComposing?: boolean
  keyCode?: number
  preventDefault(): void
  stopPropagation(): void
}

interface PointerEventLike {
  target: EventTarget | null
}

const TABBABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable]:not([contenteditable=false])",
  "[tabindex]",
].join(",")

export const tabbablesIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute("inert") && el.getClientRects().length > 0,
  )

const focusInto = (el: HTMLElement | null, target: "first" | "container" = "first"): void => {
  if (!el) return
  const first = target === "first" ? tabbablesIn(el)[0] : undefined
  ;(first ?? el).focus({ preventScroll: true })
}

/**
 * The one dismissable-layer stack for the app. Document listeners attach while any layer is open, so
 * Escape, outside presses and the modal focus guard are decided in one place.
 */
class LayerController {
  readonly stack = new LayerStack()
  private handlers = new Map<string, LayerHandlers>()
  private attached = false

  register(entry: LayerEntry, handlers: LayerHandlers): () => void {
    this.handlers.set(entry.id, handlers)
    this.stack.push(entry)
    this.sync()
    return () => {
      this.handlers.delete(entry.id)
      this.stack.remove(entry.id)
      this.sync()
    }
  }

  isModalOpen = (): boolean => this.stack.isModalOpen()

  isAnyOpen = (): boolean => this.stack.layers.length > 0

  layerIndexOf(target: Node | null): number {
    if (!target) return -1
    const layers = this.stack.layers
    for (let i = layers.length - 1; i >= 0; i--) {
      if (this.handlers.get(layers[i]!.id)?.element()?.contains(target)) return i
    }
    return -1
  }

  /** Returns true when Escape was consumed by the top layer. */
  onKeyDown = (e: KeyEventLike): boolean => {
    if (e.key === "Tab") {
      this.trapTab(e)
      return false
    }
    // WebKit sends the Escape that cancels an IME candidate after compositionend, flagged only by 229
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return false
    const top = this.stack.escapeTarget()
    if (!top) return false
    e.preventDefault()
    e.stopPropagation()
    if (top.dismissOnEscape) this.handlers.get(top.id)?.dismiss("escape")
    return true
  }

  onPointerDown = (e: PointerEventLike): string[] => {
    const target = e.target as Node | null
    if (!target) return []
    const ids = this.stack.outsideDismissals((entry): LayerHit => {
      const h = this.handlers.get(entry.id)
      if (h?.element()?.contains(target)) return "inside"
      if (h?.ignores(target)) return "ignored"
      return "outside"
    })
    for (const id of ids) this.handlers.get(id)?.dismiss("outside")
    return ids
  }

  private onFocusIn = (e: FocusEvent): void => {
    const index = this.layerIndexOf(e.target as Node | null)
    if (this.stack.allowsFocusIn(index)) return
    const modal = this.stack.layers[this.stack.topModalIndex()]
    if (modal) focusInto(this.handlers.get(modal.id)?.element() ?? null)
  }

  private trapTab(e: KeyEventLike): void {
    const top = this.stack.top()
    if (!top?.modal) return
    const root = this.handlers.get(top.id)?.element()
    if (!root) return
    const items = tabbablesIn(root)
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = trapTabIndex(items.length, current, e.shiftKey)
    if (next === null) return
    e.preventDefault()
    ;(next < 0 ? root : items[next]!).focus()
  }

  private domKeyDown = (e: KeyboardEvent): void => {
    this.onKeyDown(e)
  }

  private domPointerDown = (e: PointerEvent): void => {
    this.onPointerDown(e)
  }

  private sync(): void {
    if (typeof document === "undefined") return
    const want = this.stack.layers.length > 0
    if (want === this.attached) return
    this.attached = want
    // bubble phase on document: React handlers inside layers run first, the window shortcut router after
    if (want) {
      document.addEventListener("keydown", this.domKeyDown)
      document.addEventListener("pointerdown", this.domPointerDown, true)
      document.addEventListener("focusin", this.onFocusIn, true)
    } else {
      document.removeEventListener("keydown", this.domKeyDown)
      document.removeEventListener("pointerdown", this.domPointerDown, true)
      document.removeEventListener("focusin", this.onFocusIn, true)
    }
  }
}

export const layerController = new LayerController()

/** Gate for global shortcuts and paste: true while any modal layer (dialog) is open. */
export const isModalOpen = (): boolean => layerController.isModalOpen()

export const isAnyLayerOpen = (): boolean => layerController.isAnyOpen()

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const subscribe = (cb: () => void) => layerController.stack.subscribe(cb)
const version = () => layerController.stack.version

/** Re-renders when a modal layer opens or closes. */
export const useModalOpen = (): boolean => {
  useSyncExternalStore(subscribe, version, version)
  return layerController.isModalOpen()
}

const ParentLayerContext = createContext<string | null>(null)
const HostContext = createContext<HTMLElement | null>(null)

/** Wraps children so a layer opened inside another layer stacks above it. */
export const LayerScope = ({ id, children }: { id: string; children?: ReactNode }) =>
  createElement(ParentLayerContext.Provider, { value: id }, children)

/**
 * Hosts portalled layers inside the themed subtree, so popovers, dialogs and tooltips inherit the
 * theme's CSS variables. Without a provider, layers portal into document.body.
 */
export const LayerProvider = ({ children }: { children?: ReactNode }) => {
  const [host, setHost] = useState<HTMLElement | null>(null)
  // children wait one (pre-paint) commit for the host: a layer open on first render would otherwise
  // portal into body and then remount into the host, losing its placement and focus
  const ready = host !== null || typeof document === "undefined"
  return createElement(
    HostContext.Provider,
    { value: host },
    ready ? children : null,
    createElement("div", { ref: setHost, className: "sc-layer-host", "data-layer-host": "" }),
  )
}

export const useLayerHost = (): HTMLElement | null => {
  const host = useContext(HostContext)
  if (host) return host
  return typeof document === "undefined" ? null : document.body
}

export type InitialFocus =
  | "first"
  | "container"
  | "none"
  | RefObject<HTMLElement | null>
  | (() => HTMLElement | null | undefined)

export interface UseLayerOptions {
  open: boolean
  /** The layer's own element: presses inside it are not "outside", and focus is trapped to it when modal. */
  ref: RefObject<HTMLElement | null>
  onDismiss: (reason: DismissReason) => void
  modal?: boolean
  dismissOnEscape?: boolean
  /** Defaults to true for non-modal layers and false for modal ones. */
  dismissOnOutside?: boolean
  /** Presses on these (typically the opener) neither count as outside nor dismiss; the opener toggles. */
  ignore?: readonly RefObject<HTMLElement | null>[]
  /** Defaults to "first" for modal layers and "container" otherwise. */
  initialFocus?: InitialFocus
  /** Where focus returns on close; defaults to whatever was focused when the layer opened. */
  restoreFocus?: boolean | RefObject<HTMLElement | null>
}

export interface LayerState {
  id: string
  isTop: boolean
  depth: number
  zIndex: string
}

export const useLayer = (opts: UseLayerOptions): LayerState => {
  const id = useId()
  const parentId = useContext(ParentLayerContext)
  const latest = useRef(opts)
  latest.current = opts
  const modal = opts.modal ?? false
  const dismissOnEscape = opts.dismissOnEscape ?? true
  const dismissOnOutside = opts.dismissOnOutside ?? !modal

  useSyncExternalStore(subscribe, version, version)

  useIsoLayoutEffect(() => {
    if (!opts.open) return
    const opener = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
    const unregister = layerController.register(
      { id, parentId, modal, dismissOnEscape, dismissOnOutside },
      {
        element: () => latest.current.ref.current,
        ignores: (target) => (latest.current.ignore ?? []).some((r) => r.current?.contains(target)),
        dismiss: (reason) => latest.current.onDismiss(reason),
      },
    )

    const initial = latest.current.initialFocus ?? (modal ? "first" : "container")
    const el = latest.current.ref.current
    if (el && initial !== "none") {
      if (typeof initial === "function") (initial() ?? el).focus({ preventScroll: true })
      else if (typeof initial === "object") (initial.current ?? el).focus({ preventScroll: true })
      else if (!el.contains(document.activeElement)) focusInto(el, initial)
    }

    return () => {
      const layerEl = latest.current.ref.current
      unregister()
      const restore = latest.current.restoreFocus ?? true
      if (restore === false) return
      const active = document.activeElement
      const focusLost = !active || active === document.body || (layerEl?.contains(active) ?? false)
      if (!focusLost) return
      const back = typeof restore === "object" ? (restore.current ?? opener) : opener
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [opts.open, id, parentId, modal, dismissOnEscape, dismissOnOutside])

  const index = layerController.stack.indexOf(id)
  return {
    id,
    isTop: index >= 0 && index === layerController.stack.layers.length - 1,
    depth: index,
    zIndex: `calc(var(--z-layer) + ${Math.max(0, index) * 2})`,
  }
}
