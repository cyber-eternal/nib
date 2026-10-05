import {
  type CanvasPalette,
  type EditorCore,
  type NibElement,
  defaultCanvasPalette,
  frameExport,
  serializeNib,
} from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"
import { type CSSProperties, useMemo, useState } from "react"
import {
  type ExportOptions,
  exportToPngBlob,
  exportToSvgFile,
  exportToSvgString,
} from "../export/exportImage"
import {
  ALL_FRAMES,
  EXPORT_PREF_KEY,
  type ExportFormat,
  type ExportPrefs,
  type ExportScale,
  type ExportScope,
  exportErrorMessage,
  exportSize,
  fileStem,
  frameFileStems,
  frameTitles,
  framesOf,
  initialScope,
  parseExportPrefs,
  scaleLabel,
  serializeExportPrefs,
  sizeLabel,
} from "./panels/exportModel"
import { PanelIcons } from "./panels/icons"
import { Dialog } from "./primitives/Dialog"
import { Button } from "./primitives/IconButton"
import { Segmented } from "./primitives/Segmented"
import { Switch } from "./primitives/Switch"
import "./panels/panels.css"

export interface ExportDialogProps {
  core: EditorCore
  onClose(): void
  /** May return a promise; a rejection is shown in the dialog (an AbortError from a cancelled picker is not). */
  onSaveBlob(blob: Blob, filename: string): unknown
  onSaveText(text: string, filename: string): unknown
  onCopyPng(blob: Blob): unknown
  onCopyText(text: string): unknown
  /**
   * Preferred over onCopyPng: called synchronously inside the click with the PNG still rendering, so the
   * clipboard write starts within the user gesture (WebKit drops it otherwise).
   */
  onCopyPngPromise?(png: Promise<Blob>): unknown
  /** Defaults to true, so the shell can mount it only while it is open. */
  open?: boolean
  /** The document's file name without extension (DocumentController.baseName). */
  fileName?: string
  /** Same as fileName. */
  baseName?: string
  /** Remembers the options across launches; within a session they are remembered either way. */
  prefs?: PlatformPrefs
  /** Supplies prefs when `prefs` is not given. */
  platform?: { prefs: PlatformPrefs }
  /** Also told about a failed export, for a toast; the dialog shows the message inline either way. */
  onError?(message: string): void
  /**
   * Accepted but not applied: exports keep their own light/dark switch and use white or the Graphite
   * board, not the theme's board (design brief, "The 10 themes").
   */
  palette?: CanvasPalette
}

interface Target {
  /** What the export lays out; a frame export filters these down to the frame itself. */
  elements: readonly NibElement[]
  frameId: string | null
  stem: string
}

let sessionPrefs: ExportPrefs | null = null

const startingPrefs = (prefs?: PlatformPrefs): ExportPrefs =>
  sessionPrefs ?? parseExportPrefs(prefs?.get(EXPORT_PREF_KEY) ?? null)

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG" },
] as const

const SCALE_OPTIONS = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
] as const

