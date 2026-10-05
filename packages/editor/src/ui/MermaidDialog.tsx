import {
  type CanvasPalette,
  type EditorCore,
  type MermaidDiagramKind,
  type NibElement,
  exportToSvg,
  mermaidToElements,
  parseMermaid,
} from "@nib/core"
import { useDeferredValue, useId, useMemo, useRef, useState } from "react"
import { Dialog } from "./primitives/Dialog"
import { Button } from "./primitives/IconButton"
import { isImeKey } from "./primitives/ime"
import "./panels/panels.css"

export interface MermaidDialogProps {
  core: EditorCore
  onClose(): void
  onInsert(elements: NibElement[]): void
  /** Defaults to true, so the shell can mount it only while it is open. */
  open?: boolean
  /** Starting source, such as Mermaid text the user just pasted. */
  source?: string
  /** The theme's canvas palette, so the preview matches the board. */
  palette?: CanvasPalette
}

export const MERMAID_SAMPLES: Readonly<Record<MermaidDiagramKind, { label: string; source: string }>> = {
  flowchart: {
    label: "Flowchart",
    source: `flowchart TD
  A[Idea] --> B{Worth building?}
  B -->|yes| C[Sketch it]
  B -->|no| D((Park it))
  C --> E[Ship]`,
  },
  sequence: {
    label: "Sequence",
    source: `sequenceDiagram
  participant You
  participant Nib
  You->>Nib: Paste a diagram
  Nib-->>You: Shapes you can edit
  Note over You,Nib: Arrows stay attached`,
  },
  class: {
    label: "Class",
    source: `classDiagram
  class Shape {
    +number x
    +number y
    +draw()
  }
  class Arrow {
    +bind(shape)
  }
  Shape <|-- Arrow`,
  },
}

const KIND_NAMES: Readonly<Record<MermaidDiagramKind, string>> = {
  flowchart: "a flowchart",
  sequence: "a sequence diagram",
  class: "a class diagram",
}

const KINDS = Object.keys(MERMAID_SAMPLES) as MermaidDiagramKind[]
const isSample = (text: string) => !text.trim() || KINDS.some((k) => MERMAID_SAMPLES[k].source === text)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface MermaidBuild {
  elements: NibElement[]
  kind: MermaidDiagramKind | null
  error: string | null
  warnings: string[]
}

/** Parses and lays out the source; never throws. */
export const buildMermaid = (core: EditorCore, source: string): MermaidBuild => {
  const parsed = parseMermaid(source)
  if (!parsed.ok)
    return {
      elements: [],
      kind: null,
      error: parsed.error ?? "That diagram couldn't be read.",
      warnings: parsed.warnings ?? [],
    }
  try {
    const elements = mermaidToElements(parsed, {
      appState: core.appState,
      origin: [0, 0],
      nextIndex: () => core.scene.nextIndex(),
    })
    if (elements.length === 0)
      return {
        elements,
        kind: parsed.kind,
        error: "That diagram has nothing to draw yet.",
        warnings: parsed.warnings,
      }
    return { elements, kind: parsed.kind, error: null, warnings: parsed.warnings }
  } catch (e) {
    return { elements: [], kind: parsed.kind, error: (e as Error).message, warnings: parsed.warnings }
  }
}

/**
 * The build to insert: the preview's, unless the deferred preview has not caught up with the source yet
 * (a key pressed right after a large paste), when the source is built afresh.
 */
export const buildForInsert = (
  core: EditorCore,
  text: string,
  preview: { source: string; build: MermaidBuild },
): MermaidBuild => (preview.source === text ? preview.build : buildMermaid(core, text))

