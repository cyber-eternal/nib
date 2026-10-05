import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { DismissReason } from "../../hooks/useLayer"
import { chordToAria, isMacPlatform } from "../../hooks/useShortcuts"
import { Kbd } from "./Kbd"
import { Popover, type PopoverAnchor } from "./Popover"
import { Typeahead, moveIndex, navMoveFor, typeaheadIndex } from "./menuNav"
import type { Align, Side } from "./position"

export interface MenuItem {
  id: string
  label: string
  onSelect: () => void
  /** A chord such as "Mod+S", shown in the shortcut column and exposed as aria-keyshortcuts. */
  shortcut?: string
  icon?: ReactNode
  disabled?: boolean
  /** Destructive: danger colour. Put it in its own `isolated` section so it never sits next to frequent items. */
  danger?: boolean
  kind?: "item" | "checkbox" | "radio"
  checked?: boolean
  /** Keep the menu open after selecting (toggles). */
  keepOpen?: boolean
}

export interface MenuSection {
  id: string
  /** Small header; also labels the group for assistive tech. */
  label?: string
  items: readonly MenuItem[]
  /** Set apart by a deliberate gap (destructive actions). */
  isolated?: boolean
}

export interface MenuProps {
  label: string
  sections?: readonly MenuSection[]
  items?: readonly MenuItem[]
  /** Called after an item is chosen (unless keepOpen) and on Tab. */
  onClose?: () => void
  autoFocus?: "first" | "last" | "none"
  className?: string
  isMac?: boolean
}

const ROLE = { item: "menuitem", checkbox: "menuitemcheckbox", radio: "menuitemradio" } as const

const checkIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    aria-hidden="true"
  >
    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** role=menu list: arrow keys, Home/End, typeahead, a shortcut column, and checkable items. */
export const Menu = ({
  label,
  sections,
  items,
  onClose,
  autoFocus = "first",
  className,
  isMac,
}: MenuProps) => {
  const groups = useMemo<readonly MenuSection[]>(
    () => sections ?? [{ id: "items", items: items ?? [] }],
    [sections, items],
  )
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const disabled = useMemo(() => flat.map((i) => !!i.disabled), [flat])
  const [chosen, setActive] = useState(() => moveIndex(disabled, -1, autoFocus === "last" ? "last" : "first"))
  const active =
    chosen >= 0 && chosen < flat.length && !disabled[chosen] ? chosen : moveIndex(disabled, -1, "first")
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const typeahead = useRef(new Typeahead())
  const baseId = useId()
  const mac = isMac ?? isMacPlatform()

  const initialFocus = useRef(autoFocus === "none" ? -1 : active)
  // mount only: consumers pass inline sections, and re-focusing on every render would yank focus
  useEffect(() => {
    if (initialFocus.current >= 0) refs.current[initialFocus.current]?.focus({ preventScroll: true })
  }, [])

  const focusAt = (i: number) => {
    if (i < 0) return
    setActive(i)
    const el = refs.current[i]
    el?.focus({ preventScroll: true })
    // a tall menu scrolls inside its popover; keyboard moves must keep the focused item in view
    el?.scrollIntoView?.({ block: "nearest" })
  }

  const choose = (item: MenuItem) => {
    if (item.disabled) return
    item.onSelect()
    if (!item.keepOpen) onClose?.()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = navMoveFor(e.key, "vertical")
    if (move) {
      e.preventDefault()
      e.stopPropagation()
      focusAt(moveIndex(disabled, active, move))
      return
    }
    if (e.key === "Tab") {
      onClose?.()
      return
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== " ") {
      e.preventDefault()
      e.stopPropagation()
      const query = typeahead.current.push(e.key, Date.now())
      focusAt(
        typeaheadIndex(
          flat.map((i) => i.label),
          disabled,
          active,
          query,
        ),
      )
    }
  }

  let index = -1
  return (
    <div
      role="menu"
      aria-label={label}
      className={["sc-menu", className ?? ""].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {groups.map((group, gi) => {
        const headId = `${baseId}-${group.id}`
        return (
          <div
            key={group.id}
            role="group"
            aria-labelledby={group.label ? headId : undefined}
            className="sc-menu-section"
            data-isolated={group.isolated || undefined}
          >
            {gi > 0 ? <hr className="sc-menu-separator" /> : null}
            {group.label ? (
              <div id={headId} role="presentation" className="sc-menu-heading">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              index++
              const i = index
              const kind = item.kind ?? "item"
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  type="button"
                  role={ROLE[kind]}
                  aria-checked={kind === "item" ? undefined : !!item.checked}
                  aria-disabled={item.disabled || undefined}
                  aria-keyshortcuts={item.shortcut ? chordToAria(item.shortcut, mac) : undefined}
                  tabIndex={i === active ? 0 : -1}
                  className="sc-menu-item"
                  data-danger={item.danger || undefined}
                  onClick={() => choose(item)}
                  onFocus={() => setActive(i)}
                  onPointerMove={(e) => {
                    if (
                      e.pointerType === "mouse" &&
                      !item.disabled &&
                      document.activeElement !== e.currentTarget
                    )
                      focusAt(i)
                  }}
                >
                  <span className="sc-menu-icon" aria-hidden="true">
                    {item.icon ?? (kind !== "item" && item.checked ? checkIcon : null)}
                  </span>
                  <span className="sc-menu-label">{item.label}</span>
                  {item.shortcut ? <Kbd chord={item.shortcut} plain decorative isMac={mac} /> : null}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export interface MenuPopoverProps extends Omit<MenuProps, "onClose" | "autoFocus"> {
  open: boolean
  onClose: (reason?: DismissReason) => void
  anchor: PopoverAnchor
  side?: Side
  align?: Align
  ignore?: readonly RefObject<HTMLElement | null>[]
}

/** A Menu in a Popover: opens on the first item, closes on choice, Escape, Tab or an outside press. */
export const MenuPopover = ({
  open,
  onClose,
  anchor,
  side = "bottom",
  align = "start",
  ignore,
  ...menu
}: MenuPopoverProps) => (
  <Popover
    open={open}
    onClose={onClose}
    anchor={anchor}
    side={side}
    align={align}
    contentRole="none"
    initialFocus="first"
    ignore={ignore}
    className="sc-menu-popover"
  >
    <Menu {...menu} autoFocus="none" onClose={() => onClose()} />
  </Popover>
)
