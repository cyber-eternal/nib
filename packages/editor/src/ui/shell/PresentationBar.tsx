import type { EditorCore } from "@nib/core"
import { memo } from "react"
import { shallowEqual, useCoreSelector } from "../../hooks/useEditor"
import { Button, IconButton, Toolbar } from "../primitives"
import { ShellIcons } from "./icons"
import "./shell.css"

export interface SlideInfo {
  index: number
  count: number
  name: string
  laser: boolean
}

export const slideInfo = (core: EditorCore): SlideInfo | null => {
  const p = core.presentation
  if (!p) return null
  const frame = core.scene.get(p.frameIds[p.index] ?? "")
  const name = frame && frame.type === "frame" && frame.name ? frame.name : `Frame ${p.index + 1}`
  return { index: p.index, count: p.frameIds.length, name, laser: core.appState.activeTool === "laser" }
}

/** While frames play as slides the chrome is gone; this small bar walks them and holds the laser. */
export const PresentationBar = memo(function PresentationBar({ core }: { core: EditorCore }) {
  const info = useCoreSelector(core, slideInfo, shallowEqual)
  if (!info) return null
  const { index, count, name, laser } = info
  return (
    <div className="shell-present" data-zone="bottom">
      <Toolbar label="Presentation" className="shell-present-toolbar">
        <IconButton
          label="Previous slide"
          shortcut="ArrowLeft"
          icon={ShellIcons.chevronLeft}
          disabled={index === 0}
          onClick={() => core.previousSlide()}
        />
        <span className="shell-present-count" aria-live="polite">
          <span className="shell-present-num">
            {index + 1} / {count}
          </span>
          <span className="shell-present-name">{name}</span>
        </span>
        <IconButton
          label="Next slide"
          shortcut="ArrowRight"
          icon={ShellIcons.chevronRight}
          disabled={index >= count - 1}
          onClick={() => core.nextSlide()}
        />
        <span className="shell-seam" aria-hidden="true" />
        <IconButton
          label="Laser pointer"
          shortcut="K"
          icon={ShellIcons.laser}
          pressed={laser}
          onClick={() => core.setTool(laser ? "selection" : "laser")}
        />
        <Button icon={ShellIcons.stop} onClick={() => core.stopPresentation()}>
          End show
        </Button>
      </Toolbar>
    </div>
  )
})
