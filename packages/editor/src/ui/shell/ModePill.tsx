import { Button, Kbd } from "../primitives"
import { ShellIcons } from "./icons"
import "./shell.css"

export interface ModePillProps {
  mode: "zen" | "view"
  onExit(): void
}

/** Top-centre reminder of a mode that hides or locks things, with its way out always on screen. */
export function ModePill({ mode, onExit }: ModePillProps) {
  const zen = mode === "zen"
  return (
    <div className="shell-mode" data-mode={mode}>
      <span className="shell-mode-icon" aria-hidden="true">
        {zen ? ShellIcons.zen : ShellIcons.eye}
      </span>
      <span className="shell-mode-text">{zen ? "Zen mode" : "View mode · read-only"}</span>
      <Button className="shell-mode-exit" onClick={onExit} aria-keyshortcuts={zen ? "Alt+Z" : "Alt+R"}>
        {zen ? "Exit zen" : "Edit"}
        <Kbd chord={zen ? "Alt+Z" : "Alt+R"} plain decorative />
      </Button>
    </div>
  )
}
