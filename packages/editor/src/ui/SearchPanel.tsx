import type { EditorCore, NibElement } from "@nib/core"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { useCoreSelector } from "../hooks/useEditor"
import { SideSheet } from "./panels/SideSheet"
import { PanelIcons } from "./panels/icons"
import {
  type SearchMatch,
  findMatches,
  matchCountLabel,
  matchIds,
  snippetOf,
  stepMatch,
} from "./panels/searchModel"
import { sheetBox, unmountedByShow } from "./panels/sheetParking"
import { elementTypeLabel } from "./panels/statsModel"
import { IconButton } from "./primitives/IconButton"
import { isImeKey } from "./primitives/ime"

export interface SearchPanelProps {
  core: EditorCore
  /** The canvas size; defaults to the core's viewport size. */
  size?: { width: number; height: number }
  onClose(): void
  /** Every match, for CanvasHost.searchMatches to highlight; [] when the panel closes. */
  onMatchesChange?(ids: string[]): void
  /** The match the user is on, drawn more strongly (InteractiveSceneInput.activeSearchMatch). */
  onActiveMatchChange?(id: string | null): void
}

const MAX_RESULTS = 200

interface ParkedSearch {
  query: string
  active: number
}

const parkedSearch = (core: EditorCore) => sheetBox<ParkedSearch | null>(core, "search", () => null)

const searched = new WeakMap<readonly NibElement[], { query: string; matches: SearchMatch[] }>()

/** findMatches, once per scene change and query: pans and selection changes reuse the last result. */
const matchesIn = (core: EditorCore, query: string): SearchMatch[] => {
  const els = core.scene.getNonDeleted()
  const hit = searched.get(els)
  if (hit && hit.query === query) return hit.matches
  const matches = findMatches(els, query)
  searched.set(els, { query, matches })
  return matches
}

/** Equal when the list would render the same rows, so a drag that moves no match re-renders nothing. */
export const sameMatches = (a: readonly SearchMatch[], b: readonly SearchMatch[]): boolean =>
  a === b ||
  (a.length === b.length &&
    a.every((m, i) => {
      const n = b[i]!
      return (
        m.id === n.id && m.targetId === n.targetId && m.kind === n.kind && m.text === n.text && m.at === n.at
      )
    }))

const kindIcon = (m: SearchMatch) =>
  m.kind === "frame" ? PanelIcons.frame : m.kind === "label" ? PanelIcons.label : PanelIcons.text

