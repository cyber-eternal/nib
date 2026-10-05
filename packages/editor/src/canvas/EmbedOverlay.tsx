import {
  type EditorCore,
  type NibElement,
  boundsIntersect,
  embedSource,
  expandBounds,
  getElementBounds,
  linkHost,
  sceneToScreen,
  visibleSceneBounds,
} from "@nib/core"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { useCoreSelector } from "../hooks/useEditor"
import { IconButton } from "../ui/primitives/IconButton"
import { isImeKey } from "../ui/primitives/ime"
import "./canvas.css"
import "./overlays.css"
import { embedState } from "./embedState"
import { LinkIcons } from "./icons"
import { embedFrameStyle } from "./overlayGeometry"

const windowSize = () =>
  typeof window === "undefined"
    ? { width: 1920, height: 1080 }
    : { width: window.innerWidth, height: window.innerHeight }

const readActive = () => embedState.active
const readEditing = () => embedState.editing
const readFocus = () => embedState.wantsFocus

const embedsOf = new WeakMap<readonly NibElement[], NibElement[]>()

const embeddables = (core: EditorCore): NibElement[] => {
  const els = core.scene.getNonDeleted()
  let hit = embedsOf.get(els)
  if (!hit) {
    hit = els.filter((el) => el.type === "embeddable")
    embedsOf.set(els, hit)
  }
  return hit
}

/**
 * Everything the overlay draws from the core, as one string: it re-renders when an embed, the sole
 * selection or (with embeds on the board) the viewport changes, not on every pointer frame.
 */
export const embedOverlayKey = (core: EditorCore): string => {
  const a = core.appState
  const embeds = embeddables(core)
  const sel = Object.keys(a.selectedElementIds)
  const sole = sel.length === 1 ? core.scene.get(sel[0]!) : undefined
  const soleEmbed = sole?.type === "embeddable" && !sole.isDeleted ? sole : null
  if (embeds.length === 0 && !soleEmbed) return ""
  const size = core.viewportSize
  const vp = a.viewport
  return [
    a.viewMode ? "view" : "edit",
    `${vp.zoom}:${vp.scrollX}:${vp.scrollY}`,
    size ? `${size.width}x${size.height}` : "",
    soleEmbed ? `${soleEmbed.id}:${soleEmbed.version}` : sel.length === 1 ? sel[0] : "",
    ...embeds.map((el) => `${el.id}:${el.version}`),
  ].join("|")
}

/** Sites in the sandbox may run scripts and open their own popups, nothing more. */
const SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"

/**
 * Live pages for embeds on allowlisted sites, laid over the board where the element is. A page
 * takes the pointer only once its embed is clicked again while selected (or in view mode), so selecting
 * and moving it works like any shape. An embed without a usable address shows an address field instead.
 */
export function EmbedOverlay({ core }: { core: EditorCore }) {
  useCoreSelector(core, embedOverlayKey)
  const active = useSyncExternalStore(embedState.subscribe, readActive, readActive)
  const editing = useSyncExternalStore(embedState.subscribe, readEditing, readEditing)
  const wantsFocus = useSyncExternalStore(embedState.subscribe, readFocus, readFocus)
  const a = core.appState
  // the canvas reports its size on its first frame, which does not re-render this overlay
  const size = core.viewportSize ?? windowSize()
  const sel = core.selectedElements()
  const sole = sel.length === 1 ? sel[0]! : null

  useEffect(() => {
    if (active && !a.viewMode && sole?.id !== active) embedState.activate(null)
    if (editing && sole?.id !== editing) embedState.endEdit()
  })

  // one screen beyond the edges, so a page panned briefly out of view is not reloaded on its way back
  const margin = Math.max(size.width, size.height) / a.viewport.zoom
  const visible = expandBounds(visibleSceneBounds(a.viewport, size.width, size.height), margin)
  const embeds = embeddables(core).filter((el) => boundsIntersect(getElementBounds(el), visible))

  const asking =
    sole?.type === "embeddable" &&
    !a.viewMode &&
    !sole.locked &&
    (editing === sole.id || !embedSource(sole.link ?? ""))

  return (
    <>
      <div className="sc-embeds">
        {embeds.map((el) => {
          const src = el.link ? embedSource(el.link) : null
          if (!src) return null
          const live = a.viewMode || active === el.id
          return (
            <div
              key={el.id}
              className="sc-embed"
              data-active={live || undefined}
              style={{ ...embedFrameStyle(el, a.viewport), opacity: el.opacity / 100 }}
            >
              <iframe
                src={src}
                title={`Embedded page from ${linkHost(el.link ?? "") ?? "the web"}`}
                sandbox={SANDBOX}
                allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
                tabIndex={live ? 0 : -1}
              />
            </div>
          )
        })}
      </div>
      {asking && sole ? (
        <EmbedAddressField key={sole.id} core={core} el={sole} focus={wantsFocus && editing === sole.id} />
      ) : null}
    </>
  )
}

function EmbedAddressField({ core, el, focus }: { core: EditorCore; el: NibElement; focus: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const noteId = useId()
  const [value, setValue] = useState(el.link ?? "")
  const [error, setError] = useState(() => !!el.link && !embedSource(el.link))

  useEffect(() => {
    if (!focus) return
    ref.current?.focus({ preventScroll: true })
    ref.current?.select()
    embedState.focused()
  }, [focus])

  const b = getElementBounds(el)
  const [cx, cy] = sceneToScreen([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], core.appState.viewport)

  return (
    <form
      className="sc-embed-field"
      style={{ left: cx, top: cy }}
      data-keeps-text-editing=""
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) embedState.endEdit(el.id)
      }}
      onSubmit={(e) => {
        e.preventDefault()
        if (core.setEmbeddableLink(el.id, value)) {
          setError(false)
          embedState.endEdit(el.id)
          ref.current?.blur()
        } else setError(true)
      }}
    >
      <div className="sc-link-row">
        <span className="sc-link-glyph">{LinkIcons.link}</span>
        <input
          ref={ref}
          className="sc-link-input"
          aria-label="Embed address"
          placeholder="Paste a YouTube, Figma, Loom… link"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          aria-invalid={error || undefined}
          aria-describedby={error ? noteId : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setError(false)
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || isImeKey(e)) return
            e.preventDefault()
            e.stopPropagation()
            embedState.endEdit(el.id)
            ref.current?.blur()
          }}
        />
        <IconButton size="s" type="submit" label="Embed this page" icon={LinkIcons.check} />
      </div>
      {error ? (
        <p id={noteId} className="sc-link-note" data-tone="error" role="alert">
          Not an embeddable address. YouTube, Vimeo, Figma, Loom, gists, CodePen, CodeSandbox, StackBlitz and
          Spotify links work.
        </p>
      ) : null}
    </form>
  )
}
