import type {
  EditorCore,
  FillStyle,
  FontFamily,
  Roughness,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from "@nib/core"
import { useEffect, useId, useRef, useState } from "react"
import type { ThemeDef } from "../../theme/themes"
import { IconButton, Segmented, Slider, Toolbar, isImeKey } from "../primitives"
import { ArrowheadPicker } from "./ArrowheadPicker"
import { ColorPanel, Section } from "./ColorPanel"
import { applyStyle, shortcutFor } from "./apply"
import { keepFieldFocus } from "./fieldPress"
import { StyleIcons } from "./icons"
import { type ArrowType, type Edges, MIXED, type StyleGroup, type StyleModel, orNull } from "./model"
import {
  ALIGN_OPTIONS,
  ARROW_TYPE_OPTIONS,
  EDGE_OPTIONS,
  FILL_OPTIONS,
  FONT_OPTIONS,
  FONT_SIZES,
  SLOPPINESS_OPTIONS,
  STROKE_STYLE_OPTIONS,
  VALIGN_OPTIONS,
  WIDTH_OPTIONS,
} from "./options"
import { parseFontSize } from "./parse"
import { useCommitOnOutsidePress } from "./useCommitOnOutsidePress"
import { readStyleModel } from "./useStyleModel"
import "./StyleBar.css"

const str = <T extends string | number>(v: T | typeof MIXED): string | null =>
  v === MIXED ? null : String(v)

interface PanelProps {
  core: EditorCore
  model: StyleModel
  theme: ThemeDef
  onClose?: () => void
}

const StrokeColorPanel = ({ core, model, theme, onClose }: PanelProps) => (
  <ColorPanel
    target="stroke"
    label="Stroke"
    theme={theme}
    onRequestClose={onClose}
    current={orNull(model.strokeColor)}
    elements={core.scene.getNonDeleted()}
    onPick={(c) => applyStyle(core, { strokeColor: c })}
  />
)

const FillPanel = ({ core, model, theme, onClose }: PanelProps) => (
  <ColorPanel
    target="background"
    label="Background"
    theme={theme}
    onRequestClose={onClose}
    current={orNull(model.backgroundColor)}
    elements={core.scene.getNonDeleted()}
    onPick={(c) => applyStyle(core, { backgroundColor: c })}
  >
    <Section title="Fill style">
      <Segmented<FillStyle>
        label="Fill style"
        value={orNull(model.fillStyle)}
        // always present so nothing moves when the background toggles transparent
        options={FILL_OPTIONS.map((o) => ({ ...o, disabled: !model.fillEnabled }))}
        onChange={(v) => applyStyle(core, { fillStyle: v })}
      />
    </Section>
  </ColorPanel>
)

const StrokePanel = ({ core, model }: PanelProps) => (
  <div className="sc-style-stack">
    <Section title="Width">
      <Segmented<string>
        label="Stroke width"
        value={str(model.strokeWidth)}
        options={WIDTH_OPTIONS}
        onChange={(v) => applyStyle(core, { strokeWidth: Number(v) })}
      />
    </Section>
    {model.showStrokeStyle ? (
      <>
        <Section title="Style">
          <Segmented<StrokeStyle>
            label="Stroke style"
            value={orNull(model.strokeStyle)}
            options={STROKE_STYLE_OPTIONS}
            onChange={(v) => applyStyle(core, { strokeStyle: v })}
          />
        </Section>
        <Section title="Sloppiness">
          <Segmented<string>
            label="Sloppiness"
            value={str(model.roughness)}
            options={SLOPPINESS_OPTIONS}
            onChange={(v) => applyStyle(core, { roughness: Number(v) as Roughness })}
          />
        </Section>
      </>
    ) : null}
  </div>
)

const EdgesPanel = ({ core, model }: PanelProps) => (
  <Section title="Edges">
    <Segmented<Edges>
      label="Edges"
      value={orNull(model.edges)}
      options={EDGE_OPTIONS}
      onChange={(v) => applyStyle(core, { roundness: v === "round" ? { type: 3 } : null })}
    />
  </Section>
)

const ArrowPanel = ({ core, model }: PanelProps) => (
  <div className="sc-style-stack">
    <Section title="Type">
      <Segmented<ArrowType>
        label="Arrow type"
        value={orNull(model.arrowType)}
        options={ARROW_TYPE_OPTIONS}
        onChange={(v) => core.updateSelectedStyle({ arrowType: v })}
      />
    </Section>
    <Section title="Start">
      <ArrowheadPicker
        end="start"
        value={model.startArrowhead === MIXED ? undefined : model.startArrowhead}
        onChange={(v) => core.updateSelectedStyle({ startArrowhead: v })}
      />
    </Section>
    <Section title="End">
      <ArrowheadPicker
        end="end"
        value={model.endArrowhead === MIXED ? undefined : model.endArrowhead}
        onChange={(v) => core.updateSelectedStyle({ endArrowhead: v })}
      />
    </Section>
  </div>
)

const FontSizeField = ({ value, onCommit }: { value: number | null; onCommit: (size: number) => void }) => {
  const id = useId()
  const fieldRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value === null ? "" : String(value))
  const dirty = useRef(false)

  useEffect(() => {
    if (!dirty.current) setDraft(value === null ? "" : String(value))
  }, [value])

  const revert = () => {
    dirty.current = false
    setDraft(value === null ? "" : String(value))
  }
  const commit = () => {
    if (!dirty.current) return
    const n = parseFontSize(draft)
    dirty.current = false
    if (n === null) {
      setDraft(value === null ? "" : String(value))
      return
    }
    setDraft(String(n))
    if (n !== value) onCommit(n)
  }
  useCommitOnOutsidePress(fieldRef, commit)

  return (
    <div ref={fieldRef} className="sc-style-number" onMouseDown={keepFieldFocus(ref)}>
      <label htmlFor={id} className="sc-style-hex-label">
        Custom
      </label>
      <div className="sc-style-hex-box">
        <input
          ref={ref}
          id={id}
          className="sc-style-hex-input sc-style-number-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Font size in pixels"
          placeholder={value === null ? "Mixed" : undefined}
          value={draft}
          onChange={(e) => {
            dirty.current = true
            setDraft(e.currentTarget.value)
          }}
          onKeyDown={(e) => {
            if (isImeKey(e)) return
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape" && dirty.current) {
              e.preventDefault()
              e.stopPropagation()
              revert()
            }
          }}
          onBlur={commit}
        />
        <span className="sc-style-hex-hash" aria-hidden="true">
          px
        </span>
      </div>
    </div>
  )
}

