import { type EditorCore, FONT_STACKS } from "@nib/core"
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  createRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ThemeDef } from "../../theme/themes"
import { TRANSPARENT } from "../palette"
import { IconButton, MenuPopover, Popover, type ToastApi, Toolbar, useToast } from "../primitives"
import { applyStyle, shortcutFor } from "./apply"
import { onStyleGroupRequest } from "./bus"
import { type SwatchRole, displayColor } from "./colors"
import { StyleIcons } from "./icons"
import { GROUP_LABELS, GROUP_ORDER, MIXED, type StyleGroup, type StyleModel } from "./model"
import { moreMenuSections } from "./moreMenu"
import { StyleGroupPanel } from "./panels"
import { useStyleModel } from "./useStyleModel"
import "./StyleBar.css"

export interface StyleBarProps {
  core: EditorCore
  theme: ThemeDef
  onRequestLink(): void
  /** Optional: the shell's own tidy-up (with its toast). Without it the bar tidies and reports itself. */
  onTidy?(): void
}

const GROUP_SHORTCUTS: Partial<Record<StyleGroup, string | undefined>> = {
  strokeColor: shortcutFor("style.stroke"),
  fill: shortcutFor("style.background"),
}

/** Clusters of the bar, separated by a seam. */
const CLUSTERS: readonly (readonly StyleGroup[])[] = [
  ["strokeColor", "fill"],
  ["stroke", "edges", "closed", "arrow", "text"],
  ["opacity", "arrange"],
  ["more"],
]

const useOptionalToast = (): ToastApi | null => {
  try {
    return useToast()
  } catch {
    return null
  }
}

const chip = (className: string, color: string | typeof MIXED, theme: ThemeDef, role: SwatchRole) => {
  const mixed = color === MIXED
  const transparent = color === TRANSPARENT
  const style =
    mixed || transparent ? undefined : ({ "--swatch": displayColor(color, theme, role) } as CSSProperties)
  return (
    <span
      className={className}
      style={style}
      data-mixed={mixed || undefined}
      data-transparent={transparent || undefined}
      aria-hidden="true"
    />
  )
}

const strokePreview = (m: StyleModel): ReactNode => {
  const w = m.strokeWidth === MIXED ? 2 : Math.min(4, Math.max(1, m.strokeWidth))
  const dash =
    m.showStrokeStyle && m.strokeStyle === "dashed"
      ? "3.5 3"
      : m.showStrokeStyle && m.strokeStyle === "dotted"
        ? "0.1 3.6"
        : undefined
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M3 10h14"
        stroke="currentColor"
        strokeWidth={dash === "0.1 3.6" ? Math.max(w, 2.2) : w}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  )
}

const MIXED_ICON = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M6 10h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
)

const preview = (g: StyleGroup, m: StyleModel, theme: ThemeDef): ReactNode => {
  switch (g) {
    case "strokeColor":
      return chip("sc-stylebar-cap", m.strokeColor, theme, "stroke")
    case "fill":
      return chip("sc-stylebar-fill", m.backgroundColor, theme, "fill")
    case "stroke":
      return strokePreview(m)
    case "edges":
      return m.edges === MIXED ? MIXED_ICON : m.edges === "round" ? StyleIcons.round : StyleIcons.sharp
    case "closed":
      return StyleIcons.closedShape
    case "arrow":
      return m.arrowType === MIXED
        ? MIXED_ICON
        : m.arrowType === "elbow"
          ? StyleIcons.arrowElbow
          : m.arrowType === "round"
            ? StyleIcons.arrowCurved
            : StyleIcons.arrowStraight
    case "text":
      return (
        <span
          className="sc-style-font sc-stylebar-font"
          style={m.fontFamily === MIXED ? undefined : { fontFamily: FONT_STACKS[m.fontFamily] }}
          aria-hidden="true"
        >
          Aa
        </span>
      )
    case "opacity":
      return StyleIcons.opacity
    case "arrange":
      return StyleIcons.arrange
    case "more":
      return StyleIcons.more
  }
}

/**
 * The contextual style bar above the tray: one row of property buttons, each rising into a popover,
 * shown only when there is something to style (the selection, or the active drawing tool's defaults).
 */
