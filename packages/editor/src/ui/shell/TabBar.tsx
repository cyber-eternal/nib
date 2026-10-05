import {
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { TabView } from "../../document/tabs"
import { isImeKey } from "../../hooks/useShortcuts"
import { IconButton } from "../primitives"
import { displayName, pathLabel, renamedTo } from "./docName"
import { ShellIcons } from "./icons"
import "./shell.css"

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect
const TAB_MIME = "application/x-nib-tab"

export interface TabBarProps {
  tabs: readonly TabView[]
  activeId: string
  /** True for a moment after a save, so "Saved" can fade in. */
  justSaved: boolean
  menuOpen: boolean
  menuButtonRef: MutableRefObject<HTMLButtonElement | null>
  onToggleMenu(): void
  onActivate(id: string): void
  onClose(id: string): void
  onNew(): void
  onMove(id: string, index: number): void
  onRename(id: string, name: string): void
  /** Right-click, the context-menu key or ⇧F10 on a tab, at a point in the window. */
  onTabMenu(id: string, at: { x: number; y: number }): void
  /** View mode and slide shows lock the names. */
  readOnly?: boolean
}

/** Where a tab dragged from `from` lands when dropped on the tab at `over`, before or after its middle. */
export const dropIndex = (from: number, over: number, after: boolean): number => {
  const slot = over + (after ? 1 : 0)
  return slot > from ? slot - 1 : slot
}

/** The tab the arrow, Home and End keys move to in the tab list, or null for other keys. */
export const tabKeyTarget = (key: string, index: number, count: number): number | null => {
  if (key === "ArrowRight") return (index + 1) % count
  if (key === "ArrowLeft") return (index - 1 + count) % count
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return null
}

/**
 * Top-left: the main-menu button and one tab per open drawing, in the pill the document label used to
 * be. Each tab shows its name, renamable by double-click, and its edited dot, which turns into the close
 * button under the pointer; the strip scrolls sideways when the tabs outgrow it.
 */
export const TabBar = forwardRef<HTMLDivElement, TabBarProps>(function TabBar(
  {
    tabs,
    activeId,
    justSaved,
    menuOpen,
    menuButtonRef,
    onToggleMenu,
    onActivate,
    onClose,
    onNew,
    onMove,
    onRename,
    onTabMenu,
    readOnly,
  },
  ref,
) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  // a rename finished from the keyboard hands focus back to the tab, not to <body>
  const refocus = useRef<string | null>(null)

  useIsoLayoutEffect(() => {
    tabRefs.current.get(activeId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeId, tabs.length])

  useIsoLayoutEffect(() => {
    if (renaming || !refocus.current) return
    tabRefs.current.get(refocus.current)?.focus()
    refocus.current = null
  }, [renaming])

  const focusTab = (index: number) => {
    const tab = tabs[index]
    if (!tab) return
    onActivate(tab.id)
    tabRefs.current.get(tab.id)?.focus()
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number, id: string) => {
    const to = tabKeyTarget(e.key, index, tabs.length)
    if (to !== null) {
      e.preventDefault()
      focusTab(to)
    } else if (e.key === "F2" && !readOnly) {
      e.preventDefault()
      setRenaming(id)
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      onTabMenu(id, { x: r.left, y: r.bottom })
    }
  }

  const onDragOver = (e: DragEvent<HTMLElement>, id: string) => {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > r.left + r.width / 2
    if (dropAt?.id !== id || dropAt.after !== after) setDropAt({ id, after })
  }

  const onDrop = (e: DragEvent<HTMLElement>, overIndex: number) => {
    const id = e.dataTransfer.getData(TAB_MIME)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    const from = tabs.findIndex((t) => t.id === id)
    if (from >= 0 && dropAt) onMove(id, dropIndex(from, overIndex, dropAt.after))
    setDropAt(null)
  }

  const active = tabs.find((t) => t.id === activeId)

  return (
    <div ref={ref} className="shell-doc shell-tabs" data-zone="top">
      <IconButton
        ref={menuButtonRef}
        label="Menu"
        icon={ShellIcons.menu}
        tooltipSide="bottom"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="menu-button"
        data-active={menuOpen || undefined}
        onClick={onToggleMenu}
      />
      <div
        ref={strip}
        className="shell-tablist"
        role="tablist"
        aria-label="Open drawings"
        onWheel={(e) => {
          // a mouse wheel scrolls the strip sideways, as trackpads already do
          if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId
          const shown = displayName(tab.name)
          return (
            <div
              key={tab.id}
              className="shell-tab"
              data-active={selected || undefined}
              data-dirty={tab.dirty || undefined}
              data-drop={dropAt?.id === tab.id ? (dropAt.after ? "after" : "before") : undefined}
              draggable={renaming !== tab.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, tab.id)
                e.dataTransfer.effectAllowed = "move"
              }}
              onDragOver={(e) => onDragOver(e, tab.id)}
              onDragLeave={() => setDropAt((d) => (d?.id === tab.id ? null : d))}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={() => setDropAt(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                onTabMenu(tab.id, { x: e.clientX, y: e.clientY })
              }}
            >
              {renaming === tab.id ? (
                <NameField
                  initial={shown}
                  onDone={(draft, byKey) => {
                    refocus.current = byKey ? tab.id : null
                    setRenaming(null)
                    if (draft === null) return
                    const next = renamedTo(tab.name, draft)
                    if (next) onRename(tab.id, next)
                  }}
                />
              ) : (
                <button
                  ref={(el) => {
                    if (el) tabRefs.current.set(tab.id, el)
                    else tabRefs.current.delete(tab.id)
                  }}
                  type="button"
                  role="tab"
                  id={`shell-tab-${tab.id}`}
                  className="shell-tab-label"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  title={tab.path ? pathLabel(tab.path) : shown}
                  onClick={() => onActivate(tab.id)}
                  onMouseDown={(e) => {
                    // the middle button would otherwise start autoscroll before auxclick arrives
                    if (e.button === 1) e.preventDefault()
                  }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return
                    e.preventDefault()
                    onClose(tab.id)
                  }}
                  onDoubleClick={() => {
                    if (!readOnly) setRenaming(tab.id)
                  }}
                  onKeyDown={(e) => onTabKey(e, index, tab.id)}
                >
                  {shown}
                  {tab.dirty ? <span className="sc-visually-hidden">, edited</span> : null}
                </button>
              )}
              <button
                type="button"
                className="shell-tab-close"
                tabIndex={-1}
                aria-label={`Close ${shown}`}
                title={`Close ${shown}`}
                onClick={() => onClose(tab.id)}
              >
                <span className="shell-tab-dot" aria-hidden="true" />
                <span className="shell-tab-x" aria-hidden="true">
                  {ShellIcons.close}
                </span>
              </button>
            </div>
          )
        })}
      </div>
      <IconButton label="New tab" icon={ShellIcons.plus} tooltipSide="bottom" onClick={onNew} />
      <span className="shell-doc-state" role="status" aria-live="polite">
        {justSaved && active && !active.dirty ? <span className="shell-doc-saved">Saved</span> : null}
      </span>
    </div>
  )
})

const NameField = ({
  initial,
  onDone,
}: { initial: string; onDone(draft: string | null, byKey: boolean): void }) => {
  const [draft, setDraft] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (value: string | null, byKey = false) => {
    if (done.current) return
    done.current = true
    onDone(value, byKey)
  }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className="shell-doc-input"
      aria-label="Document name"
      value={draft}
      size={Math.max(8, draft.length + 1)}
      maxLength={120}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (isImeKey(e.nativeEvent)) return
        if (e.key === "Enter") {
          e.preventDefault()
          finish(draft, true)
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          finish(null, true)
        }
      }}
      onBlur={() => finish(draft)}
    />
  )
}