/** ⇧⌘E: PNG or SVG of the canvas, the selection, one frame or every frame, with a true-size preview. */
export function ExportDialog({
  core,
  onClose,
  onSaveBlob,
  onSaveText,
  onCopyPng,
  onCopyText,
  onCopyPngPromise,
  open = true,
  fileName,
  baseName,
  prefs: prefsProp,
  platform,
  onError,
}: ExportDialogProps) {
  const prefs = prefsProp ?? platform?.prefs
  const [opts, setOpts] = useState<ExportPrefs>(() => startingPrefs(prefs))
  const selection = core.selectedElements({ includeBoundText: true })
  const [start] = useState(() => initialScope(selection))
  const [scope, setScope] = useState<ExportScope>(start.scope)
  const all = core.scene.getNonDeleted()
  const frames = framesOf(all)
  const titles = frameTitles(frames)
  const [frameChoice, setFrameChoice] = useState<string>(start.frameId ?? frames[0]?.id ?? ALL_FRAMES)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<ExportPrefs>) => {
    const next = { ...opts, ...patch }
    sessionPrefs = next
    prefs?.set(EXPORT_PREF_KEY, serializeExportPrefs(next))
    setOpts(next)
    setError(null)
  }

  const dark = opts.dark ?? core.appState.theme === "dark"
  const theme = dark ? ("dark" as const) : ("light" as const)
  const format: ExportFormat = opts.format
  const base = fileStem(fileName ?? baseName ?? core.appState.name)

  const selectedIds = core.withFrameChildren(selection)
  const selected = all.filter((e) => selectedIds.has(e.id))
  const frameId =
    frames.some((f) => f.id === frameChoice) || (frameChoice === ALL_FRAMES && frames.length > 1)
      ? frameChoice
      : frames.length > 1
        ? ALL_FRAMES
        : (frames[0]?.id ?? null)
  const effectiveScope: ExportScope =
    scope === "frame" && frames.length === 0
      ? "canvas"
      : scope === "selection" && !selected.length
        ? "canvas"
        : scope

  const targets: Target[] = (() => {
    if (effectiveScope === "selection") return [{ elements: selected, frameId: null, stem: base }]
    if (effectiveScope === "frame") {
      const chosen = frameId === ALL_FRAMES ? frames : frames.filter((f) => f.id === frameId)
      const stems = frameFileStems(
        base,
        chosen.map((f) => titles[frames.indexOf(f)]!),
      )
      return chosen.map((f, i) => ({ elements: all, frameId: f.id, stem: stems[i]! }))
    }
    return [{ elements: all, frameId: null, stem: base }]
  })()

  /** "file" is what gets saved; "measure" sizes it without serialising the scene; "preview" is 1×. */
  const optionsFor = (t: Target, mode: "file" | "measure" | "preview" = "file"): ExportOptions => {
    const embed = opts.embedScene && mode === "file"
    const sceneElements = embed && t.frameId ? (frameExport(all, t.frameId)?.elements ?? []) : t.elements
    return {
      elements: t.elements,
      appState: core.appState,
      files: core.scene.files,
      scale: format === "png" && mode !== "preview" ? opts.scale : 1,
      exportBackground: opts.background,
      theme,
      embedScene: embed ? serializeNib(sceneElements, core.appState, core.scene.files) : null,
      embedFonts: format === "svg" && opts.embedFonts,
      frameId: t.frameId,
    }
  }

  const first = targets[0]
  const empty = !first || (!first.frameId && first.elements.length === 0)
  const previewKey = `${core.staticVersion}|${effectiveScope}|${frameId}|${opts.background}|${theme}|${[...selectedIds].join(",")}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: the preview is a function of previewKey
  const preview = useMemo((): { url: string | null; error: string | null } => {
    if (empty || !first) return { url: null, error: null }
    try {
      const svg = exportToSvgString(optionsFor(first, "preview"))
      return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, error: null }
    } catch (e) {
      return { url: null, error: exportErrorMessage(e) }
    }
  }, [previewKey])

  const size = !empty && first ? exportSize(optionsFor(first, "measure"), format) : null
  const palette = defaultCanvasPalette(theme)
  const previewStyle = {
    "--preview-board": palette.board,
    "--preview-check": palette.gridMajor,
  } as CSSProperties

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      const message = exportErrorMessage(e)
      if (message) {
        setError(message)
        onError?.(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      for (const t of targets) {
        const o = optionsFor(t)
        if (format === "png") await onSaveBlob(await exportToPngBlob(o), `${t.stem}.png`)
        else await onSaveText(await exportToSvgFile(o), `${t.stem}.svg`)
      }
      onClose()
    })

  const copy = () => {
    if (!first) return
    const o = optionsFor(first)
    if (format === "svg") {
      void run(async () => {
        await onCopyText(await exportToSvgFile(o))
        onClose()
      })
      return
    }
    // started here, not after an await, so the clipboard write stays inside the click
    const png = exportToPngBlob(o)
    void run(async () => {
      if (onCopyPngPromise) await onCopyPngPromise(png)
      else await onCopyPng(await png)
      await png
      onClose()
    })
  }

  const many = targets.length > 1
  const label = format.toUpperCase()
  const saveLabel = busy ? "Exporting…" : many ? `Save ${targets.length} ${label}s` : `Save ${label}`
  const frameOptionTitle = (f: NibElement) => titles[frames.indexOf(f)] ?? "Frame"

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export image"
      size="l"
      className="sc-panel-dialog sc-export-dialog"
      footer={
        <div className="sc-export-foot">
          {many ? <p className="sc-hint">Each frame saves as its own file.</p> : null}
          <Button disabled={busy || empty || many} onClick={copy} icon={PanelIcons.copy}>
            Copy {label}
          </Button>
          <Button
            variant="primary"
            disabled={busy || empty}
            onClick={() => void save()}
            icon={PanelIcons.download}
          >
            {saveLabel}
          </Button>
        </div>
      }
    >
      <div className="sc-export" data-testid="export-dialog" aria-busy={busy || undefined}>
        <div className="sc-export-stage">
          <div
            className="sc-export-preview"
            data-checker={!empty && !opts.background ? "" : undefined}
            style={empty ? undefined : previewStyle}
          >
            {empty ? (
              <div className="sc-export-empty">
                <strong>Nothing to export yet</strong>
                <span>
                  {effectiveScope === "selection"
                    ? "The selection is empty."
                    : "Draw something first, then come back to save it as an image."}
                </span>
              </div>
            ) : preview.url ? (
              <img src={preview.url} alt="Preview of the export" />
            ) : (
              <div className="sc-export-empty">
                <strong>No preview</strong>
                <span>{preview.error ?? "The preview couldn't be drawn."}</span>
              </div>
            )}
          </div>
          {size ? (
            <div className="sc-export-meta" aria-live="polite">
              <span>
                <strong>{sizeLabel(size)}</strong>
                {format === "png" ? ` at ${scaleLabel(size.scale)}` : ""}
              </span>
              <span>
                {size.reduced
                  ? `Reduced from ${scaleLabel(size.requested)} to fit the browser's canvas limit`
                  : many
                    ? `First of ${targets.length} frames`
                    : !opts.background
                      ? "Transparent background"
                      : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="sc-export-options">
          <div className="sc-section">
            <span className="sc-section-title" aria-hidden="true">
              Format
            </span>
            <Segmented
              label="Format"
              options={FORMAT_OPTIONS}
              value={format}
              onChange={(v) => update({ format: v })}
            />
          </div>

          <div className="sc-section">
            <span className="sc-section-title" aria-hidden="true">
              What to export
            </span>
            <Segmented
              label="What to export"
              options={[
                { value: "canvas", label: "Canvas" },
                { value: "selection", label: "Selection", disabled: selected.length === 0 },
                { value: "frame", label: "Frame", disabled: frames.length === 0 },
              ]}
              value={effectiveScope}
              onChange={(v) => {
                setScope(v)
                setError(null)
              }}
            />
            {effectiveScope === "frame" ? (
              <label className="sc-select">
                <span className="sc-visually-hidden">Frame</span>
                <select
                  value={frameId ?? ""}
                  onChange={(e) => {
                    setFrameChoice(e.target.value)
                    setError(null)
                  }}
                >
                  {frames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {frameOptionTitle(f)}
                    </option>
                  ))}
                  {frames.length > 1 ? <option value={ALL_FRAMES}>Every frame, one file each</option> : null}
                </select>
                {PanelIcons.chevron}
              </label>
            ) : null}
          </div>

          {format === "png" ? (
            <div className="sc-section">
              <span className="sc-section-title" aria-hidden="true">
                Scale
              </span>
              <Segmented
                label="Scale"
                options={SCALE_OPTIONS}
                value={String(opts.scale) as "1" | "2" | "3"}
                onChange={(v) => update({ scale: Number(v) as ExportScale })}
              />
            </div>
          ) : null}

          <div className="sc-section">
            <Switch
              label="Background"
              checked={opts.background}
              onChange={(on) => update({ background: on })}
            />
            <Switch label="Dark mode" checked={dark} onChange={(on) => update({ dark: on })} />
            {format === "svg" ? (
              <Switch
                label="Embed fonts"
                checked={opts.embedFonts}
                onChange={(on) => update({ embedFonts: on })}
              />
            ) : null}
            <Switch
              label="Embed scene"
              checked={opts.embedScene}
              onChange={(on) => update({ embedScene: on })}
            />
            <p className="sc-hint">
              {opts.embedScene
                ? "Nib can reopen this image as an editable drawing."
                : format === "svg" && opts.embedFonts
                  ? "Text keeps its hand-drawn face wherever the SVG goes."
                  : "Turn on Embed scene to reopen the image in Nib later."}
            </p>
          </div>

          {error ? (
            <p className="sc-alert" role="alert">
              {PanelIcons.alert}
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