export function StyleBar({ core, theme, onRequestLink, onTidy }: StyleBarProps) {
  const model = useStyleModel(core)
  const toast = useOptionalToast()
  const [open, setOpen] = useState<StyleGroup | null>(null)
  // the bar outlives what it shows: a group that left (bar hidden, undo, new selection) must not come
  // back open by itself, taking focus
  if (open !== null && !model?.groups.includes(open)) setOpen(null)
  const frame = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const anchors = useMemo(
    () =>
      Object.fromEntries(GROUP_ORDER.map((g) => [g, createRef<HTMLButtonElement>()])) as Record<
        StyleGroup,
        RefObject<HTMLButtonElement>
      >,
    [],
  )
  const groupsRef = useRef<readonly StyleGroup[]>([])
  groupsRef.current = model?.groups ?? []

  useEffect(
    () =>
      onStyleGroupRequest((g) => {
        if (!groupsRef.current.includes(g)) return false
        setOpen(g)
        return true
      }),
    [],
  )

  const groupsKey = model?.groups.join() ?? ""
  // biome-ignore lint/correctness/useExhaustiveDependencies: the groups shown change what overflows
  useEffect(() => {
    const el = frame.current
    const scroller = row.current
    if (!el || !scroller) return
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth
      el.toggleAttribute("data-fade-start", max > 1 && scroller.scrollLeft > 1)
      el.toggleAttribute("data-fade-end", max > 1 && scroller.scrollLeft < max - 1)
    }
    update()
    scroller.addEventListener("scroll", update, { passive: true })
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null
    ro?.observe(scroller)
    return () => {
      scroller.removeEventListener("scroll", update)
      ro?.disconnect()
    }
  }, [groupsKey])

  if (!model) return null

  const editing = model.editingText
  const openGroup = open && model.groups.includes(open) ? open : null
  const close = () => setOpen(null)
  const notify = (message: string) => toast?.notify(message)
  const tidy =
    onTidy ??
    (() => {
      const changed = core.tidyUp()
      notify(
        changed === 0
          ? "Nothing to straighten here."
          : `Tidied ${changed} ${changed === 1 ? "connector" : "connectors"}.`,
      )
    })
  // while text is being typed, chrome clicks must not take focus, or the editor commits and closes
  const keepTextFocus = (e: MouseEvent) => {
    if (editing && !(e.target as HTMLElement).closest("input, textarea")) e.preventDefault()
  }

  const button = (g: StyleGroup) => {
    if (g === "closed") {
      return (
        <IconButton
          key={g}
          ref={anchors[g]}
          label={GROUP_LABELS[g]}
          icon={preview(g, model, theme)}
          pressed={model.closed === true}
          disabled={!model.canClose}
          onMouseDown={keepTextFocus}
          onClick={() => applyStyle(core, { polygon: model.closed !== true })}
        />
      )
    }
    const expanded = openGroup === g
    return (
      <IconButton
        key={g}
        ref={anchors[g]}
        label={GROUP_LABELS[g]}
        icon={preview(g, model, theme)}
        shortcut={GROUP_SHORTCUTS[g]}
        aria-haspopup={g === "more" ? "menu" : "dialog"}
        aria-expanded={expanded}
        aria-controls={expanded ? `sc-style-pop-${g}` : undefined}
        data-group={g}
        onMouseDown={keepTextFocus}
        onClick={() => setOpen((o) => (o === g ? null : g))}
      />
    )
  }

  const clusters = CLUSTERS.map((c) => c.filter((g) => model.groups.includes(g))).filter((c) => c.length > 0)

  return (
    <>
      <div ref={frame} className="sc-stylebar">
        <Toolbar ref={row} label="Style" className="sc-stylebar-row" keepsTextEditing>
          {clusters.map((c, i) => (
            <span key={c[0]} className="sc-stylebar-cluster">
              {i > 0 ? <span className="sc-stylebar-seam" aria-hidden="true" /> : null}
              {c.map(button)}
            </span>
          ))}
        </Toolbar>
      </div>
      {openGroup === "more" ? (
        <MenuPopover
          open
          label={GROUP_LABELS.more}
          anchor={anchors.more}
          side="top"
          align="end"
          onClose={close}
          sections={moreMenuSections(core, model, { onRequestLink, onTidy: tidy, notify })}
        />
      ) : openGroup ? (
        <Popover
          key={openGroup}
          open
          id={`sc-style-pop-${openGroup}`}
          label={GROUP_LABELS[openGroup]}
          anchor={anchors[openGroup]}
          side="top"
          className="sc-style-pop"
          initialFocus={editing ? "none" : "first"}
          onClose={close}
        >
          <div
            className="sc-style-pop-body"
            data-group={openGroup}
            data-keeps-text-editing=""
            onMouseDown={keepTextFocus}
          >
            <StyleGroupPanel core={core} theme={theme} group={openGroup} model={model} onClose={close} />
          </div>
        </Popover>
      ) : null}
    </>
  )
}
