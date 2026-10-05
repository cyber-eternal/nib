import type { EditorCore } from "@nib/core"
import { useCallback, useSyncExternalStore } from "react"
import type { DismissReason } from "../../hooks/useLayer"
import type { ThemeDef } from "../../theme/themes"
import { Popover, type PopoverAnchor } from "../primitives"
import { ColorPanel } from "./ColorPanel"
import "./StyleBar.css"

export interface CanvasBackgroundPickerProps {
  core: EditorCore
  theme: ThemeDef
}

const useBackground = (core: EditorCore): string => {
  const subscribe = useCallback((cb: () => void) => core.subscribe(cb), [core])
  const read = () => core.appState.viewBackgroundColor
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * The document's canvas colour: the theme's board by default, a palette, recent
 * picks and a hex field. Each pick is one undoable step through core.setViewBackgroundColor.
 */
export const CanvasBackgroundPicker = ({ core, theme }: CanvasBackgroundPickerProps) => {
  const current = useBackground(core)
  return (
    <ColorPanel
      target="canvas"
      label="Canvas"
      theme={theme}
      current={current}
      onPick={(c) => core.setViewBackgroundColor(c)}
    />
  )
}

export interface CanvasBackgroundPopoverProps extends CanvasBackgroundPickerProps {
  open: boolean
  onClose: (reason?: DismissReason) => void
  anchor: PopoverAnchor
  side?: "top" | "bottom" | "left" | "right"
}

/** The picker in its own popover, for a "Canvas background…" menu entry. */
export const CanvasBackgroundPopover = ({
  core,
  theme,
  open,
  onClose,
  anchor,
  side = "bottom",
}: CanvasBackgroundPopoverProps) => (
  <Popover
    open={open}
    onClose={onClose}
    anchor={anchor}
    side={side}
    align="start"
    label="Canvas background"
    className="sc-style-pop"
    initialFocus="first"
  >
    <div className="sc-style-pop-body">
      <CanvasBackgroundPicker core={core} theme={theme} />
    </div>
  </Popover>
)