/** Paste Mermaid, see it drawn as it parses, and insert it as ordinary editable shapes and arrows. */
export function MermaidDialog({ core, onClose, onInsert, open = true, source, palette }: MermaidDialogProps) {
  const ids = useId()
  const [text, setText] = useState(source ?? MERMAID_SAMPLES.flowchart.source)
  const [stash, setStash] = useState<string | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const deferred = useDeferredValue(text)
  const built = useMemo(() => buildMermaid(core, deferred), [core, deferred])
  const theme = core.appState.theme

  // appState only matters to the preview through the theme
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const preview = useMemo(() => {
    if (built.elements.length === 0) return null
    try {
      const svg = exportToSvg({
        elements: built.elements,
        appState: core.appState,
        exportBackground: false,
        exportPadding: 12,
        scale: 1,
        theme,
        palette,
      })
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    } catch {
      return null
    }
  }, [built.elements, theme, palette])

  const shapes = built.elements.filter(
    (e) => e.type !== "arrow" && e.type !== "text" && e.type !== "line",
  ).length
  const arrows = built.elements.filter((e) => e.type === "arrow").length
  const canInsert = built.elements.length > 0 && !core.appState.viewMode

  const insert = () => {
    if (core.appState.viewMode) return
    const build = buildForInsert(core, text, { source: deferred, build: built })
    if (build.elements.length === 0) return
    onInsert(build.elements)
    onClose()
  }

  const loadSample = (kind: MermaidDiagramKind) => {
    if (!isSample(text)) setStash(text)
    setText(MERMAID_SAMPLES[kind].source)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mermaid to diagram"
      className="sc-panel-dialog"
      size="l"
      dismissOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canInsert} onClick={insert}>
            Insert diagram
          </Button>
        </>
      }
    >
      <div className="sc-mermaid" data-testid="mermaid-dialog">
        <div className="sc-mermaid-source">
          <label htmlFor={`${ids}-source`} className="sc-section-title">
            Mermaid source
          </label>
          <textarea
            ref={sourceRef}
            id={`${ids}-source`}
            className="sc-textarea"
            spellCheck={false}
            autoComplete="off"
            value={text}
            aria-invalid={built.error ? true : undefined}
            aria-describedby={`${ids}-status`}
            onChange={(e) => {
              setText(e.target.value)
              setStash(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isImeKey(e)) {
                e.preventDefault()
                insert()
              }
            }}
          />
          <p className="sc-mermaid-kinds">
            <span>Nib reads flowcharts, sequence and class diagrams. Start from</span>
            {KINDS.map((k) => (
              <Button key={k} onClick={() => loadSample(k)}>
                {MERMAID_SAMPLES[k].label}
              </Button>
            ))}
          </p>
          {stash !== null ? (
            <p className="sc-hint">
              Your text was replaced by the example.{" "}
              <Button
                onClick={() => {
                  setText(stash)
                  setStash(null)
                  // the button goes with the note; focus stays in the dialog, on the text it restored
                  sourceRef.current?.focus({ preventScroll: true })
                }}
              >
                Put it back
              </Button>
            </p>
          ) : null}
        </div>

        <div className="sc-stack">
          <span className="sc-section-title" aria-hidden="true">
            Preview
          </span>
          <div className="sc-mermaid-preview">
            {preview ? (
              <img src={preview} alt="Preview of the diagram" />
            ) : (
              <p className="sc-mermaid-placeholder">
                {built.error ? "Fix the source to see the diagram here." : "The diagram appears here."}
              </p>
            )}
          </div>
          <div id={`${ids}-status`} className="sc-mermaid-status" role="status">
            {built.error ? (
              <p className="sc-field-error">{built.error}</p>
            ) : built.kind ? (
              <p className="sc-hint">
                Reading {KIND_NAMES[built.kind]}: {plural(shapes, "shape", "shapes")},{" "}
                {plural(arrows, "arrow", "arrows")}. Everything stays editable.
              </p>
            ) : null}
            {built.warnings.length ? (
              <ul className="sc-mermaid-warnings" aria-label="Skipped">
                {built.warnings.slice(0, 5).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {built.warnings.length > 5 ? <li>and {built.warnings.length - 5} more</li> : null}
              </ul>
            ) : null}
            {core.appState.viewMode ? (
              <p className="sc-hint">View mode is on. Turn it off to insert the diagram.</p>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
