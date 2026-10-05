import { Fragment, type KeyboardEvent, useMemo, useRef, useState } from "react"
import { isMacPlatform } from "../hooks/useShortcuts"
import { buildHelpGroups, displayKeys, filterHelpGroups, showsPencilNote } from "./panels/helpModel"
import { PanelIcons } from "./panels/icons"
import { Dialog } from "./primitives/Dialog"
import "./panels/panels.css"

export interface HelpDialogProps {
  onClose(): void
  /** Defaults to true, so the shell can mount it only while it is open. */
  open?: boolean
  /** Overrides platform detection (tests, screenshots). */
  isMac?: boolean
}

const Keys = ({ keys, isMac }: { keys: readonly string[]; isMac: boolean }) => {
  const shown = displayKeys(keys, isMac)
  return (
    <>
      {shown.map((k, i) => (
        <Fragment key={k}>
          {i > 0 ? <span className="sc-help-or">or</span> : null}
          <kbd className="sc-kbd">{k}</kbd>
        </Fragment>
      ))}
    </>
  )
}

const PAGE_KEYS = new Set(["PageUp", "PageDown"])

/** PageUp and PageDown from the search field scroll the list: a one-line field has no use for them. */
const pageList = (e: KeyboardEvent<HTMLInputElement>) => {
  if (!PAGE_KEYS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
  const body = e.currentTarget.closest(".sc-dialog")?.querySelector<HTMLElement>(".sc-dialog-body")
  if (!body) return
  e.preventDefault()
  body.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * body.clientHeight * 0.9 })
}

/** The shortcut sheet, generated from core SHORTCUTS and searchable by name or key. */
export function HelpDialog({ onClose, open = true, isMac }: HelpDialogProps) {
  const mac = isMac ?? isMacPlatform()
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const groups = useMemo(() => buildHelpGroups(), [])
  const shown = useMemo(() => filterHelpGroups(groups, query, mac), [groups, query, mac])
  const pencil = showsPencilNote(query)
  const count = shown.reduce((n, g) => n + g.rows.length, 0)
  const undo = displayKeys(["Mod+Z"], mac)[0]
  const keep = displayKeys(["Alt"], mac)[0]

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="l"
      className="sc-panel-dialog sc-help"
      initialFocus={search}
      // the search stays above the list, which is its own tab stop so the keyboard can scroll it
      bodyLabel="Shortcuts"
      tools={
        <label className="sc-search-field">
          {PanelIcons.search}
          <span className="sc-visually-hidden">Search shortcuts</span>
          <input
            ref={search}
            type="search"
            className="sc-input"
            placeholder="Search by action or key, like “undo” or “P”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={pageList}
            aria-controls="sc-help-results"
          />
        </label>
      }
    >
      <div data-testid="help-dialog">
        {pencil ? (
          <section className="sc-help-pencil" aria-labelledby="sc-help-pencil-title">
            {PanelIcons.pencil}
            <h3 id="sc-help-pencil-title">
              The pencil tidies your shapes <kbd className="sc-kbd">P</kbd>
            </h3>
            <p>
              Draw a circle, box, triangle, diamond, line or arrow by hand. When you lift the pencil, Nib
              swaps the stroke for a clean shape you can keep editing, and arrows attach to what they touch.
              Press <kbd className="sc-kbd">{undo}</kbd> to get your original stroke back, or hold{" "}
              <kbd className="sc-kbd">{keep}</kbd> as you lift to keep it hand-drawn. The pen{" "}
              <kbd className="sc-kbd">7</kbd> keeps every stroke exactly as drawn.
            </p>
          </section>
        ) : null}

        <p className="sc-visually-hidden" role="status">
          {query.trim() ? (count === 1 ? "1 shortcut" : `${count} shortcuts`) : ""}
        </p>

        <div id="sc-help-results" className="sc-help-columns">
          {shown.length === 0 ? (
            <p className="sc-help-empty">No shortcut matches “{query.trim()}”.</p>
          ) : (
            shown.map((group) => (
              <section className="sc-help-group" key={group.id} aria-labelledby={`sc-help-${group.id}`}>
                <h3 id={`sc-help-${group.id}`}>{group.title}</h3>
                <dl className="sc-help-list">
                  {group.rows.map((row) => (
                    <div className="sc-help-row" key={row.id}>
                      <dt>
                        {row.label}
                        {row.note ? <small>{row.note}</small> : null}
                      </dt>
                      <dd>
                        <Keys keys={row.keys} isMac={mac} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))
          )}
        </div>
      </div>
    </Dialog>
  )
}
