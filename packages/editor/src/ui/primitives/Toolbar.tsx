import {
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
} from "react"
import { type Orientation, moveIndex, navMoveFor } from "./menuNav"

export interface ToolbarProps {
  label: string
  orientation?: Exclude<Orientation, "both">
  className?: string
  children?: ReactNode
  /** Marks a toolbar whose controls keep an open text editor open (KEEPS_TEXT_EDITING). */
  keepsTextEditing?: boolean
}

// nested composites (a radiogroup of segments) keep their own tab stop
const items = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>("button, [role=button]")).filter(
    (el) =>
      el.closest("[role=toolbar]") === root && !el.parentElement?.closest("[role=radiogroup], [role=menu]"),
  )

const isDisabled = (el: HTMLElement): boolean =>
  (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true"

const TEXT_EDITOR = "[data-text-editor]"
const LAYER = ".sc-popover, .sc-dialog"

/**
 * Chromium focuses a button on mouse press, which then keeps Space, Enter and the arrows from the board
 * (WebKit never does). Presses leave focus off the button and release whatever field held it, as a press
 * on the board does; keyboard users who Tab in keep roving focus.
 */
const keepPointerFocusOff = (e: MouseEvent<HTMLElement>, root: HTMLElement, keepsText: boolean): void => {
  if (e.button !== 0) return
  const pressed = (e.target as Element).closest?.("button, [role=button]")
  if (!(pressed instanceof HTMLElement) || !items(root).includes(pressed)) return
  e.preventDefault()
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return
  if (keepsText && active.closest(TEXT_EDITOR)) return
  // a field elsewhere in the same popover is still in use; only focus outside it is released
  const layer = root.closest(LAYER)
  if (layer?.contains(active) && !root.contains(active)) return
  active.blur()
}

/** role=toolbar with one tab stop; arrow keys, Home and End move between its buttons (roving tabindex). */
export const Toolbar = forwardRef(function Toolbar(
  { label, orientation = "horizontal", className, children, keepsTextEditing }: ToolbarProps,
  forwarded: Ref<HTMLDivElement>,
) {
  const ref = useRef<HTMLDivElement | null>(null)
  const current = useRef(0)
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el
      if (typeof forwarded === "function") forwarded(el)
      else if (forwarded) (forwarded as MutableRefObject<HTMLDivElement | null>).current = el
    },
    [forwarded],
  )

  const sync = () => {
    const root = ref.current
    if (!root) return
    const list = items(root)
    if (current.current >= list.length || (list[current.current] && isDisabled(list[current.current]!))) {
      current.current = Math.max(0, moveIndex(list.map(isDisabled), -1, "first"))
    }
    list.forEach((el, i) => {
      el.tabIndex = i === current.current ? 0 : -1
    })
  }

  // children re-render often (pressed state); re-sync tab stops after every commit
  useEffect(sync)

  // native focusin, not React's onFocus: focus a layer restores during a commit's cleanup must still move
  // the tab stop
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads only refs
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onFocusIn = (e: FocusEvent) => {
      const i = items(root).indexOf(e.target as HTMLElement)
      if (i >= 0 && i !== current.current) {
        current.current = i
        sync()
      }
    }
    root.addEventListener("focusin", onFocusIn)
    return () => root.removeEventListener("focusin", onFocusIn)
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = navMoveFor(e.key, orientation)
    const root = ref.current
    if (!move || !root) return
    const list = items(root)
    const from = list.indexOf(document.activeElement as HTMLElement)
    if (from < 0) return
    e.preventDefault()
    e.stopPropagation()
    const next = moveIndex(list.map(isDisabled), from, move)
    if (next < 0) return
    current.current = next
    sync()
    list[next]!.focus()
  }

  return (
    <div
      ref={setRef}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      className={["sc-toolbar", className ?? ""].filter(Boolean).join(" ")}
      data-orientation={orientation}
      data-keeps-text-editing={keepsTextEditing ? "" : undefined}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (ref.current) keepPointerFocusOff(e, ref.current, !!keepsTextEditing)
      }}
    >
      {children}
    </div>
  )
})
