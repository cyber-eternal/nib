import {
  type CanvasPalette,
  type EditorCore,
  FONT_STACKS,
  type NibElement,
  type TextElement,
  canvasBackground,
  defaultCanvasPalette,
  displayTextColor,
  surfaceLookup,
} from "@nib/core"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useCoreSelector } from "../hooks/useEditor"
import { isAnyLayerOpen } from "../hooks/useLayer"
import "./canvas.css"
import { overlayBoxStyle, textOverlayBox } from "./overlayGeometry"

interface Props {
  core: EditorCore
  /** Kept for callers that re-render the overlay on every core change; it subscribes itself now. */
  version?: number
  /** The theme's canvas colours, so the typed text matches the drawn text on dark boards. */
  palette?: CanvasPalette
}

/** Focus moving into these (the style bar and its popovers) keeps the text editor open. */
export const KEEPS_TEXT_EDITING = "[data-keeps-text-editing]"

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/**
 * What the editor is drawn from: the edited text, its container, the viewport and the theme. Nothing at
 * all while no text is being edited, so pointer frames never re-render it.
 */
export const textEditorKey = (core: EditorCore): string => {
  const a = core.appState
  const id = a.editingTextId
  if (!id) return ""
  const text = core.scene.get(id)
  const container = text?.type === "text" && text.containerId ? core.scene.get(text.containerId) : undefined
  const vp = a.viewport
  return `${id}:${text?.version}:${container?.version}|${vp.zoom}:${vp.scrollX}:${vp.scrollY}|${a.theme}:${a.viewBackgroundColor}`
}

/**
 * A textarea floated over the canvas at the element's exact position and scale,
 * so what is typed lines up with what the renderer will draw.
 */
export function TextEditorOverlay({ core, palette }: Props) {
  useCoreSelector(core, textEditorKey)
  const id = core.appState.editingTextId
  const element = id ? core.scene.get(id) : undefined
  if (!element || element.type !== "text" || element.isDeleted) return null
  const container = element.containerId ? (core.scene.get(element.containerId) ?? null) : null
  // keyed by element: a new edit starts from that element's own text, never the previous draft
  return <TextEditor key={element.id} core={core} text={element} container={container} palette={palette} />
}

interface EditorProps {
  core: EditorCore
  text: TextElement
  container: NibElement | null
  palette?: CanvasPalette
}

function TextEditor({ core, text, container, palette }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(() => text.originalText)
  const done = useRef(false)
  const composing = useRef(false)

  // mount only: the press that opened the editor was preventDefault-ed, so focus stays here
  useIsoLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus({ preventScroll: true })
    const end = node.value.length
    node.setSelectionRange(end, end)
    // a draft from the start lets a canvas press commit this text instead of the editor losing it
    core.previewText(node.value)
  }, [])

  const box = textOverlayBox(text, container, core.appState.viewport)

  // when the browser wraps a line the renderer kept whole, grow rather than scroll the first line away
  useIsoLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.scrollTop = 0
    node.scrollLeft = 0
    node.style.height = `${box.height}px`
    if (node.scrollHeight > node.clientHeight + 1) node.style.height = `${node.scrollHeight}px`
  })

  const commit = () => {
    if (done.current) return
    done.current = true
    // the core may already have committed this edit itself (a canvas press commits the draft)
    if (core.appState.editingTextId !== text.id) return
    core.commitText(text.id, ref.current?.value ?? value)
  }

  const zoom = core.appState.viewport.zoom
  const theme = core.appState.theme
  const canvasPalette = palette ?? defaultCanvasPalette(theme)
  const surface = canvasBackground(core.appState.viewBackgroundColor, theme, canvasPalette)

  return (
    <textarea
      ref={ref}
      className="sc-text-editor"
      data-text-editor=""
      data-testid="text-editor"
      aria-label={container ? "Label text" : "Text"}
      value={value}
      rows={1}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      wrap={box.wrap ? "soft" : "off"}
      onChange={(e) => {
        setValue(e.target.value)
        core.previewText(e.target.value)
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        core.previewText(e.currentTarget.value)
      }}
      onBlur={(e) => {
        // a blur mid-composition belongs to the IME; switching windows is not leaving the text
        if (composing.current) return
        if (typeof document !== "undefined" && !document.hasFocus()) return
        const next = e.relatedTarget as Element | null
        if (next?.closest?.(KEEPS_TEXT_EDITING)) return
        commit()
      }}
      onKeyDown={(e) => {
        // Escape and ⌘Enter confirm the IME's candidate while composing, not the text
        if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return
        // a popover opened from the style bar is the top layer: its Escape closes it, not the editor
        if (e.key === "Escape" && isAnyLayerOpen()) return
        // Escape finishes editing and keeps what was typed; an empty value
        // removes the element, so nothing is silently lost either way
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          e.stopPropagation()
          commit()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        ...overlayBoxStyle(box),
        // longhands: React rewrites a changed `font` shorthand alone, which resets line-height
        fontFamily: FONT_STACKS[text.fontFamily] ?? FONT_STACKS.hand,
        fontSize: `${text.fontSize * zoom}px`,
        fontStyle: "normal",
        fontWeight: "normal",
        lineHeight: String(text.lineHeight),
        color: displayTextColor(text, {
          theme,
          palette: canvasPalette,
          surface,
          // the canvas reads the text against the solid box under it, not the board
          surfaceUnder: surfaceLookup(core.scene.getNonDeleted(), theme, canvasPalette.board, surface),
          getElement: (id) => core.scene.get(id),
        }),
        textAlign: text.textAlign,
        whiteSpace: box.wrap ? "pre-wrap" : "pre",
        opacity: text.opacity / 100,
      }}
    />
  )
}
