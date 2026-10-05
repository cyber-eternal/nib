import {
  type EditorCore,
  type NibElement,
  type Point,
  elementLink,
  getCommonBounds,
  isElementLink,
  normalizeLink,
} from "@nib/core"
import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"
import "../canvas/overlays.css"
import { elementPicker } from "../canvas/elementPicker"
import { canvasGesture } from "../canvas/gestureState"
import { LinkIcons } from "../canvas/icons"
import { followLink, summarizeLink } from "../canvas/links"
import { type ClientRect, sceneRectToClient } from "../canvas/overlayGeometry"
import { useElementPicking } from "../canvas/useCore"
import { useCoreSelector } from "../hooks/useEditor"
import { type DismissReason, useLayer, useLayerHost } from "../hooks/useLayer"
import { Button, IconButton } from "./primitives/IconButton"
import { type Side, computePlacement } from "./primitives/position"

interface Props {
  core: EditorCore
  /** The editor closed (applied, removed, Escape, a press outside, or the selection moved on). */
  onClose(): void
  /** Opens web links when the core host has no opener; links normally open through core.followLink. */
  onOpen?(url: string): void
  /**
   * Controlled use, with the popup always mounted: true edits the selection's link (⌘K, "Add link"); false
   * shows the read-only chip while one linked element is selected. Left out, mounting it means editing.
   */
  open?: boolean
  /** The chip's Edit button: the owner sets `open`. Without it the chip offers no Edit. */
  onEdit?(): void
}

/** Screen px between the selection box (handles included) and the popup. */
const CLEARANCE = 14
/** Height of the style bar row that rises above the tray, plus its gap. */
const STYLE_BAR_RESERVE = 56

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const selectionKey = (core: EditorCore): string =>
  core
    .selectedElements()
    .map((e) => e.id)
    .sort()
    .join(",")

const readPressing = () => canvasGesture.pressing

const viewportKey = (core: EditorCore): string => {
  const vp = core.appState.viewport
  return `${vp.zoom}:${vp.scrollX}:${vp.scrollY}`
}

const selectedKey = (core: EditorCore): string =>
  core
    .selectedElements()
    .map((e) => `${e.id}:${e.version}`)
    .sort()
    .join(",")

/** The editor follows the selection it opened on and where it sits on screen. */
export const linkEditorKey = (core: EditorCore): string => `${selectedKey(core)}|${viewportKey(core)}`

/**
 * The chip shows only for one linked element while nothing else is going on; anything else is one constant
 * key, so a drag or a pan without a linked selection never re-renders it.
 */
export const linkChipKey = (core: EditorCore): string => {
  const a = core.appState
  const ids = Object.keys(a.selectedElementIds)
  if (ids.length !== 1) return ""
  const busy =
    !!a.editingTextId ||
    !!a.editingLinearElementId ||
    !!a.croppingElementId ||
    a.viewMode ||
    !!core.presentation
  const sel = busy ? [] : core.selectedElements()
  const el = sel.length === 1 ? sel[0]! : null
  if (!el?.link) return ""
  return `${el.id}:${el.version}|${viewportKey(core)}`
}

const canvasOrigin = (): Point => {
  const rect = elementPicker.surface?.getBoundingClientRect()
  return rect ? [rect.left, rect.top] : [0, 0]
}

const selectionRect = (core: EditorCore, els: readonly NibElement[]): ClientRect | null => {
  if (els.length === 0) return null
  return sceneRectToClient(getCommonBounds(els), core.appState.viewport, canvasOrigin(), CLEARANCE)
}

/** Places a fixed box against the selection on every render: the board can pan or zoom under it. */
const usePlacement = (ref: RefObject<HTMLElement | null>, anchor: ClientRect | null, side: Side) => {
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    // the tray and the style bar above it own the bottom of the window; the popup flips up before it meets them
    const tray = Number.parseFloat(getComputedStyle(el).getPropertyValue("--tray-clearance")) || 88
    const p = computePlacement({
      anchor,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: {
        width: window.innerWidth,
        height: Math.max(window.innerHeight / 2, window.innerHeight - tray - STYLE_BAR_RESERVE),
      },
      side,
      align: "center",
      offset: 0,
    })
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
    el.dataset.side = p.side
    el.dataset.placed = ""
  })
}

/**
 * The selection's link: an editor (address field, link-to-element picker, apply, remove) when asked for,
 * and otherwise a quiet chip under a linked element (open, edit, remove) that never takes focus.
 */
export function LinkPopup({ core, onClose, onOpen, open, onEdit }: Props) {
  if (open ?? true) return <LinkEditor core={core} onClose={onClose} onOpen={onOpen} />
  return <LinkChip core={core} onOpen={onOpen} onEdit={onEdit} />
}