const TextPanel = ({ core, model }: PanelProps) => (
  <div className="sc-style-stack">
    <Section title="Font">
      <Segmented<FontFamily>
        label="Font family"
        value={orNull(model.fontFamily)}
        options={FONT_OPTIONS}
        onChange={(v) => core.updateSelectedStyle({ fontFamily: v })}
      />
    </Section>
    <Section title="Size">
      <div className="sc-style-inline">
        <Segmented<string>
          label="Font size"
          value={str(model.fontSize)}
          options={FONT_SIZES}
          onChange={(v) => core.updateSelectedStyle({ fontSize: Number(v) })}
        />
        <FontSizeField
          value={orNull(model.fontSize)}
          onCommit={(n) => core.updateSelectedStyle({ fontSize: n })}
        />
      </div>
    </Section>
    <Section title="Align">
      <div className="sc-style-inline">
        <Segmented<TextAlign>
          label="Text align"
          value={orNull(model.textAlign)}
          options={ALIGN_OPTIONS}
          onChange={(v) => core.updateSelectedStyle({ textAlign: v })}
        />
        {model.showVerticalAlign ? (
          <Segmented<VerticalAlign>
            label="Vertical align"
            value={orNull(model.verticalAlign)}
            options={VALIGN_OPTIONS}
            onChange={(v) => core.updateSelectedStyle({ verticalAlign: v })}
          />
        ) : null}
      </div>
    </Section>
  </div>
)

/** A drag is one undo step: the transaction opens on the first movement and commits on release. */
const OpacityPanel = ({ core, model }: PanelProps) => {
  const open = useRef(false)
  const end = () => {
    if (!open.current) return
    open.current = false
    core.commitTransaction()
  }
  // a selection change can unmount the slider mid-drag; never leave the transaction dangling
  useEffect(
    () => () => {
      if (!open.current) return
      open.current = false
      core.commitTransaction()
    },
    [core],
  )
  return (
    <div className="sc-style-opacity">
      <Slider
        label="Opacity"
        value={orNull(model.opacity)}
        min={0}
        max={100}
        step={1}
        format={(v) => `${Math.round(v)}%`}
        onStart={() => {
          if (open.current) return
          open.current = true
          core.beginTransaction()
        }}
        onChange={(v) => core.updateSelectedStyle({ opacity: v })}
        onCommit={end}
      />
    </div>
  )
}

