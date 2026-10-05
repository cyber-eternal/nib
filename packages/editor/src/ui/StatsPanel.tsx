import { type EditorCore, type NibElement, getCommonBounds } from "@nib/core"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { useCoreVersion } from "../hooks/useEditor"
import { PanelIcons } from "./panels/icons"
import {
  FIELD_LABELS,
  GEOMETRY_FIELDS,
  type GeometryField,
  decideCommit,
  elementTypeLabel,
  fieldValue,
  geometryAvailability,
  geometryPatch,
  parseFieldInput,
  roundForDisplay,
} from "./panels/statsModel"
import { IconButton } from "./primitives/IconButton"
import { isImeKey } from "./primitives/ime"
import "./panels/panels.css"

export interface StatsPanelProps {
  core: EditorCore
  onClose(): void
}

const DISPLAY_LABELS: Readonly<Record<GeometryField, string>> = { ...FIELD_LABELS, angle: "Angle (°)" }

const show = (n: number): string => String(roundForDisplay(n))

interface FieldProps {
  field: GeometryField
  value: number
  disabled: boolean
  describedBy?: string
  onCommit(value: number): void
  onError(message: string | null): void
}

/** One numeric field: Enter or leaving commits one undo step, Escape puts the old value back. */
function GeometryInput({ field, value, disabled, describedBy, onCommit, onError }: FieldProps) {
  const id = useId()
  const [draft, setDraft] = useState(show(value))
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  // blur runs after Escape's reset with the typed draft still in its closure
  const cancelled = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(show(value))
  }, [value, editing])

  const fail = (message: string | null) => {
    setInvalid(message !== null)
    onError(message)
  }

  const commit = () => {
    const d = decideCommit(field, draft, value)
    setEditing(false)
    setDraft(show(value))
    if (d.kind === "invalid") {
      // the reason stays on screen so the revert isn't silent
      onError(d.error)
      setInvalid(false)
      return
    }
    fail(null)
    if (d.kind === "commit") onCommit(d.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e)) return
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      cancelled.current = true
      setDraft(show(value))
      setEditing(false)
      fail(null)
      e.currentTarget.blur()
    } else if (e.key === "Enter") {
      e.preventDefault()
      const d = decideCommit(field, draft, value)
      if (d.kind === "invalid") fail(d.error)
      else e.currentTarget.blur()
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const base = parseFieldInput(field, draft)
      const next = (base.ok ? base.value : value) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)
      const parsed = parseFieldInput(field, String(next))
      if (!parsed.ok) {
        fail(parsed.error)
        return
      }
      fail(null)
      setDraft(show(parsed.value))
      onCommit(parsed.value)
    }
  }

  return (
    <div className="sc-stats-field">
      <label htmlFor={id}>{DISPLAY_LABELS[field]}</label>
      <input
        id={id}
        className="sc-input"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const parsed = parseFieldInput(field, e.target.value)
          // refuse a size below the minimum as it is typed; other half-typed text waits for Enter
          if (parsed.ok) fail(null)
          else if (Number.isFinite(Number(e.target.value.trim().replace(/,/g, ".")))) fail(parsed.error)
        }}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false
            return
          }
          if (editing) commit()
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function ElementFields({ core, el }: { core: EditorCore; el: NibElement }) {
  const [error, setError] = useState<string | null>(null)
  const noteId = useId()
  const errorId = useId()
  const availability = geometryAvailability(el)
  const reasons = [
    ...new Set(
      GEOMETRY_FIELDS.map((f) => availability.fields[f].reason).filter(
        (r): r is string => !!r && r !== availability.note,
      ),
    ),
  ]
  const notes = [availability.note, ...reasons].filter(Boolean) as string[]
  const describedBy =
    [error ? errorId : null, notes.length ? noteId : null].filter(Boolean).join(" ") || undefined
  const label = elementTypeLabel(el)

  return (
    <>
      <h3 className="sc-stats-subtitle">{label}</h3>
      <div className="sc-stats-fields" role="group" aria-label={`${label} position and size`}>
        {GEOMETRY_FIELDS.map((field) => (
          <GeometryInput
            key={`${el.id}-${field}`}
            field={field}
            value={fieldValue(el, field)}
            disabled={availability.fields[field].disabled}
            describedBy={describedBy}
            onCommit={(value) => core.setElementGeometry(el.id, geometryPatch(field, value))}
            onError={setError}
          />
        ))}
      </div>
      {error ? (
        <p id={errorId} className="sc-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {notes.length ? (
        <div id={noteId}>
          {notes.map((n) => (
            <p key={n} className="sc-hint">
              {n}
            </p>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** ⌥/ : counts, zoom and the selected element's exact position, size and angle. */
export function StatsPanel({ core, onClose }: StatsPanelProps) {
  useCoreVersion(core)
  const titleId = useId()
  const all = core.scene.getNonDeleted()
  const selected = core.selectedElements()
  const single = selected.length === 1 ? selected[0]! : null
  const bounds = selected.length > 1 ? getCommonBounds(selected) : null
  const centre = core.viewportCenter()

  return (
    <section className="sc-stats" aria-labelledby={titleId} data-testid="stats-panel">
      <header className="sc-stats-head">
        <h2 id={titleId} className="sc-stats-title">
          Stats
        </h2>
        <IconButton
          label="Close stats"
          icon={PanelIcons.close}
          size="s"
          tooltipSide="bottom"
          onClick={onClose}
        />
      </header>

      <dl className="sc-stats-list">
        <dt>Elements</dt>
        <dd>{all.length}</dd>
        <dt>Selected</dt>
        <dd>{selected.length}</dd>
        <dt>Zoom</dt>
        <dd>{Math.round(core.appState.viewport.zoom * 100)}%</dd>
        <dt>View centre</dt>
        <dd>
          {Math.round(centre[0])}, {Math.round(centre[1])}
        </dd>
      </dl>

      {single ? (
        <ElementFields key={single.id} core={core} el={single} />
      ) : bounds ? (
        <>
          <h3 className="sc-stats-subtitle">{selected.length} elements</h3>
          <dl className="sc-stats-list">
            <dt>X</dt>
            <dd>{show(bounds[0])}</dd>
            <dt>Y</dt>
            <dd>{show(bounds[1])}</dd>
            <dt>Width</dt>
            <dd>{show(bounds[2] - bounds[0])}</dd>
            <dt>Height</dt>
            <dd>{show(bounds[3] - bounds[1])}</dd>
          </dl>
          <p className="sc-hint">Select one element to edit its position and size.</p>
        </>
      ) : (
        <p className="sc-hint">Select an element to see and edit its position, size and angle.</p>
      )}
    </section>
  )
}