function LinkEditor({ core, onClose, onOpen }: Pick<Props, "core" | "onClose" | "onOpen">) {
  useCoreSelector(core, linkEditorKey)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const noteId = useId()
  const host = useLayerHost()
  const selected = core.selectedElements()
  const [forKey] = useState(() => selectionKey(core))
  const [value, setValue] = useState(() => selected[0]?.link ?? "")
  const [error, setError] = useState(false)
  const [picking, setPicking] = useState(false)
  const closed = useRef(false)
  const pickingRef = useRef(false)
  pickingRef.current = picking

  const close = () => {
    if (closed.current) return
    closed.current = true
    elementPicker.cancel()
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // the editor belongs to the elements it opened on; any other selection ends it
  const key = selectionKey(core)
  useEffect(() => {
    if (!forKey || key !== forKey) closeRef.current()
  }, [forKey, key])

  useEffect(() => () => elementPicker.cancel(), [])

  // presses on the board while picking are the pick, not a press outside
  const ignore = useMemo<readonly RefObject<HTMLElement | null>[]>(
    () => [
      {
        get current() {
          return pickingRef.current ? elementPicker.surface : null
        },
      },
    ],
    [],
  )

  const layer = useLayer({
    open: true,
    ref,
    initialFocus: inputRef,
    ignore,
    onDismiss: (reason: DismissReason) => {
      if (pickingRef.current && reason === "escape") {
        stopPicking()
        return
      }
      close()
    },
  })

  usePlacement(ref, selectionRect(core, selected), "bottom")

  useEffect(() => {
    if (picking) cancelRef.current?.focus({ preventScroll: true })
  }, [picking])

  const stopPicking = () => {
    elementPicker.cancel()
    setPicking(false)
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  const startPicking = () => {
    const own = new Set(core.selectedElements({ includeBoundText: true }).map((e) => e.id))
    setPicking(true)
    elementPicker.start({
      accepts: (el) => !own.has(el.id),
      onPick: (el) => {
        setPicking(false)
        if (core.setLink(elementLink(el.id))) close()
        else setError(true)
      },
    })
  }

  const apply = () => {
    if (value.trim() === "") {
      core.setLink(null)
      close()
      return
    }
    if (!core.setLink(value)) {
      setError(true)
      inputRef.current?.focus({ preventScroll: true })
      return
    }
    close()
  }

  if (selected.length === 0) return null
  const current = selected[0]!.link
  const normalized = value.trim() ? normalizeLink(value) : null
  const target =
    normalized && isElementLink(normalized) ? summarizeLink(normalized, (id) => core.scene.get(id)) : null
  const note = error
    ? "Enter a web address (https://…) or pick an element on the board"
    : target
      ? `Links to ${target.label}`
      : null

  const node = (
    <div
      ref={ref}
      className="sc-link-popup"
      data-mode="edit"
      role="dialog"
      aria-label="Link"
      tabIndex={-1}
      data-keeps-text-editing=""
      style={{ zIndex: layer.zIndex }}
    >
      {picking ? (
        <div className="sc-link-row">
          <span className="sc-link-glyph">{LinkIcons.target}</span>
          <span className="sc-link-hint" role="status">
            Click an element to link to it
          </span>
          <Button ref={cancelRef} onClick={stopPicking}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <form
            className="sc-link-row"
            onSubmit={(e) => {
              e.preventDefault()
              apply()
            }}
          >
            <span className="sc-link-glyph">{LinkIcons.link}</span>
            <input
              ref={inputRef}
              className="sc-link-input"
              aria-label="Link address"
              placeholder="Paste a link"
              value={value}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
              aria-invalid={error || undefined}
              aria-describedby={note ? noteId : undefined}
              onChange={(e) => {
                setValue(e.target.value)
                setError(false)
              }}
            />
            <IconButton size="s" label="Link to an element" icon={LinkIcons.target} onClick={startPicking} />
            <IconButton size="s" type="submit" label="Apply link" icon={LinkIcons.check} />
            {current ? (
              <IconButton
                size="s"
                label="Open link"
                icon={LinkIcons.open}
                onClick={() => {
                  if (followLink(core, current, onOpen) !== "refused") close()
                }}
              />
            ) : null}
            {current ? (
              <IconButton
                size="s"
                variant="danger"
                label="Remove link"
                icon={LinkIcons.unlink}
                onClick={() => {
                  core.setLink(null)
                  close()
                }}
              />
            ) : null}
          </form>
          {note ? (
            <p
              id={noteId}
              className="sc-link-note"
              data-tone={error ? "error" : undefined}
              role={error ? "alert" : undefined}
            >
              {note}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
  return host ? createPortal(node, host) : node
}

function LinkChip({ core, onOpen, onEdit }: Pick<Props, "core" | "onOpen" | "onEdit">) {
  useCoreSelector(core, linkChipKey)
  const ref = useRef<HTMLDivElement>(null)
  const host = useLayerHost()
  const picking = useElementPicking()
  const selected = core.selectedElements()
  const el = selected.length === 1 ? selected[0]! : null
  const a = core.appState
  const pressing = useSyncExternalStore(canvasGesture.subscribe, readPressing, readPressing)
  const busy =
    picking ||
    pressing ||
    !!a.editingTextId ||
    !!a.editingLinearElementId ||
    !!a.croppingElementId ||
    a.viewMode ||
    !!core.presentation
  const link = el && !busy ? el.link : null

  usePlacement(ref, link && el ? selectionRect(core, [el]) : null, "bottom")

  if (!link || !el) return null
  const summary = summarizeLink(link, (id) => core.scene.get(id))
  const node = (
    <div ref={ref} className="sc-link-popup" data-mode="read" role="group" aria-label="Link">
      <span className="sc-link-chip-glyph">
        {summary.kind === "element" ? LinkIcons.element : LinkIcons.link}
      </span>
      <button
        type="button"
        className="sc-link-label"
        title={summary.kind === "web" ? link : undefined}
        disabled={!summary.live}
        onClick={() => void followLink(core, link, onOpen)}
      >
        {summary.label}
      </button>
      <span className="sc-link-seam" aria-hidden="true" />
      <IconButton
        size="s"
        label={summary.kind === "element" ? "Go to linked element" : "Open link"}
        icon={LinkIcons.open}
        disabled={!summary.live}
        onClick={() => void followLink(core, link, onOpen)}
      />
      {onEdit ? <IconButton size="s" label="Edit link" icon={LinkIcons.edit} onClick={onEdit} /> : null}
      <IconButton
        size="s"
        variant="danger"
        label="Remove link"
        icon={LinkIcons.unlink}
        onClick={() => core.setLink(null)}
      />
    </div>
  )
  return host ? createPortal(node, host) : node
}
