import { type EditorCore, FRAME_LABEL_FONT } from "@nib/core"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import "./canvas.css"
import { useCoreVersion } from "../hooks/useEditor"
import { frameNameBox, inflateBox, overlayBoxStyle } from "./overlayGeometry"

interface Props {
  core: EditorCore
  /** The frame being renamed; pass the same id to CanvasHost's renamingFrameId so the drawn name hides. */
  frameId: string
  onClose(): void
}

/** Screen px of breathing room the field gets around the drawn name. */
const FIELD_INSET = 4

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/** Renames a frame in place, on its drawn name. Enter or leaving saves, Escape cancels. */
export function FrameNameOverlay({ core, frameId, onClose }: Props) {
  useCoreVersion(core)
  const frame = core.scene.get(frameId)
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(() =>
    frame?.type === "frame" && typeof frame.name === "string" ? frame.name : "",
  )
  const done = useRef(false)

  useIsoLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus({ preventScroll: true })
    node.select()
  }, [])

  const live = frame && frame.type === "frame" && !frame.isDeleted ? frame : null

  useEffect(() => {
    if (!live && !done.current) {
      done.current = true
      onClose()
    }
  })

  if (!live) return null

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) core.setFrameName(live.id, value)
    onClose()
  }

  return (
    <input
      ref={ref}
      className="sc-frame-name"
      aria-label="Frame name"
      value={value}
      placeholder="Frame"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === "Enter") {
          e.preventDefault()
          finish(true)
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        ...overlayBoxStyle(inflateBox(frameNameBox(live, core.appState.viewport), FIELD_INSET)),
        font: FRAME_LABEL_FONT,
      }}
    />
  )
}
