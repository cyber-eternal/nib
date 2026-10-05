import type { EditorCore, ToolType } from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"
import { Fragment, memo, useEffect, useId, useMemo, useRef, useState } from "react"
import { type ThemeDef, matchSystemTheme } from "../../theme/themes"
import { Icons } from "../Icons"
import { Toolbar } from "../primitives/Toolbar"
import { ColorCaps } from "./ColorCaps"
import { FreehandOptions } from "./FreehandOptions"
import { MoreDrawer } from "./MoreDrawer"
import { TrayMarker } from "./TrayMarker"
import {
  DRAWER_ITEMS,
  type DrawerItem,
  type MarkerDef,
  VIEW_MODE_MARKERS,
  applyStroke,
  ariaKeys,
  armPen,
  armPencil,
  capNames,
  isFreehandTool,
  markerHeld,
  markerKey,
  markerName,
  pickImage,
  themeForCaps,
  trayGroups,
} from "./trayModel"
import { NARROW_QUERY, useMediaQuery, useTrayFit, useTraySnapshot } from "./useTrayState"
import "./tray.css"

export interface MarkerTrayProps {
  core: EditorCore
  /** The theme's five marker caps, as display colours (ThemeDef.caps). */
  caps: readonly string[]
  prefs: PlatformPrefs
  /** Fallback picker for hosts that do not install core.host.onRequestImage (core opens it otherwise). */
  onInsertImage(): void
  onOpenMermaid(): void
  /** The applied theme; when absent the board is found from `caps`. */
  theme?: ThemeDef
  /** Tools to leave out, such as "embeddable" in a build without canvas/EmbedOverlay. */
  hiddenTools?: readonly ToolType[]
}

const GROUP_LABELS = ["Select and pan", "Draw"]
const NO_TOOLS: readonly ToolType[] = []
const KEPT = ", kept active"

