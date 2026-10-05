import { Fragment, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import { isMacPlatform } from "../hooks/useShortcuts"
import { type Command, commandShortcut, paletteSections } from "./panels/commandModel"
import { PanelIcons } from "./panels/icons"
import { Dialog } from "./primitives/Dialog"
import { Kbd } from "./primitives/Kbd"
import { isImeKey } from "./primitives/ime"
import { moveIndex } from "./primitives/menuNav"
import "./panels/panels.css"

export type { Command } from "./panels/commandModel"

export interface CommandPaletteProps {
  commands: Command[]
  onClose(): void
  /** Defaults to true, so the shell can mount it only while it is open. */
  open?: boolean
  isMac?: boolean
}

/** ⌘/ : every command with its shortcut, grouped until you type, ranked once you do. */
export function CommandPalette({ commands, onClose, open = true, isMac }: CommandPaletteProps) {
  const mac = isMac ?? isMacPlatform()
  const [query, setQuery] = useState("")
  const sections = useMemo(() => paletteSections(commands, query), [commands, query])
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const disabled = useMemo(() => flat.map((c) => !!c.disabled), [flat])
  const [chosen, setActive] = useState(0)
  const active = chosen < flat.length && !disabled[chosen] ? chosen : moveIndex(disabled, -1, "first")
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (i: number) => `${baseId}-opt-${i}`

  // a new query starts again at the best match
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the query on purpose
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  const run = (cmd: Command | undefined) => {
    if (!cmd || cmd.disabled) return
    onClose()
    cmd.run()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e)) return
    const step = (move: "next" | "prev") => {
      e.preventDefault()
      setActive(moveIndex(disabled, active, move))
    }
    if (e.key === "ArrowDown") step("next")
    else if (e.key === "ArrowUp") step("prev")
    else if (e.key === "Enter") {
      e.preventDefault()
      run(flat[active])
    }
  }

  let index = -1
  const option = (cmd: Command, showGroup: boolean) => {
    index++
    const i = index
    const shortcut = commandShortcut(cmd)
    return (
      <div
        key={cmd.id}
        id={optionId(i)}
        role="option"
        tabIndex={-1}
        aria-selected={i === active}
        aria-disabled={cmd.disabled || undefined}
        data-index={i}
        className="sc-palette-option"
        onPointerMove={() => {
          if (!cmd.disabled && i !== active) setActive(i)
        }}
        onPointerDown={(e) => e.preventDefault()}
        onPointerUp={(e) => {
          if (e.button === 0) run(cmd)
        }}
      >
        <span className="sc-palette-label">
          {cmd.label}
          {showGroup && cmd.group ? <small>{cmd.group}</small> : null}
        </span>
        {shortcut ? <Kbd chord={shortcut} isMac={mac} /> : null}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Command palette"
      hideTitle
      closeLabel={null}
      className="sc-panel-dialog sc-palette"
      initialFocus={input}
    >
      <div className="sc-palette-input-wrap" data-testid="command-palette">
        {PanelIcons.search}
        <input
          ref={input}
          className="sc-palette-input"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length > 0 && active >= 0 ? optionId(active) : undefined}
          placeholder="Type a command, like “zoom” or “pencil”"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Commands"
        tabIndex={-1}
        className="sc-palette-list"
      >
        {flat.length === 0 ? (
          <p className="sc-palette-empty">
            {query.trim() ? `No command matches “${query.trim()}”.` : "No commands available."}
          </p>
        ) : (
          sections.map((s, gi) =>
            s.group ? (
              <div key={s.group} role="group" aria-labelledby={`${baseId}-group-${gi}`}>
                <div id={`${baseId}-group-${gi}`} role="presentation" className="sc-palette-group-label">
                  {s.group}
                </div>
                {s.items.map((cmd) => option(cmd, false))}
              </div>
            ) : (
              <Fragment key="ranked">{s.items.map((cmd) => option(cmd, true))}</Fragment>
            ),
          )
        )}
      </div>
      <div className="sc-palette-foot" aria-hidden="true">
        <span>
          <kbd className="sc-kbd">↑</kbd>
          <kbd className="sc-kbd">↓</kbd> to move
        </span>
        <span>
          <Kbd chord="Enter" isMac={mac} /> to run
        </span>
        <span>
          <Kbd chord="Escape" isMac={mac} /> to close
        </span>
      </div>
    </Dialog>
  )
}