const ACTION_SIZE = "s" as const

const ArrangePanel = ({ core, model }: PanelProps) => (
  <div className="sc-style-stack">
    <Section title="Layers">
      <Toolbar label="Layers" className="sc-style-actions">
        <IconButton
          size={ACTION_SIZE}
          label="Send to back"
          shortcut={shortcutFor("arrange.back")}
          icon={StyleIcons.toBack}
          onClick={() => core.moveZ("back")}
        />
        <IconButton
          size={ACTION_SIZE}
          label="Send backward"
          shortcut={shortcutFor("arrange.backward")}
          icon={StyleIcons.backward}
          onClick={() => core.moveZ("backward")}
        />
        <IconButton
          size={ACTION_SIZE}
          label="Bring forward"
          shortcut={shortcutFor("arrange.forward")}
          icon={StyleIcons.forward}
          onClick={() => core.moveZ("forward")}
        />
        <IconButton
          size={ACTION_SIZE}
          label="Bring to front"
          shortcut={shortcutFor("arrange.front")}
          icon={StyleIcons.toFront}
          onClick={() => core.moveZ("front")}
        />
      </Toolbar>
    </Section>
    {model.arrange.canAlign ? (
      <Section title="Align">
        <Toolbar label="Align" className="sc-style-actions">
          <IconButton
            size={ACTION_SIZE}
            label="Align left"
            shortcut={shortcutFor("arrange.alignLeft")}
            icon={StyleIcons.alignLeft}
            onClick={() => core.align("left")}
          />
          <IconButton
            size={ACTION_SIZE}
            label="Centre horizontally"
            icon={StyleIcons.alignCenterX}
            onClick={() => core.align("centerX")}
          />
          <IconButton
            size={ACTION_SIZE}
            label="Align right"
            shortcut={shortcutFor("arrange.alignRight")}
            icon={StyleIcons.alignRight}
            onClick={() => core.align("right")}
          />
          <IconButton
            size={ACTION_SIZE}
            label="Align top"
            shortcut={shortcutFor("arrange.alignTop")}
            icon={StyleIcons.alignTop}
            onClick={() => core.align("top")}
          />
          <IconButton
            size={ACTION_SIZE}
            label="Centre vertically"
            icon={StyleIcons.alignCenterY}
            onClick={() => core.align("centerY")}
          />
          <IconButton
            size={ACTION_SIZE}
            label="Align bottom"
            shortcut={shortcutFor("arrange.alignBottom")}
            icon={StyleIcons.alignBottom}
            onClick={() => core.align("bottom")}
          />
        </Toolbar>
      </Section>
    ) : null}
    {model.arrange.canDistribute ? (
      <Section title="Distribute">
        <Toolbar label="Distribute" className="sc-style-actions">
          <IconButton
            size={ACTION_SIZE}
            label="Distribute horizontally"
            icon={StyleIcons.distributeH}
            onClick={() => core.distribute("horizontal")}
          />
          <IconButton
            size={ACTION_SIZE}
            label="Distribute vertically"
            icon={StyleIcons.distributeV}
            onClick={() => core.distribute("vertical")}
          />
        </Toolbar>
      </Section>
    ) : null}
  </div>
)

export interface StyleGroupPanelProps {
  core: EditorCore
  theme: ThemeDef
  group: StyleGroup
  /** The bar passes its model; standalone use reads it from the core. */
  model?: StyleModel | null
  /** Closes the popover the panel sits in (the colour panels' eyedropper needs the board in view). */
  onClose?: () => void
}

/** The popover content of one style-bar group. "closed" and "more" have none (a toggle and a menu). */
export const StyleGroupPanel = ({ core, theme, group, model, onClose }: StyleGroupPanelProps) => {
  const m = model === undefined ? readStyleModel(core) : model
  if (!m) return null
  const props = { core, model: m, theme, onClose }
  switch (group) {
    case "strokeColor":
      return <StrokeColorPanel {...props} />
    case "fill":
      return <FillPanel {...props} />
    case "stroke":
      return <StrokePanel {...props} />
    case "edges":
      return <EdgesPanel {...props} />
    case "arrow":
      return <ArrowPanel {...props} />
    case "text":
      return <TextPanel {...props} />
    case "opacity":
      return <OpacityPanel {...props} />
    case "arrange":
      return <ArrangePanel {...props} />
    default:
      return null
  }
}