/** The one tray along the bottom edge: markers on the left, colour caps on the right (Marker Tray brief). */
export const MarkerTray = memo(function MarkerTray({
  core,
  caps,
  prefs,
  onInsertImage,
  onOpenMermaid,
  theme,
  hiddenTools = NO_TOOLS,
}: MarkerTrayProps) {
  const snap = useTraySnapshot(core)
  const narrow = useMediaQuery(NARROW_QUERY)
  const dock = useRef<HTMLDivElement>(null)
  const { collapse, scroll } = useTrayFit(dock, narrow, snap.viewMode ? 0 : caps.length)
  const moreRef = useRef<HTMLButtonElement>(null)
  const penRef = useRef<HTMLButtonElement>(null)
  const pencilRef = useRef<HTMLButtonElement>(null)
  const freehandRefs = useMemo(() => [penRef, pencilRef], [])
  const drawerId = useId()
  const penOptionsId = useId()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [penOpen, setPenOpen] = useState(false)

  const def = theme ?? themeForCaps(caps)
  const board = def?.board
  const names = useMemo(() => capNames(caps, def), [caps, def])
  const hidden = (t: ToolType) => hiddenTools.includes(t)
  const freehand = isFreehandTool(snap.tool)
  const pencilHeld = snap.tool === "pencil" && !snap.penHolds

  useEffect(() => {
    if (!freehand) setPenOpen(false)
  }, [freehand])

  useEffect(() => {
    if (snap.viewMode) setDrawerOpen(false)
  }, [snap.viewMode])

  // fades mark the edges that hide more markers, so a scrolled tray never looks complete
  // biome-ignore lint/correctness/useExhaustiveDependencies: collapsing resizes the row; view mode swaps the dock element
  useEffect(() => {
    const el = dock.current
    const tools = el?.querySelector<HTMLElement>(".tray-tools")
    if (!el || !tools) return
    const update = () => {
      const max = tools.scrollWidth - tools.clientWidth
      el.toggleAttribute("data-fade-start", scroll && tools.scrollLeft > 1)
      el.toggleAttribute("data-fade-end", scroll && tools.scrollLeft < max - 1)
    }
    update()
    tools.addEventListener("scroll", update, { passive: true })
    return () => tools.removeEventListener("scroll", update)
  }, [scroll, collapse, snap.viewMode])

  // a key press can arm a marker that is scrolled out of a narrow tray
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the held marker changes
  useEffect(() => {
    if (!scroll) return
    const held = dock.current?.querySelector<HTMLElement>(".tray-tools .tray-marker[aria-pressed='true']")
    held?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [snap.tool, snap.penHolds, scroll])

  const select = (m: MarkerDef) => {
    setDrawerOpen(false)
    if (markerHeld(m, snap)) {
      if (isFreehandTool(m.tool)) setPenOpen((v) => !v)
      return
    }
    setPenOpen(false)
    if (m.tool === "image") pickImage(core, onInsertImage)
    else if (m.tool === "freedraw") armPen(core, prefs)
    else if (m.tool === "pencil") armPencil(core)
    else core.setTool(m.tool)
  }

  const pickDrawer = (item: DrawerItem) => {
    if (item.kind === "lock") {
      core.toggleToolLock()
      return
    }
    setDrawerOpen(false)
    if (item.kind === "tool") {
      if (item.def.tool === "image") pickImage(core, onInsertImage)
      else core.setTool(item.def.tool)
    } else onOpenMermaid()
  }

  const renderMarker = (m: MarkerDef) => {
    const active = markerHeld(m, snap)
    const options = active && isFreehandTool(m.tool)
    const base = markerName(m)
    const name = m.tool === "freedraw" && snap.penHolds && active ? `${base}, corrects shapes` : base
    const kept = active && snap.locked
    const label = kept ? `${name}${KEPT}` : name
    return (
      <TrayMarker
        key={m.tool}
        ref={m.tool === "freedraw" ? penRef : m.tool === "pencil" ? pencilRef : undefined}
        label={label}
        tooltip={options ? `${label}, click for options` : label}
        icon={Icons[m.icon]}
        pressed={active}
        kept={kept}
        shortcut={markerKey(m)}
        ariaKeys={ariaKeys(m)}
        data-tool={m.tool}
        data-testid={`tool-${m.tool}`}
        aria-haspopup={options ? "dialog" : undefined}
        aria-expanded={options ? penOpen : undefined}
        aria-controls={options && penOpen ? penOptionsId : undefined}
        flag={options ? Icons.chevronUp : undefined}
        onClick={() => select(m)}
      />
    )
  }

  if (snap.viewMode) {
    return (
      <div
        ref={dock}
        className="tray-dock"
        data-scroll={scroll || undefined}
        data-narrow={narrow || undefined}
      >
        <Toolbar label="Tools" className="tray-row">
          <div className="tray-tools">
            <div className="tray-group" role="group" aria-label="View tools">
              {VIEW_MODE_MARKERS.filter((m) => !hidden(m.tool)).map(renderMarker)}
            </div>
          </div>
        </Toolbar>
      </div>
    )
  }

  const drawerItems = DRAWER_ITEMS.filter((i) => i.kind !== "tool" || !hidden(i.def.tool))
  const heldDrawer = drawerItems.find((i) => i.kind === "tool" && i.def.tool === snap.tool)
  const moreIcon = heldDrawer?.kind === "tool" ? Icons[heldDrawer.def.icon] : Icons.more
  const moreKept = heldDrawer !== undefined && snap.locked
  const moreLabel = heldDrawer
    ? `More tools (${heldDrawer.name} selected${moreKept ? ", kept active" : ""})`
    : "More tools"

  return (
    <div ref={dock} className="tray-dock" data-scroll={scroll || undefined} data-narrow={narrow || undefined}>
      <Toolbar label="Tools" className="tray-row">
        {/* only the markers scroll; More and the colour stay in reach at every width */}
        <div className="tray-tools">
          {trayGroups(narrow).map((group, i) => (
            <Fragment key={GROUP_LABELS[i]}>
              {i > 0 ? <span className="tray-seam" aria-hidden="true" /> : null}
              <div className="tray-group" role="group" aria-label={GROUP_LABELS[i]}>
                {group.filter((m) => !hidden(m.tool)).map(renderMarker)}
              </div>
            </Fragment>
          ))}
        </div>
        <span className="tray-seam" aria-hidden="true" />
        <TrayMarker
          ref={moreRef}
          label={moreLabel}
          tooltip={moreKept ? "More tools, kept active" : "More tools"}
          icon={moreIcon}
          lifted={heldDrawer !== undefined}
          kept={moreKept}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={drawerOpen ? drawerId : undefined}
          data-testid="tray-more"
          onClick={() => {
            setPenOpen(false)
            setDrawerOpen((v) => !v)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && !drawerOpen) {
              e.preventDefault()
              setDrawerOpen(true)
            }
          }}
        />
        <span className="tray-seam" aria-hidden="true" />
        <ColorCaps
          caps={caps}
          names={names}
          mode={snap.mode}
          board={board}
          stroke={snap.stroke}
          collapsed={collapse}
          theme={def ?? matchSystemTheme(snap.mode === "dark")}
          elements={() => core.scene.getNonDeleted()}
          onPick={(stored) => applyStroke(core, stored)}
        />
      </Toolbar>
      <MoreDrawer
        open={drawerOpen}
        id={drawerId}
        onClose={() => setDrawerOpen(false)}
        anchor={moreRef}
        items={drawerItems}
        tool={snap.tool}
        locked={snap.locked}
        onPick={pickDrawer}
      />
      <FreehandOptions
        open={penOpen && freehand}
        id={penOptionsId}
        label={pencilHeld ? "Pencil options" : "Pen options"}
        onClose={(reason) => {
          setPenOpen(false)
          // the popover stays on the pen so the switch never jumps; Escape still returns to the held marker
          if (reason === "escape" && pencilHeld) requestAnimationFrame(() => pencilRef.current?.focus())
        }}
        anchor={hidden("freedraw") ? pencilRef : penRef}
        ignore={freehandRefs}
        core={core}
        prefs={prefs}
        checked={snap.tool === "pencil"}
      />
    </div>
  )
})
