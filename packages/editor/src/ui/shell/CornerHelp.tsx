import type { EditorCore } from "@nib/core"
import { memo, useRef } from "react"
import { useCoreSelector } from "../../hooks/useEditor"
import { Button, IconButton } from "../primitives"
import { ShellIcons } from "./icons"
import { useMeasuredVar } from "./useMeasuredVar"
import { contentOffscreen } from "./viewport"
import "./shell.css"

export interface CornerHelpProps {
  core: EditorCore
  onHelp(): void
  onBackToContent(): void
}

/** Bottom-right: the shortcut sheet, and a way home when everything drawn is off-screen. */
export const CornerHelp = memo(function CornerHelp({ core, onHelp, onBackToContent }: CornerHelpProps) {
  const offscreen = useCoreSelector(core, contentOffscreen)
  const help = useRef<HTMLDivElement>(null)
  useMeasuredVar(help, "--corner-w")
  return (
    <div className="shell-corner" data-zone="bottom">
      {offscreen ? (
        <Button
          className="shell-pill"
          icon={ShellIcons.locate}
          data-testid="scroll-back"
          onClick={onBackToContent}
        >
          Back to content
        </Button>
      ) : null}
      <div ref={help} className="shell-corner-help">
        <IconButton label="Keyboard shortcuts" shortcut="?" icon={ShellIcons.help} onClick={onHelp} />
      </div>
    </div>
  )
})