/** ⌘F: finds text, labels and frame names; every match lights up on the canvas, Enter walks them. */
export function SearchPanel({ core, size, onClose, onMatchesChange, onActiveMatchChange }: SearchPanelProps) {
  const [query, setQuery] = useState(() => parkedSearch(core).current?.query ?? "")
  const [chosen, setActive] = useState(() => parkedSearch(core).current?.active ?? -1)
  const input = useRef<HTMLInputElement>(null)
  const baseId = useId()
  const listId = `${baseId}-results`
  const optionId = (i: number) => `${baseId}-match-${i}`

  // up to 200 rows: they re-render when the matches change, not on every pointer frame
  const matches = useCoreSelector(core, (c) => matchesIn(c, query), sameMatches)
  const active = chosen < matches.length ? chosen : -1
  const activeId = active >= 0 ? matches[active]!.id : null

  const callbacks = useRef({ onMatchesChange, onActiveMatchChange })
  callbacks.current = { onMatchesChange, onActiveMatchChange }

  const idsKey = matchIds(matches).join("\n")
  useEffect(() => {
    callbacks.current.onMatchesChange?.(idsKey ? idsKey.split("\n") : [])
  }, [idsKey])
  useEffect(() => {
    callbacks.current.onActiveMatchChange?.(activeId)
  }, [activeId])
  const kept = useRef<ParkedSearch>({ query, active: chosen })
  kept.current = { query, active: chosen }
  useEffect(() => {
    const parked = parkedSearch(core)
    parked.current = null
    return () => {
      callbacks.current.onMatchesChange?.([])
      callbacks.current.onActiveMatchChange?.(null)
      if (unmountedByShow(core)) parked.current = kept.current
    }
  }, [core])

  // a new query starts before the first match, so the first Enter lands on it
  const searchedFor = useRef(query)
  useEffect(() => {
    if (searchedFor.current === query) return
    searchedFor.current = query
    setActive(-1)
  }, [query])

  const goTo = (i: number) => {
    const m = matches[i]
    if (!m) return
    setActive(i)
    const target = core.scene.get(m.targetId) ?? core.scene.get(m.id)
    if (!target) return
    const known = size && size.width > 0 && size.height > 0 ? size : core.viewportSize
    const vw = known?.width || window.innerWidth
    const vh = known?.height || window.innerHeight
    // centre it in the canvas left of the sheet, not behind it
    const sheet = input.current?.closest(".sc-sheet")?.getBoundingClientRect()
    const visible = sheet && sheet.left > vw * 0.4 ? sheet.left : vw
    core.scrollToElement(target, visible, vh)
    core.selectElements([target.id])
    document.getElementById(optionId(i))?.scrollIntoView({ block: "nearest" })
  }

  const step = (direction: 1 | -1) => goTo(stepMatch(active, matches.length, direction))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e)) return
    if (e.key === "Enter") {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      step(e.key === "ArrowDown" ? 1 : -1)
    }
  }

  const q = query.trim()
  const shown = matches.slice(0, MAX_RESULTS)

  return (
    <SideSheet
      title="Find on canvas"
      closeLabel="Close search"
      onClose={onClose}
      initialFocus={input}
      className="sc-search"
      data-testid="search-panel"
    >
      <div className="sc-search-bar">
        <label className="sc-search-field">
          {PanelIcons.search}
          <span className="sc-visually-hidden">Search text, labels and frame names</span>
          <input
            ref={input}
            type="search"
            className="sc-input"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && active < shown.length ? optionId(active) : undefined}
            placeholder="Search the canvas"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <IconButton
          label="Previous match"
          shortcut="Shift+Enter"
          icon={PanelIcons.up}
          size="s"
          tooltipSide="bottom"
          disabled={matches.length === 0}
          onClick={() => step(-1)}
        />
        <IconButton
          label="Next match"
          shortcut="Enter"
          icon={PanelIcons.down}
          size="s"
          tooltipSide="bottom"
          disabled={matches.length === 0}
          onClick={() => step(1)}
        />
      </div>

      <div className="sc-search-status">
        <span className="sc-search-count" role="status">
          {q ? matchCountLabel(active, matches.length) : ""}
        </span>
      </div>

      {!q ? (
        <p className="sc-hint">
          Finds text, shape labels and frame names. Every match lights up on the canvas; press Enter to go to
          the next one.
        </p>
      ) : matches.length === 0 ? (
        <p className="sc-hint">Nothing on the canvas says “{q}”.</p>
      ) : null}

      <div id={listId} role="listbox" aria-label="Matches" tabIndex={-1} className="sc-results">
        {shown.map((m, i) => {
          const s = snippetOf(m)
          const container = m.kind === "label" ? core.scene.get(m.targetId) : undefined
          const kind =
            m.kind === "frame" ? "Frame name" : container ? `Label · ${elementTypeLabel(container)}` : "Text"
          return (
            <div
              key={m.id}
              id={optionId(i)}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className="sc-result"
              onPointerDown={(e) => e.preventDefault()}
              onPointerUp={(e) => {
                if (e.button === 0) goTo(i)
              }}
            >
              {kindIcon(m)}
              <span className="sc-result-text">
                {s.before}
                <mark>{s.match}</mark>
                {s.after}
                <span className="sc-result-kind">{kind}</span>
              </span>
            </div>
          )
        })}
      </div>
      {matches.length > shown.length ? (
        <p className="sc-hint">
          Showing the first {shown.length} of {matches.length}. Type more to narrow it down.
        </p>
      ) : null}
    </SideSheet>
  )
}
