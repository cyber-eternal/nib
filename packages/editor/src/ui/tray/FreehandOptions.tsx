import type { EditorCore } from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"
import type { RefObject } from "react"
import type { DismissReason } from "../../hooks/useLayer"
import { formatChord, isMacPlatform } from "../../hooks/useShortcuts"
import { Popover } from "../primitives/Popover"
import { Switch } from "../primitives/Switch"
import { armFreehand, correctionTool, writePencilDefault } from "./trayModel"

export interface CorrectShapesSwitchProps {
  core: EditorCore
  prefs: PlatformPrefs
  /** Whether the pencil is the held marker. */
  checked: boolean
}

/** "Correct shapes": swaps the pen for the pencil (and back) and remembers the choice. */
export const CorrectShapesSwitch = ({ core, prefs, checked }: CorrectShapesSwitchProps) => (
  <Switch
    label="Correct shapes"
    checked={checked}
    onChange={(on) => {
      writePencilDefault(prefs, on)
      // the switch belongs to the pen, so the pen stays the held marker either way
      armFreehand(core, correctionTool(on), true)
    }}
  />
)

export interface FreehandOptionsProps extends CorrectShapesSwitchProps {
  open: boolean
  onClose: (reason: DismissReason) => void
  anchor: RefObject<HTMLElement | null>
  /** Presses on these neither dismiss nor count as outside (the other freehand marker). */
  ignore?: readonly RefObject<HTMLElement | null>[]
  id?: string
  /** Names the held marker's options; defaults to the pencil's when checked, else the pen's. */
  label?: string
}

/** Rises from the held pen or pencil on a second click. */
export const FreehandOptions = ({
  open,
  onClose,
  anchor,
  ignore,
  id,
  core,
  prefs,
  checked,
  label,
}: FreehandOptionsProps) => (
  <Popover
    open={open}
    onClose={onClose}
    anchor={anchor}
    ignore={ignore}
    side="top"
    offset={12}
    label={label ?? (checked ? "Pencil options" : "Pen options")}
    id={id}
    initialFocus="first"
  >
    <div className="tray-pen-options">
      <CorrectShapesSwitch core={core} prefs={prefs} checked={checked} />
      <p className="tray-pen-hint">
        Rough circles, boxes, triangles, diamonds, lines and arrows become clean shapes when you lift the
        pencil. {formatChord("Mod+Z", isMacPlatform())} brings your stroke back.
      </p>
    </div>
  </Popover>
)
