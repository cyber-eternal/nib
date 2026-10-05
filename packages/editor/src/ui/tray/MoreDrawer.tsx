import type { ToolType } from "@nib/core"
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react"
import { Icons } from "../Icons"
import { Kbd } from "../primitives/Kbd"
import { Popover } from "../primitives/Popover"
import { DRAWER_COLUMNS, type DrawerItem, ariaKeys, gridMove, isGridKey, markerKey } from "./trayModel"

export interface MoreDrawerProps {
  open: boolean
  onClose: () => void
  anchor: RefObject<HTMLElement | null>
  items: readonly DrawerItem[]
  tool: ToolType
  locked: boolean
  onPick: (item: DrawerItem) => void
  id?: string
}

const pressedFor = (item: DrawerItem, tool: ToolType, locked: boolean): boolean | undefined => {
  if (item.kind === "tool") return item.def.tool === tool
  if (item.kind === "lock") return locked
  return undefined
}

/** Index the grid's roving focus starts on: the held drawer tool, else the first cell. */
export const drawerStartIndex = (items: readonly DrawerItem[], tool: ToolType): number =>
  Math.max(
    0,
    items.findIndex((i) => i.kind === "tool" && i.def.tool === tool),
  )

/** The More drawer: a labelled grid of markers that opens upward from the tray. */
export const MoreDrawer = ({ open, onClose, anchor, items, tool, locked, onPick, id }: MoreDrawerProps) => {
  const [focus, setFocus] = useState(() => drawerStartIndex(items, tool))
  const cells = useRef<(HTMLButtonElement | null)[]>([])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on opening only; while open, focus follows the keys
  useEffect(() => {
    if (open) setFocus(drawerStartIndex(items, tool))
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isGridKey(e.key)) return
    const from = cells.current.indexOf(document.activeElement as HTMLButtonElement)
    if (from < 0) return
    e.preventDefault()
    e.stopPropagation()
    const next = gridMove(from, e.key, DRAWER_COLUMNS, items.length)
    setFocus(next)
    cells.current[next]?.focus()
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      side="top"
      align="center"
      offset={12}
      label="More tools"
      id={id}
      initialFocus={() => cells.current[drawerStartIndex(items, tool)]}
    >
      <div className="tray-drawer" role="group" aria-label="More tools" onKeyDown={onKeyDown}>
        {items.map((item, i) => {
          const key = item.kind === "tool" ? markerKey(item.def) : undefined
          const icon =
            item.kind === "tool"
              ? Icons[item.def.icon]
              : item.kind === "action"
                ? Icons[item.icon]
                : locked
                  ? Icons.lock
                  : Icons.unlock
          const label = item.kind === "tool" ? item.name : item.label
          return (
            <button
              key={item.id}
              ref={(el) => {
                cells.current[i] = el
              }}
              type="button"
              className="tray-drawer-item"
              data-kind={item.kind}
              data-tool={item.kind === "tool" ? item.def.tool : undefined}
              tabIndex={i === focus ? 0 : -1}
              aria-label={label === item.name ? undefined : label}
              aria-pressed={pressedFor(item, tool, locked)}
              aria-keyshortcuts={item.kind === "tool" ? ariaKeys(item.def) : undefined}
              onFocus={() => setFocus(i)}
              onClick={() => onPick(item)}
            >
              {icon}
              <span className="tray-drawer-name">{item.name}</span>
              {key ? <Kbd chord={key} plain decorative className="tray-drawer-kbd" /> : null}
            </button>
          )
        })}
      </div>
    </Popover>
  )
}
