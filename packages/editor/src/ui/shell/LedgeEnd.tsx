import { type EditorCore, KEY_ZOOM_STEP, type Point } from "@nib/core"
import { memo, useRef } from "react"
import { shallowEqual, useCoreSelector } from "../../hooks/useEditor"
import { IconButton, Toolbar, Tooltip } from "../primitives"
import { ShellIcons } from "./icons"
import { useMeasuredVar } from "./useMeasuredVar"
import "./shell.css"

// the buttons step as far as ⌘= and ⌘- do
export const ZOOM_STEP = KEY_ZOOM_STEP

export interface LedgeEndProps {
  core: EditorCore
  /** Zoom to fit, leaving room for the chrome; defaults to core.zoomToFit over the viewport. */
  onZoomFit?(): void
}

const centreOf = (core: EditorCore): Point => {
  const s = core.viewportSize ?? { width: 0, height: 0 }
  return [s.width / 2, s.height / 2]
}

/** Bottom-left: undo, redo and zoom, as the end of the tray's ledge. */
export const LedgeEnd = memo(function LedgeEnd({ core, onZoomFit }: LedgeEndProps) {
  const ref = useRef<HTMLDivElement>(null)
  useMeasuredVar(ref, "--ledge-w")
  const [canUndo, canRedo, percent, viewMode] = useCoreSelector(
    core,
    (c) =>
      [
        c.history.canUndo(),
        c.history.canRedo(),
        Math.round(c.appState.viewport.zoom * 100),
        c.appState.viewMode,
      ] as const,
    shallowEqual,
  )
  const zoomBy = (factor: number) => core.zoomTo(core.appState.viewport.zoom * factor, centreOf(core))
  const fit = () => {
    if (onZoomFit) onZoomFit()
    else if (core.viewportSize) core.zoomToFit(core.viewportSize.width, core.viewportSize.height)
  }

  return (
    <div ref={ref} className="shell-ledge" data-zone="bottom">
      <Toolbar label="History and zoom" className="shell-ledge-toolbar">
        {viewMode ? null : (
          <>
            <IconButton
              label="Undo"
              shortcut="Mod+Z"
              icon={ShellIcons.undo}
              data-testid="undo"
              disabled={!canUndo}
              onClick={() => core.undo()}
            />
            <IconButton
              label="Redo"
              shortcut="Mod+Shift+Z"
              icon={ShellIcons.redo}
              data-testid="redo"
              disabled={!canRedo}
              onClick={() => core.redo()}
            />
            <span className="shell-seam" aria-hidden="true" />
          </>
        )}
        <IconButton
          label="Zoom out"
          shortcut="Mod+-"
          icon={ShellIcons.minus}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        />
        <Tooltip label="Reset zoom" shortcut="Mod+0">
          <button
            type="button"
            className="shell-zoom-level"
            aria-label={`Zoom ${percent}%, reset to 100%`}
            data-testid="zoom-level"
            onClick={() => core.zoomTo(1, centreOf(core))}
          >
            {percent}%
          </button>
        </Tooltip>
        <IconButton
          label="Zoom in"
          shortcut="Mod+="
          icon={ShellIcons.plus}
          onClick={() => zoomBy(ZOOM_STEP)}
        />
        <IconButton label="Zoom to fit" shortcut="Shift+1" icon={ShellIcons.fit} onClick={fit} />
      </Toolbar>
    </div>
  )
})
