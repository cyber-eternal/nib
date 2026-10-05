import { ElementsChange } from "../change/elementsChange"
import { type AlignKind, type DistributeAxis, alignElements, distributeElements } from "../geometry/align"
import {
  addBoundElement,
  attachAlongRay,
  bindableElementAt,
  createBinding,
  removeBoundElement,
  updateBoundArrow,
} from "../geometry/binding"
import {
  BOUND_TEXT_PADDING,
  type BoundTextLayoutOptions,
  containerMinHeight,
  getBoundText,
  getBoundTextId,
  layoutBoundText,
  layoutStandaloneText,
} from "../geometry/boundText"
import { fullCrop, resetCrop } from "../geometry/crop"
import { getCommonBounds, getCommonVisualBounds, getElementBounds } from "../geometry/elementBounds"
import { elementsInLasso as lassoPick } from "../geometry/hitTest"
import { absolutePointsOf, bakeRotation, rebaseFromPoints } from "../geometry/linear"
import type { Recognized } from "../geometry/recognize"
import { flipElements } from "../geometry/resize"
import { DEFAULT_GRID_SIZE, normalizeGridSize, snapToGrid } from "../geometry/snapping"
import type { SnapLine } from "../geometry/snapping"
import { tidyLinearElements } from "../geometry/tidy"
import { History } from "../history/history"
import { isEmbeddableLink, isSafeLink, normalizeLink } from "../io/links"
import { type Bounds, boundsContainBounds, boundsIntersect, expandBounds } from "../math/bounds"
import { randomId } from "../math/random"
import { type Point, clamp } from "../math/vector"
import { duplicateElement, mutateElement, newElement } from "../model/element"
import { expandSelectionToGroups, getSelectedElements, outermostGroupId } from "../model/groups"
import { Scene } from "../model/scene"
import {
  type AppState,
  type ArrowElement,
  type BinaryFiles,
  DEFAULT_APP_STATE,
  type EmbeddableElement,
  type FrameElement,
  type FreedrawElement,
  type LineElement,
  type LinearElement,
  type NibElement,
  type TextElement,
  type ToolType,
  canHaveLabel,
  isLinearElement,
  isPolygonLine,
} from "../model/types"
import { computeMoveIndices, indicesBetween } from "../model/zindex"
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitBounds,
  panBy,
  screenToScene,
  visibleSceneBounds,
  zoomAt,
  zoomToValue,
} from "../render/viewport"
import { FreedrawTool } from "../tools/freedrawTool"
import { childrenOfFrame, elementsInFrame, frameIdFor, isBoundText, normalizeLinear } from "../tools/helpers"
import { LinearTool, applyElbowRoute, bindArrowEnds } from "../tools/linearTool"
import { ParallelogramTool } from "../tools/parallelogramTool"
import { shapeFromRecognized } from "../tools/pencil"
import { LassoTool, SelectionTool } from "../tools/selectionTool"
import { ShapeTool } from "../tools/shapeTool"
import { EraserTool, HandTool, ImageTool, LaserTool } from "../tools/simpleTools"
import { TextTool, createLabelFor, existingLabel, indexJustAbove } from "../tools/textTool"
import type { KeyInput, PointerInput, Tool } from "../tools/types"
import { elementIdFromLink, elementLink } from "./elementLinks"
import { SHORTCUT_TOOLS, matchShortcut } from "./shortcuts"

export interface EditorHost {
  /** The host knows the decoded bitmap size, which crop mode needs. */
  onRequestCrop?(id: string): void
  /** Opens the text overlay; the host calls back into commitText/cancelText. */
  onEditText?(text: TextElement, container: NibElement | null): void
  /** Opens the image picker; the host calls insertImage, or cancelImageInsert if the picker is dismissed. */
  onRequestImage?(at: Point): void
  onRenameFrame?(frame: FrameElement): void
  onOpenLink?(url: string): void
  onToolChange?(tool: ToolType): void
  /** A new embeddable needs its address; the host asks for it and calls setEmbeddableLink. */
  onEditEmbed?(el: EmbeddableElement): void
  /** A tool threw mid-gesture; the gesture was rolled back and editing carries on. Defaults to console.error. */
  onError?(error: unknown): void
}

export type FlowDirection = "up" | "down" | "left" | "right"

interface SelectionState {
  selectedElementIds: Readonly<Record<string, true>>
  selectedGroupIds: Readonly<Record<string, true>>
}

/** One open text editor: what the scene looked like before it opened, so commit and cancel are exact. */
interface TextSession {
  id: string
  snapshot: ReadonlyMap<string, NibElement>
  selection: SelectionState
  isNew: boolean
  draft: string | null
}

/** Document settings that undo and redo track alongside the elements. */
const HISTORY_STATE_KEYS = ["viewBackgroundColor"] as const satisfies readonly (keyof AppState)[]

/** Space a wrapping frame leaves round the selection. */
const FRAME_PADDING = 16

/** Space between a node and the one ⌘+Arrow adds next to it. */
export const FLOWCHART_GAP = 100

const FLOW_STEP: Record<FlowDirection, Point> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const ARROW_DIRECTIONS: Record<string, FlowDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
}

/** Font size limits for typed values and the ⌘⇧< / ⌘⇧> steps. */
export const MIN_FONT_SIZE = 1
export const MAX_FONT_SIZE = 1000
const FONT_SIZE_STEP = 0.1

/** Tools that cannot change the document, so view mode allows them. */
const VIEW_MODE_TOOLS: ReadonlySet<ToolType> = new Set(["selection", "hand", "laser"])

/** AppState fields the static canvas layer depends on. */
const STATIC_KEYS = [
  "viewport",
  "theme",
  "gridSize",
  "editingTextId",
  "viewBackgroundColor",
  "croppingElementId",
] as const

/** Pixels per wheel "line" (deltaMode 1), as browsers report for one notch. */
const LINE_HEIGHT_PX = 16
/** Largest zoom input taken from one wheel event; a 100px notch then zooms about 10%. */
const MAX_ZOOM_STEP = 10

const NUDGE_KEYS: Record<string, Point> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export class EditorCore {
  readonly scene = new Scene()
  readonly history = new History()
  appState: AppState = DEFAULT_APP_STATE
  host: EditorHost = {}
  /** Bumps whenever anything the static layer draws may have changed: scene, viewport, theme, grid or text editing. */
  staticVersion = 0
  /** Size of the canvas in screen pixels, reported by the host; used to place things at the viewport centre. */
  viewportSize: { width: number; height: number } | null = null
  /**
   * What `Mod` in a shortcut is, set by the host: Cmd on macOS (true), Ctrl elsewhere (false).
   * Null, the default, accepts either, for hosts that don't say.
   */
  macKeys: boolean | null = null
  /** Screen space the host's slide-show controls cover; each slide is fitted into what is left. */
  slideInsets: { top: number; right: number; bottom: number; left: number } = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }

  marquee: Bounds | null = null
  lasso: readonly Point[] | null = null
  snapLines: readonly SnapLine[] = []
  bindingHighlight: NibElement | null = null
  /** Connection dots drawn on shape borders while an arrow is being placed. */
  bindingHints: readonly Point[] = []
  frameHighlight: NibElement | null = null
  laserTrail: { p: Point; t: number }[] = []
  /** The pencil's latest correction, for the host's flash and hint; `at` is Date.now(). */
  lastCorrection: { elementId: string; at: number } | null = null
  /** Elements the eraser will delete when its stroke ends; the host draws them faded. */
  pendingEraseIds: readonly string[] = []
  /** The slide show over the board's frames while one runs; the host hides its chrome. */
  presentation: { readonly frameIds: readonly string[]; readonly index: number } | null = null
  private presentationRestore: { viewport: AppState["viewport"]; viewMode: boolean; tool: ToolType } | null =
    null

  private tool: Tool = new SelectionTool()
  private readonly panTool = new HandTool()
  private txSnapshot: ReadonlyMap<string, NibElement> | null = null
  private txDepth = 0
  /** Open levels the host began itself, such as a slider drag; tools' levels are the rest of txDepth. */
  private hostDepth = 0
  /** Host levels core had to close early; the host's own late commit or rollback of each is then a no-op. */
  private closedHostLevels = 0
  /** Inside keyDown: core's own keyboard edits are steps of their own, so they never resume a host level. */
  private keyCalls = 0
  /** Tool methods running now: transactions they begin and end belong to the tool, not the host. */
  private toolCalls = 0
  private batchDepth = 0
  private emitPending = false
  private txSelection: SelectionState | null = null
  private txState: Partial<AppState> | null = null
  private readonly entrySelections = new WeakMap<
    ElementsChange,
    { before: SelectionState; after?: SelectionState }
  >()
  private listeners = new Set<() => void>()
  private spaceHeld = false
  private panning = false
  private pointerIsDown = false
  private lastPointer: PointerInput | null = null
  private textSession: TextSession | null = null
  /** Editors the host replaced before it reported their value; a late commitText still lands. */
  private readonly parkedTextSessions = new Map<string, TextSession>()
  /** The grid the grid toggle turns back on. */
  private lastGridSize = DEFAULT_GRID_SIZE
  /** While ⌘ stays down, repeated ⌘+Arrow presses add siblings to the same node. */
  private flowAdd: { sourceId: string; lastId: string } | null = null
  /** While ⌥ stays down, repeated ⌥+Arrow presses in one direction cycle through that level. */
  private flowNav: { direction: FlowDirection; nodes: string[]; index: number } | null = null

  constructor() {
    this.scene.subscribe(() => {
      this.staticVersion++
      this.emit()
    })
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit(): void {
    if (this.batchDepth > 0) {
      this.emitPending = true
      return
    }
    for (const l of this.listeners) l()
  }

  /**
   * Runs `fn` with change notifications held back, then notifies subscribers once. Pointer and key
   * handlers and transactions run batched, so a drag of 2000 elements is one emit, not 2000.
   */
  batch<T>(fn: () => T): T {
    this.batchDepth++
    try {
      return fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0 && this.emitPending) {
        this.emitPending = false
        this.emit()
      }
    }
  }

  setAppState(patch: Partial<AppState>): void {
    const prev = this.appState
    this.appState = { ...prev, ...patch }
    // point picks belong to one line editor session
    if (
      this.appState.editingLinearElementId !== prev.editingLinearElementId &&
      !("selectedPointIndices" in patch) &&
      prev.selectedPointIndices.length > 0
    )
      this.appState = { ...this.appState, selectedPointIndices: [] }
    if (STATIC_KEYS.some((k) => prev[k] !== this.appState[k])) this.staticVersion++
    this.emit()
  }

  setViewportSize(width: number, height: number): void {
    if (this.viewportSize?.width === width && this.viewportSize.height === height) return
    this.viewportSize = { width, height }
    if (this.presentation) this.showSlide()
  }

  // --- presentation -------------------------------------------------------

  /**
   * Presents the board's frames as slides, in z-order: view mode, with each frame fitted to the
   * canvas. Starts at `fromFrameId`, else the one selected frame, else the first. False when the
   * board has no frames.
   */
  startPresentation(fromFrameId?: string): boolean {
    const frames = this.scene.getNonDeleted().filter((el) => el.type === "frame")
    if (frames.length === 0) return false
    const sel = this.selectedElements()
    const from = fromFrameId ?? (sel.length === 1 && sel[0]!.type === "frame" ? sel[0]!.id : null)
    const index = Math.max(
      0,
      frames.findIndex((f) => f.id === from),
    )
    this.presentationRestore ??= {
      viewport: this.appState.viewport,
      viewMode: this.appState.viewMode,
      tool: this.appState.activeTool,
    }
    if (!this.appState.viewMode) this.toggleViewMode()
    this.presentation = { frameIds: frames.map((f) => f.id), index }
    this.showSlide()
    return true
  }

  goToSlide(index: number): void {
    const p = this.presentation
    if (!p) return
    this.presentation = { ...p, index: clamp(Math.round(index), 0, p.frameIds.length - 1) }
    this.showSlide()
  }

  nextSlide(): void {
    if (this.presentation) this.goToSlide(this.presentation.index + 1)
  }

  previousSlide(): void {
    if (this.presentation) this.goToSlide(this.presentation.index - 1)
  }

  /** Ends the slide show and puts the view, view mode and tool back as they were before it. */
  stopPresentation(): void {
    if (!this.presentation) return
    const restore = this.presentationRestore
    this.batch(() => {
      this.presentation = null
      this.presentationRestore = null
      this.putDownPresenterTool(restore?.tool)
      if (restore && this.appState.viewMode !== restore.viewMode) this.toggleViewMode()
      if (restore) this.setAppState({ viewport: restore.viewport })
      else this.emit()
    })
  }

  /** The laser picked up during a show goes back down with it; one armed before the show stays. */
  private putDownPresenterTool(before: ToolType | undefined): void {
    if (this.appState.activeTool === "laser" && before !== "laser") this.setTool("selection")
  }

  private showSlide(): void {
    const p = this.presentation
    const frame = p ? this.scene.get(p.frameIds[p.index]!) : null
    if (!frame || frame.isDeleted) {
      this.emit()
      return
    }
    const { width, height } = this.viewportSize ?? { width: 800, height: 600 }
    const inset = this.slideInsets
    const w = Math.max(1, width - inset.left - inset.right)
    const h = Math.max(1, height - inset.top - inset.bottom)
    const b = getElementBounds(frame)
    const zoom = clamp(
      Math.min(
        Math.max(1, w - SLIDE_PADDING) / Math.max(1, b[2] - b[0]),
        Math.max(1, h - SLIDE_PADDING) / Math.max(1, b[3] - b[1]),
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    )
    this.setAppState({
      viewport: {
        zoom,
        scrollX: (inset.left + w / 2) / zoom - (b[0] + b[2]) / 2,
        scrollY: (inset.top + h / 2) / zoom - (b[1] + b[3]) / 2,
      },
    })
  }

  /** Slide keys while presenting: arrows, Page Up/Down, Space, Home/End, and Escape to stop (or put the laser down). */
  private presentationKey(e: KeyInput): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    const p = this.presentation!
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
        this.nextSlide()
        return true
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        this.previousSlide()
        return true
      case "Home":
        this.goToSlide(0)
        return true
      case "End":
        this.goToSlide(p.frameIds.length - 1)
        return true
      case "Escape":
        // the laser hint promises "Esc puts the laser down", so the first Escape does only that
        if (this.appState.activeTool === "laser") this.setTool("selection")
        else this.stopPresentation()
        return true
      default:
        return false
    }
  }

  /** Scene point at the middle of the visible canvas. */
  viewportCenter(): Point {
    const { width, height } = this.viewportSize ?? { width: 800, height: 600 }
    return screenToScene([width / 2, height / 2], this.appState.viewport)
  }

  // --- transactions -------------------------------------------------------

  /**
   * Opens an undoable step. Calls nest: only the outermost commit records, so
   * a slider drag or a command run during a gesture folds into one step. A
   * level the host opens is closed by core before undo, redo, a keyboard edit
   * or a new canvas gesture, so those never nest inside it; the host's own
   * commit for it is then a no-op.
   */
  beginTransaction(): void {
    if (this.toolCalls === 0) {
      this.resumeHostLevel()
      this.hostDepth++
    }
    if (this.txDepth++ > 0) return
    this.txSnapshot = this.scene.snapshot()
    this.txSelection = this.selectionState()
    this.txState = this.historyState()
  }
  commitTransaction(): void {
    if (this.toolCalls === 0) {
      if (this.hostDepth === 0) {
        if (this.closedHostLevels > 0) this.closedHostLevels--
        return
      }
      this.hostDepth--
    }
    this.closeLevel()
  }
  private closeLevel(): void {
    if (this.txDepth === 0) return
    if (--this.txDepth > 0) return
    const snapshot = this.txSnapshot!
    const selection = this.txSelection
    const state = this.txState ?? {}
    this.txSnapshot = null
    this.txSelection = null
    this.txState = null
    const change = ElementsChange.from(snapshot, this.scene)
    this.record(ElementsChange.withState(change, state, this.appState, HISTORY_STATE_KEYS), selection)
  }
  /** Puts the scene back as it was when the transaction opened and records nothing. */
  rollbackTransaction(): void {
    const hostCall = this.toolCalls === 0
    if (hostCall && this.hostDepth === 0) {
      if (this.closedHostLevels > 0) this.closedHostLevels--
      return
    }
    if (this.txDepth === 0) return
    const snapshot = this.txSnapshot!
    const state = this.txState
    // every open level ends here; host levels other than the caller's own are answered by no-op commits
    this.closedHostLevels += hostCall ? this.hostDepth - 1 : this.hostDepth
    this.hostDepth = 0
    this.txDepth = 0
    this.txSnapshot = null
    this.txSelection = null
    this.txState = null
    this.restoreSnapshot(snapshot)
    if (state) this.restoreHistoryState(state)
  }
  /**
   * Reopens a level core closed early while the host still holds it (an undo mid slider drag), so
   * the rest of the drag folds into one new step that the host's late commit closes.
   */
  private resumeHostLevel(): void {
    if (this.closedHostLevels === 0 || this.hostDepth > 0 || this.txDepth > 0 || this.keyCalls > 0) return
    this.closedHostLevels--
    this.hostDepth++
    this.txDepth++
    this.txSnapshot = this.scene.snapshot()
    this.txSelection = this.selectionState()
    this.txState = this.historyState()
  }
  /** Commits the levels the host has open, so what follows is a step of its own. */
  private closeHostTransactions(): void {
    while (this.hostDepth > 0) {
      this.hostDepth--
      this.closedHostLevels++
      this.closeLevel()
    }
  }
  /** Commits levels no tool owns any more, such as one a failed gesture left open, so history keeps recording. */
  private closeDanglingTransactions(): void {
    if (this.toolCalls > 0 || this.tool.hasDraft?.()) return
    while (this.txDepth > this.hostDepth) this.closeLevel()
  }
  /** Undoes everything since the transaction opened but keeps it open. */
  revertTransaction(): void {
    if (this.txSnapshot) this.restoreSnapshot(this.txSnapshot)
    if (this.txState) this.restoreHistoryState(this.txState)
  }
  get inTransaction(): boolean {
    return this.txDepth > 0
  }
  /** Element state at the start of the current drag, for frame children. */
  dragBaseline(id: string): NibElement | undefined {
    return this.txSnapshot?.get(id)
  }
  /** Runs `fn` as a single undoable step, or as part of the transaction already open. */
  transact(fn: () => void): void {
    if (this.appState.viewMode) return
    this.batch(() => {
      if (this.txDepth === 0) this.settleTextSession()
      this.beginTransaction()
      let ok = false
      try {
        fn()
        ok = true
      } finally {
        if (ok) this.commitTransaction()
        else this.rollbackTransaction()
      }
    })
  }

  /** The document settings history tracks, as they are now. */
  private historyState(): Partial<AppState> {
    const out: Record<string, unknown> = {}
    for (const k of HISTORY_STATE_KEYS) out[k] = this.appState[k]
    return out as Partial<AppState>
  }

  private restoreHistoryState(state: Partial<AppState>): void {
    if (HISTORY_STATE_KEYS.some((k) => k in state && state[k] !== this.appState[k])) this.setAppState(state)
  }

  private restoreSnapshot(snapshot: ReadonlyMap<string, NibElement>): void {
    const change = ElementsChange.from(snapshot, this.scene)
    if (!ElementsChange.isEmpty(change)) this.scene.applyChanges(ElementsChange.inverse(change))
  }

  private record(change: ElementsChange, selection: SelectionState | null): void {
    if (ElementsChange.isEmpty(change)) return
    this.history.record(change)
    if (selection) this.entrySelections.set(change, { before: selection })
  }

  private selectionState(): SelectionState {
    return {
      selectedElementIds: this.appState.selectedElementIds,
      selectedGroupIds: this.appState.selectedGroupIds,
    }
  }

  // --- tools --------------------------------------------------------------

  private makeTool(type: ToolType): Tool {
    switch (type) {
      case "selection":
        return new SelectionTool()
      case "lasso":
        return new LassoTool()
      case "hand":
        return new HandTool()
      case "freedraw":
        return new FreedrawTool()
      case "pencil":
        return new FreedrawTool({ recognize: true })
      case "text":
        return new TextTool()
      case "eraser":
        return new EraserTool()
      case "laser":
        return new LaserTool()
      case "image":
        return new ImageTool()
      case "arrow":
      case "line":
        return new LinearTool(type)
      case "parallelogram":
        return new ParallelogramTool()
      default:
        return new ShapeTool(type)
    }
  }

  setTool(type: ToolType): void {
    if (this.appState.viewMode && !VIEW_MODE_TOOLS.has(type)) return
    this.batch(() => {
      this.cancelTool()
      this.closeDanglingTransactions()
      this.tool = this.makeTool(type)
      this.setAppState({
        activeTool: type,
        editingLinearElementId: null,
        croppingElementId: null,
        // the lasso adds to what is selected when Shift is held, so arming it keeps the selection
        ...(type === "selection" || type === "lasso" ? {} : { selectedElementIds: {}, selectedGroupIds: {} }),
      })
      this.host.onToolChange?.(type)
      if (type === "image") this.requestImageInsert(this.viewportCenter())
    })
  }

  /** The image picker was dismissed: disarm the image tool. */
  cancelImageInsert(): void {
    if (this.appState.activeTool === "image") this.setTool("selection")
  }

  /** Brings the live tool in line with appState.activeTool, cancelling whatever the old one was doing. */
  private syncTool(): void {
    const want = this.appState.activeTool
    if (this.tool.type === want) return
    this.cancelTool()
    this.tool = this.makeTool(want)
  }

  /** Abandons a tool's in-progress draft so a command can run on a settled scene. */
  private interruptTool(): void {
    if (this.txDepth > 0) this.cancelTool()
  }

  private cancelTool(): void {
    this.callTool((tool) => tool.cancel(this))
  }

  /**
   * Every call into the live tool goes through here: what the tool begins and commits is the
   * tool's own, and a throw cannot leave its transaction open, which would stop history, the
   * dirty flag and autosave for the rest of the session.
   */
  private callTool<T>(fn: (tool: Tool) => T): T | undefined {
    this.toolCalls++
    try {
      return fn(this.tool)
    } catch (error) {
      this.recoverFromToolError(error)
      return undefined
    } finally {
      this.toolCalls--
    }
  }

  /** The broken gesture is undone and the tool starts afresh; only the host's own levels stay open. */
  private recoverFromToolError(error: unknown): void {
    try {
      this.tool.cancel(this)
    } catch {
      // the fresh tool below starts clean whatever state the broken one was in
    }
    this.tool = this.makeTool(this.appState.activeTool)
    if (this.txDepth > this.hostDepth) {
      if (this.hostDepth === 0) this.rollbackTransaction()
      else this.txDepth = this.hostDepth
    }
    this.setMarquee(null)
    this.setLasso(null)
    this.setSnapLines([])
    this.setBindingHighlight(null)
    this.setBindingHints([])
    this.setFrameHighlight(null)
    if (this.host.onError) this.host.onError(error)
    else (globalThis as { console?: { error(...args: unknown[]): void } }).console?.error(error)
  }

  private pansInsteadOfTool(): boolean {
    return (
      this.spaceHeld || (this.appState.viewMode && this.tool.type !== "hand" && this.tool.type !== "laser")
    )
  }

  pointerDown(p: PointerInput): void {
    this.batch(() => {
      // a pointerup the host never delivered must not leave the previous gesture open
      if (this.pointerIsDown && this.lastPointer) this.pointerUp(this.lastPointer)
      this.pointerIsDown = true
      this.lastPointer = p
      const session = this.textSession
      if (session && this.appState.editingTextId === session.id) {
        // without a draft the host commits on blur; the press must not grab the element being edited
        if (session.draft !== null) this.commitText(session.id, session.draft)
        else this.clearSelection()
      }
      this.syncTool()
      if (this.pansInsteadOfTool()) {
        this.panning = true
        this.panTool.onPointerDown(p)
        this.emit()
        return
      }
      // a gesture is a step of its own, never part of a slider drag the host left open
      this.closeHostTransactions()
      this.closeDanglingTransactions()
      this.callTool((tool) => tool.onPointerDown(p, this))
    })
  }

  /**
   * Pointer events always report detail 0, so double clicks arrive through the
   * host's dblclick handler instead of being inferred here.
   */
  doubleClick(p: PointerInput): void {
    if (this.appState.viewMode || this.spaceHeld) return
    this.batch(() => {
      this.syncTool()
      this.callTool((tool) => tool.onDoubleClick?.(p, this))
    })
  }
  pointerMove(p: PointerInput): void {
    this.batch(() => {
      // a move with no button held means the release never reached us
      if (this.pointerIsDown && p.buttons === 0) {
        this.pointerUp(p)
        return
      }
      this.lastPointer = p
      if (this.panning) {
        this.panTool.onPointerMove(p, this)
        return
      }
      this.syncTool()
      if (!this.pointerIsDown && this.pansInsteadOfTool()) return
      this.callTool((tool) => tool.onPointerMove(p, this))
    })
  }
  pointerUp(p: PointerInput): void {
    this.batch(() => {
      this.pointerIsDown = false
      this.lastPointer = p
      if (this.panning) {
        this.panning = false
        this.panTool.onPointerUp()
        this.emit()
        return
      }
      this.callTool((tool) => tool.onPointerUp(p, this))
      this.syncTool()
    })
  }
  cursor(p: PointerInput): string {
    if (this.panning) return "grabbing"
    if (this.pansInsteadOfTool()) return "grab"
    this.syncTool()
    return this.tool.cursor(p, this)
  }

  snapPoint(p: Point): Point {
    return snapToGrid(p, this.appState.gridSize)
  }

  setMarquee(b: Bounds | null): void {
    if (this.marquee === null && b === null) return
    this.marquee = b
    this.emit()
  }
  setLasso(pts: readonly Point[] | null): void {
    if (this.lasso === null && pts === null) return
    this.lasso = pts ? [...pts] : null
    this.emit()
  }
  setSnapLines(lines: readonly SnapLine[]): void {
    if (this.snapLines.length === 0 && lines.length === 0) return
    this.snapLines = lines
    this.emit()
  }
  setBindingHighlight(el: NibElement | null): void {
    if (this.bindingHighlight === el) return
    this.bindingHighlight = el
    this.emit()
  }
  setBindingHints(points: readonly Point[]): void {
    if (this.bindingHints.length === 0 && points.length === 0) return
    this.bindingHints = points
    this.emit()
  }
  setFrameHighlight(el: NibElement | null): void {
    if (this.frameHighlight === el) return
    this.frameHighlight = el
    this.emit()
  }
  pushLaserPoint(p: Point): void {
    const now = Date.now()
    this.laserTrail = [...this.laserTrail.filter((t) => now - t.t < 1000), { p, t: now }]
    this.emit()
  }
  pruneLaser(): void {
    if (this.laserTrail.length === 0) return
    const now = Date.now()
    const next = this.laserTrail.filter((t) => now - t.t < 1000)
    if (next.length !== this.laserTrail.length) {
      this.laserTrail = next
      this.emit()
    }
  }

  /** What the eraser will delete on release; the static layer draws these (and their labels) faded. */
  setPendingErase(ids: readonly string[]): void {
    const cur = this.pendingEraseIds
    if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return
    this.pendingEraseIds = [...ids]
    this.staticVersion++
    this.emit()
  }

  elementsInLasso(pts: readonly Point[]): NibElement[] {
    return lassoPick(this.scene.getNonDeleted(), pts)
  }

  // --- selection ----------------------------------------------------------

  selectedElements(opts: { includeBoundText?: boolean } = {}): NibElement[] {
    return getSelectedElements(this.scene.getNonDeleted(), this.appState, opts)
  }

  /** Applies a raw id selection, expanding it to whole groups. */
  applySelection(ids: Record<string, true>): void {
    const expanded = expandSelectionToGroups(this.scene.getNonDeleted(), ids, this.appState.editingGroupId)
    this.setAppState(expanded)
  }

  clearSelection(): void {
    this.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })
  }

  selectAll(): void {
    if (this.appState.viewMode) return
    if (this.appState.activeTool !== "selection") this.setTool("selection")
    else this.interruptTool()
    const ids: Record<string, true> = {}
    for (const el of this.scene.getNonDeleted()) {
      if (el.locked || isBoundText(el)) continue
      ids[el.id] = true
    }
    this.setAppState({ editingGroupId: null, editingLinearElementId: null })
    this.applySelection(ids)
  }

  selectElements(ids: readonly string[]): void {
    const next: Record<string, true> = {}
    for (const id of ids) next[id] = true
    this.applySelection(next)
  }

  private restoreSelection(sel: SelectionState): void {
    const ids: Record<string, true> = {}
    for (const id of Object.keys(sel.selectedElementIds)) {
      const el = this.scene.get(id)
      if (el && !el.isDeleted) ids[id] = true
    }
    this.setAppState({ selectedElementIds: ids, selectedGroupIds: sel.selectedGroupIds })
  }

  // --- element operations -------------------------------------------------

  /**
   * Deletes the selection. A deleted frame takes its children with it, as in
   * Excalidraw; pass `frameChildren: "release"` to keep them on the canvas.
   */
  deleteSelected(opts: { frameChildren?: "delete" | "release" } = {}): void {
    if (this.appState.viewMode) return
    this.batch(() => {
      this.settleTextSession()
      if (this.deleteSelectedPoints()) return
      const sel = this.selectedElements({ includeBoundText: true })
      if (sel.length === 0) return
      this.transact(() => this.deleteElements(sel, { frameChildren: opts.frameChildren ?? "delete" }))
      this.clearSelection()
      this.pruneEditingState()
    })
  }

  /**
   * Soft-deletes `els` and their labels, and repairs every reference to them:
   * arrows bound to a deleted shape are unbound (not deleted), deleted arrows
   * leave their shapes' boundElements, a deleted label leaves its container,
   * and children of a deleted frame are released, or deleted too with
   * `frameChildren: "delete"`. Returns the deleted ids.
   */
  deleteElements(
    els: readonly NibElement[],
    opts: { frameChildren?: "delete" | "release" } = {},
  ): Set<string> {
    const targets = [...els]
    if (opts.frameChildren === "delete")
      for (const el of els)
        if (el.type === "frame") targets.push(...childrenOfFrame(this.scene.getNonDeleted(), el.id))
    const ids = new Set<string>()
    for (const el of targets) {
      const cur = this.scene.get(el.id)
      if (!cur || cur.isDeleted) continue
      ids.add(cur.id)
      for (const b of cur.boundElements ?? []) {
        if (!b || b.type !== "text") continue
        const label = this.scene.get(b.id)
        if (label && !label.isDeleted) ids.add(label.id)
      }
    }
    this.scene.updateMany(this.scene.getMany(ids).map((el) => mutateElement(el, { isDeleted: true })))

    for (const id of ids) {
      const el = this.scene.get(id)!
      if (el.type === "arrow") this.unlinkArrow(el)
      if (el.type === "text" && el.containerId && !ids.has(el.containerId)) {
        const container = this.scene.get(el.containerId)
        if (container) this.scene.update(removeBoundElement(container, el.id))
      }
      if (el.type === "frame")
        for (const child of childrenOfFrame(this.scene.getNonDeleted(), el.id))
          this.scene.update(mutateElement(child, { frameId: null }))
    }
    for (const el of this.scene.getNonDeleted()) {
      if (el.type !== "arrow") continue
      const start = el.startBinding && ids.has(el.startBinding.elementId)
      const end = el.endBinding && ids.has(el.endBinding.elementId)
      if (start || end)
        this.scene.update(
          mutateElement(el, {
            ...(start ? { startBinding: null } : {}),
            ...(end ? { endBinding: null } : {}),
          }),
        )
    }
    return ids
  }

  /** The line or arrow open in the point editor, if it can be edited. */
  private editingLinear(): LinearElement | null {
    const id = this.appState.editingLinearElementId
    const el = id ? this.scene.get(id) : null
    return el && isLinearElement(el) && !el.isDeleted && !el.locked ? el : null
  }

  /**
   * Removes the vertices picked in the point editor. A closed line stays closed
   * while it keeps three corners; an arrow end that is removed lets go of its
   * shape; with fewer than two points left the element itself is deleted.
   */
  private deleteSelectedPoints(): boolean {
    const el = this.editingLinear()
    const picked = this.appState.selectedPointIndices
    if (!el || picked.length === 0) return false
    const abs = absolutePointsOf(el)
    const closed = isClosedLine(el)
    const last = abs.length - 1
    const drop = new Set(picked.map((i) => (closed && i === last ? 0 : i)))
    const kept = (closed ? abs.slice(0, -1) : abs).filter((_, i) => !drop.has(i))
    if (kept.length < 2) {
      this.setAppState({ editingLinearElementId: null })
      this.transact(() => this.deleteElements([el]))
      this.clearSelection()
      this.pruneEditingState()
      return true
    }
    const stillClosed = closed && kept.length >= 3
    this.transact(() => {
      let next = rebaseFromPoints(el, stillClosed ? [...kept, kept[0]!] : kept)
      if (closed && !stillClosed && next.type === "line") next = mutateElement(next, { polygon: false })
      if (next.type === "arrow") next = this.releaseArrowEnds(next, drop.has(0), drop.has(last))
      this.scene.update(next)
      if (next.type === "arrow") this.refreshArrow(next)
      if (closed && !stillClosed) this.releaseShapeRole(next.id)
      else this.settleShape(next.id)
    })
    this.setAppState({ selectedPointIndices: [] })
    return true
  }

  /**
   * Duplicates the vertices picked in the point editor: each copy lands halfway
   * to the next vertex (past the end for the last one) and becomes the pick.
   */
  private duplicateSelectedPoints(): boolean {
    const el = this.editingLinear()
    if (!el || this.appState.selectedPointIndices.length === 0) return false
    const abs = absolutePointsOf(el)
    const closed = isClosedLine(el)
    const last = abs.length - 1
    const picked = new Set(this.appState.selectedPointIndices.map((i) => (closed && i === last ? 0 : i)))
    const verts = closed ? abs.slice(0, -1) : abs
    const out: Point[] = []
    const selected: number[] = []
    verts.forEach((pt, i) => {
      out.push(pt)
      if (!picked.has(i)) return
      const next = verts[i + 1] ?? (closed ? verts[0] : undefined)
      const prev = verts[i - 1]
      const copy: Point = next
        ? [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2]
        : prev
          ? [pt[0] + (pt[0] - prev[0]) / 2, pt[1] + (pt[1] - prev[1]) / 2]
          : [pt[0] + 10, pt[1] + 10]
      out.push(copy)
      selected.push(out.length - 1)
    })
    this.transact(() => {
      let next = rebaseFromPoints(el, closed ? [...out, out[0]!] : out)
      // a copy past the last point is the arrow's new end, away from the shape it was bound to
      if (next.type === "arrow") next = this.releaseArrowEnds(next, false, picked.has(last))
      this.scene.update(next)
      if (next.type === "arrow") this.refreshArrow(next)
      this.settleShape(next.id)
    })
    this.setAppState({ selectedPointIndices: selected })
    return true
  }

  /** After an element's geometry changed in place: its label re-wraps and the arrows bound to it follow. */
  settleShape(id: string): void {
    this.relayoutContainer(id)
    this.refreshBoundArrows(new Set([id]))
  }

  /**
   * A line that is no longer closed stops acting as a shape: arrows bound to it
   * let go and its label becomes free text where it is.
   */
  private releaseShapeRole(id: string): void {
    const el = this.scene.get(id)
    if (!el) return
    for (const arrow of this.scene.getNonDeleted()) {
      if (arrow.type !== "arrow") continue
      const start = arrow.startBinding?.elementId === id
      const end = arrow.endBinding?.elementId === id
      if (!start && !end) continue
      this.scene.update(
        mutateElement(arrow, {
          ...(start ? { startBinding: null } : {}),
          ...(end ? { endBinding: null } : {}),
        }),
      )
    }
    const cur = this.scene.get(id)!
    const arrowRefs = (cur.boundElements ?? []).filter((b) => b?.type === "arrow")
    if (arrowRefs.length > 0)
      this.scene.update(
        mutateElement(cur, { boundElements: (cur.boundElements ?? []).filter((b) => b?.type !== "arrow") }),
      )
    this.freeLabel(id)
  }

  /** Drops an arrow's start and/or end binding and the shape's back-reference (unless the other end keeps it). */
  private releaseArrowEnds(arrow: ArrowElement, start: boolean, end: boolean): ArrowElement {
    const dropStart = start && !!arrow.startBinding
    const dropEnd = end && !!arrow.endBinding
    if (!dropStart && !dropEnd) return arrow
    const keep = new Set<string>()
    if (!dropStart && arrow.startBinding) keep.add(arrow.startBinding.elementId)
    if (!dropEnd && arrow.endBinding) keep.add(arrow.endBinding.elementId)
    for (const b of [dropStart ? arrow.startBinding : null, dropEnd ? arrow.endBinding : null]) {
      if (!b || keep.has(b.elementId)) continue
      const shape = this.scene.get(b.elementId)
      if (shape) this.scene.update(removeBoundElement(shape, arrow.id))
    }
    return mutateElement(arrow, {
      ...(dropStart ? { startBinding: null } : {}),
      ...(dropEnd ? { endBinding: null } : {}),
    })
  }

  /**
   * Pencil correction: swaps a committed freehand stroke for the clean shape the
   * recognizer found, in the current style, at the stroke's place in the z-order
   * and in its frame. Arrows bind like tool-drawn ones unless `bind` is false
   * (⌘ or Ctrl held at release). Runs as its own undoable step, so one undo
   * brings the raw stroke back. Returns the new element's id.
   */
  replaceStrokeWithShape(strokeId: string, r: Recognized, opts: { bind?: boolean } = {}): string | null {
    const stroke = this.scene.get(strokeId)
    if (!stroke || stroke.type !== "freedraw" || stroke.isDeleted || this.appState.viewMode) return null
    let id: string | null = null
    this.transact(() => {
      const cur = this.scene.get(strokeId) as FreedrawElement
      const ordered = this.scene.getElements()
      const above = ordered[ordered.findIndex((e) => e.id === strokeId) + 1]?.index ?? null
      let index: string
      try {
        index = indicesBetween(cur.index, above, 1)[0]!
      } catch {
        index = this.scene.nextIndex()
      }
      this.scene.update(mutateElement(cur, { isDeleted: true }))
      const shape = shapeFromRecognized(r, cur, this.appState, index)
      this.scene.insert(shape)
      if (!shape.frameId) this.assignFrame(shape.id)
      if (shape.type === "arrow" && opts.bind !== false)
        bindArrowEnds(this.scene.get(shape.id) as ArrowElement, this)
      id = shape.id
    })
    if (!id) return null
    this.lastCorrection = { elementId: id, at: Date.now() }
    this.emit()
    return id
  }

  duplicateSelected(): void {
    if (this.appState.viewMode) return
    this.settleTextSession()
    if (this.duplicateSelectedPoints()) return
    const sel = this.selectedElements()
    if (sel.length === 0) return
    // a frame's contents and every label go with it; only what was selected is selected after
    const take = this.withFrameChildren(sel)
    const source = this.scene.getNonDeleted().filter((el) => take.has(el.id))
    const picked = new Set(sel.map((el) => el.id))
    const ids: string[] = []
    this.transact(() => {
      const copies = this.cloneWithRelations(source, 10, 10)
      this.scene.insertMany(copies)
      source.forEach((el, i) => {
        if (picked.has(el.id)) ids.push(copies[i]!.id)
      })
    })
    this.selectElements(ids)
  }

  /**
   * Copies with fresh ids that keep their group structure, container links and
   * internal arrow bindings. Copies get keys above the scene in their original
   * z-order. A copy whose frame is not copied with it joins whichever frame its
   * new position lands in. Inside an entered group, copies stay in that group.
   */
  cloneWithRelations(source: readonly NibElement[], dx: number, dy: number): NibElement[] {
    const live = source.filter((el) => el && !el.isDeleted)
    const ordered = [...live].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
    const idMap = new Map<string, string>()
    const groupMap = new Map<string, string>()
    for (const el of live) idMap.set(el.id, randomId())
    const editing = this.appState.editingGroupId
    const remapGroups = (groupIds: readonly string[]): string[] => {
      const keepFrom = editing ? groupIds.indexOf(editing) : -1
      return groupIds.map((g, i) => {
        if (keepFrom >= 0 && i >= keepFrom) return g
        if (!groupMap.has(g)) groupMap.set(g, randomId())
        return groupMap.get(g)!
      })
    }
    const keys = this.scene.nextIndices(ordered.length)
    const keyOf = new Map(ordered.map((el, i) => [el.id, keys[i]!]))
    const scene = this.scene.getNonDeleted()

    // copies come back in the order given; their keys follow the sources' z-order
    const copies = live.map((el) => {
      const copy = duplicateElement(el, {
        id: idMap.get(el.id)!,
        x: el.x + dx,
        y: el.y + dy,
        index: keyOf.get(el.id)!,
        groupIds: remapGroups(el.groupIds ?? []),
        boundElements:
          el.boundElements
            ?.filter((b) => b && typeof b.id === "string" && idMap.has(b.id))
            .map((b) => ({ ...b, id: idMap.get(b.id)! })) ?? null,
      } as Partial<NibElement>)
      if (copy.type === "text" && copy.containerId)
        return { ...copy, containerId: idMap.get(copy.containerId) ?? null } as NibElement
      if (copy.type === "arrow") {
        return {
          ...copy,
          startBinding:
            copy.startBinding && idMap.has(copy.startBinding.elementId)
              ? { ...copy.startBinding, elementId: idMap.get(copy.startBinding.elementId)! }
              : null,
          endBinding:
            copy.endBinding && idMap.has(copy.endBinding.elementId)
              ? { ...copy.endBinding, elementId: idMap.get(copy.endBinding.elementId)! }
              : null,
        } as NibElement
      }
      return copy
    })

    const byId = new Map(copies.map((c) => [c.id, c]))
    const withFrames = copies.map((c) => {
      if (isBoundText(c)) return c
      const frameId = c.frameId && idMap.has(c.frameId) ? idMap.get(c.frameId)! : frameIdFor(scene, c)
      return frameId === c.frameId ? c : ({ ...c, frameId } as NibElement)
    })
    for (const c of withFrames) byId.set(c.id, c)
    // labels share their container's frame
    return withFrames.map((c) => {
      if (c.type !== "text" || !c.containerId) return c
      const container = byId.get(c.containerId)
      const frameId = container ? container.frameId : null
      return frameId === c.frameId ? c : { ...c, frameId }
    })
  }

  /**
   * Alt-drag: inserts a copy of each element (with its label) just above its
   * source and returns the copies, which the drag then moves. The originals
   * and their connections stay where they were.
   */
  duplicateForDrag(originals: readonly NibElement[]): NibElement[] {
    // neighbours include deleted elements so a new key never collides with a tombstone's
    const ordered = this.scene.getElements()
    const position = new Map(ordered.map((e, i) => [e.id, i]))
    // a frame's contents and every label are copied too; the drag moves the frame's copies with it
    const take = this.withFrameChildren(originals)
    const source = this.scene.getNonDeleted().filter((el) => take.has(el.id))
    const copies = this.cloneWithRelations(source, 0, 0)
    const copyOf = new Map(source.map((el, i) => [el.id, copies[i]!]))
    const sorted = [...source].sort((a, b) => position.get(a.id)! - position.get(b.id)!)
    const units: NibElement[][] = []
    for (const el of sorted) {
      if (isBoundText(el) && (el as TextElement).containerId && copyOf.has((el as TextElement).containerId!))
        continue
      const labels = sorted.filter((t) => t.type === "text" && t.containerId === el.id)
      units.push([el, ...labels])
    }
    const placed: NibElement[] = []
    let ceiling = this.scene.lastIndex()
    for (const unit of units) {
      const top = Math.max(...unit.map((e) => position.get(e.id)!))
      const below = ordered[top]!.index
      const above = ordered[top + 1]?.index ?? null
      let keys: string[]
      try {
        keys = indicesBetween(below, above, unit.length)
      } catch {
        // tied neighbours leave no gap; above everything (and every earlier fallback) can't collide
        keys = indicesBetween(ceiling, null, unit.length)
        ceiling = keys[keys.length - 1]!
      }
      unit.forEach((el, i) => placed.push({ ...copyOf.get(el.id)!, index: keys[i]! }))
    }
    this.scene.insertMany(placed)
    const picked = new Set(originals.map((o) => copyOf.get(o.id)?.id))
    return placed.filter((c) => picked.has(c.id))
  }

  group(): void {
    if (this.appState.viewMode) return
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length < 2) return
    const gid = randomId()
    const members = this.selectedElements({ includeBoundText: true })
    this.transact(() => {
      for (const el of members) this.scene.update(mutateElement(el, { groupIds: [...el.groupIds, gid] }))
      this.gatherInZOrder(new Set(members.map((e) => e.id)))
    })
    this.setAppState({ selectedGroupIds: { [gid]: true } })
  }

  /**
   * Makes `ids` contiguous just below the topmost of them, so they don't jump
   * over unrelated elements, with every label directly above its container.
   */
  private gatherInZOrder(ids: ReadonlySet<string>): void {
    const ordered = this.scene.getElements()
    const members = ordered.filter((e) => ids.has(e.id))
    if (members.length === 0) return
    const topPos = ordered.lastIndexOf(members[members.length - 1]!)
    let below: string | null = null
    for (let i = topPos - 1; i >= 0; i--) {
      if (!ids.has(ordered[i]!.id)) {
        below = ordered[i]!.index
        break
      }
    }
    const above = ordered[topPos + 1]?.index ?? null

    const labelsOf = new Map<string, NibElement[]>()
    for (const el of members)
      if (el.type === "text" && el.containerId && ids.has(el.containerId))
        labelsOf.set(el.containerId, [...(labelsOf.get(el.containerId) ?? []), el])
    const sequence: NibElement[] = []
    for (const el of members) {
      if (el.type === "text" && el.containerId && ids.has(el.containerId)) continue
      sequence.push(el, ...(labelsOf.get(el.id) ?? []))
    }
    let keys: string[]
    try {
      keys = indicesBetween(below, above, sequence.length)
    } catch {
      // tied keys from an old file leave no room; fall back to the front
      keys = this.scene.nextIndices(sequence.length)
    }
    sequence.forEach((el, i) => {
      const cur = this.scene.get(el.id)!
      if (cur.index !== keys[i]) this.scene.update(mutateElement(cur, { index: keys[i]! }))
    })
  }

  ungroup(): void {
    if (this.appState.viewMode) return
    this.settleTextSession()
    const sel = this.selectedElements({ includeBoundText: true })
    if (sel.length === 0) return
    const editing = this.appState.editingGroupId
    const remove = new Set(Object.keys(this.appState.selectedGroupIds))
    if (remove.size === 0)
      for (const el of sel) {
        const gid = outermostGroupId(el, editing)
        if (gid) remove.add(gid)
      }
    if (remove.size === 0) return
    this.transact(() => {
      for (const el of sel) {
        const next = el.groupIds.filter((g) => !remove.has(g))
        if (next.length !== el.groupIds.length) this.scene.update(mutateElement(el, { groupIds: next }))
      }
    })
    this.setAppState({
      selectedGroupIds: {},
      editingGroupId: editing && remove.has(editing) ? null : editing,
    })
    this.applySelection({ ...this.appState.selectedElementIds })
  }

  align(kind: AlignKind): void {
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length < 2) return
    this.transact(() => this.applyBulkGeometry(alignElements(sel, kind, this.appState.editingGroupId)))
  }

  distribute(axis: DistributeAxis): void {
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length < 3) return
    this.transact(() => this.applyBulkGeometry(distributeElements(sel, axis, this.appState.editingGroupId)))
  }

  flip(axis: "horizontal" | "vertical"): void {
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length === 0) return
    this.transact(() => this.applyBulkGeometry(flipElements(sel, getCommonBounds(sel), axis)))
  }

  /** Writes back elements a geometry command produced and settles labels and connections. */
  private applyBulkGeometry(updated: readonly NibElement[]): void {
    const changed = updated.filter((u) => this.scene.get(u.id) !== u)
    if (changed.length === 0) return
    this.scene.updateMany(changed)
    const ids = new Set(changed.map((e) => e.id))
    for (const el of changed) this.relayoutContainer(el.id)
    this.detachArrowsLeftBehind(ids)
    this.refreshBoundArrows(ids)
  }

  moveZ(target: "front" | "back" | "forward" | "backward"): void {
    this.settleTextSession()
    const sel = this.selectedElements({ includeBoundText: true })
    if (sel.length === 0) return
    this.transact(() => {
      const indices = computeMoveIndices(
        this.scene.getElements(),
        new Set(sel.map((e) => e.id)),
        target,
        this.appState.editingGroupId,
      )
      for (const [id, index] of indices) {
        const el = this.scene.get(id)
        if (el) this.scene.update(mutateElement(el, { index }))
      }
    })
  }

  toggleLock(): void {
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length === 0) return
    const lock = !sel.every((e) => e.locked)
    this.transact(() => {
      for (const el of sel) this.scene.update(mutateElement(el, { locked: lock }))
    })
    if (lock) this.clearSelection()
  }

  unlockElement(id: string): void {
    const el = this.scene.get(id)
    if (!el || el.isDeleted || !el.locked) return
    this.transact(() => this.scene.update(mutateElement(el, { locked: false })))
  }

  unlockAll(): void {
    this.transact(() => {
      for (const el of this.scene.getNonDeleted())
        if (el.locked) this.scene.update(mutateElement(el, { locked: false }))
    })
  }

  /**
   * Sets (or with null or blank, clears) the selection's link. Web and mail
   * links are normalised (https:// is added when no scheme is given), element
   * links are kept in their `#element=` form, and anything unsafe is refused.
   * Returns false when nothing was set.
   */
  setLink(url: string | null): boolean {
    const blank = url === null || url.trim() === ""
    const link = blank ? null : canonicalLink(url)
    if (!blank && link === null) return false
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length === 0) return false
    this.transact(() => {
      for (const el of sel) this.scene.update(mutateElement(el, { link }))
    })
    return true
  }

  /**
   * Opens a link: an element link jumps to that element on this canvas, a safe
   * web or mail link goes to the host's onOpenLink, and anything else is
   * refused. Returns whether the link was followed.
   */
  followLink(link: string): boolean {
    const id = elementIdFromLink(link)
    if (id) return this.jumpToElement(id)
    if (typeof link !== "string" || !isSafeLink(link)) return false
    this.host.onOpenLink?.(link.trim())
    return true
  }

  /**
   * Brings element `id` (a label means its container) to the middle of the
   * view, zooming out if it does not fit and in up to 100%, and selects it
   * unless it is locked or the editor is in view mode.
   */
  jumpToElement(id: string): boolean {
    let el = this.scene.get(id)
    if (!el || el.isDeleted) return false
    if (el.type === "text" && el.containerId) {
      const container = this.scene.get(el.containerId)
      if (container && !container.isDeleted) el = container
    }
    const label = getBoundText(el, (x) => this.scene.get(x))
    const b = getCommonVisualBounds(label ? [el, label] : [el])
    const { width, height } = this.viewportSize ?? { width: 800, height: 600 }
    const fit = Math.min(
      Math.max(1, width - JUMP_PADDING) / Math.max(1, b[2] - b[0]),
      Math.max(1, height - JUMP_PADDING) / Math.max(1, b[3] - b[1]),
    )
    const zoom = clamp(Math.min(fit, Math.max(1, this.appState.viewport.zoom)), MIN_ZOOM, MAX_ZOOM)
    this.setAppState({
      viewport: {
        zoom,
        scrollX: width / zoom / 2 - (b[0] + b[2]) / 2,
        scrollY: height / zoom / 2 - (b[1] + b[3]) / 2,
      },
    })
    if (this.appState.viewMode || el.locked) return true
    this.settleTextSession()
    if (this.appState.activeTool !== "selection") this.setTool("selection")
    this.setAppState({ editingGroupId: null, editingLinearElementId: null, croppingElementId: null })
    this.applySelection({ [el.id]: true })
    return true
  }

  /** Points embeddable `id` at `url` when it is a safe link to an allowlisted site; returns false otherwise. */
  setEmbeddableLink(id: string, url: string): boolean {
    const el = this.scene.get(id)
    if (!el || el.type !== "embeddable" || el.isDeleted || el.locked || this.appState.viewMode) return false
    const link = normalizeLink(url)
    if (!link || !isEmbeddableLink(link)) return false
    if (link !== el.link) this.transact(() => this.scene.update(mutateElement(el, { link })))
    return true
  }

  nudge(dx: number, dy: number): void {
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length === 0) return
    this.transact(() => {
      const ids = this.withFrameChildren(sel)
      this.scene.updateMany(
        this.scene.getMany(ids).map((el) => mutateElement(el, { x: el.x + dx, y: el.y + dy })),
      )
      this.moveBoundText(ids)
      this.detachArrowsLeftBehind(ids)
      this.refreshBoundArrows(ids, { rigid: true })
    })
  }

  /**
   * Ids of `els` plus the children of any frames among them, and the label of every element so
   * collected, each once: what a move, copy, export or library item of the selection takes along.
   */
  withFrameChildren(els: readonly NibElement[]): Set<string> {
    const ids = new Set(els.map((e) => e.id))
    for (const el of els) {
      if (el.type !== "frame") continue
      for (const child of this.frameChildren(el.id)) ids.add(child.id)
    }
    for (const id of [...ids]) {
      const el = this.scene.get(id)
      if (!el) continue
      for (const b of el.boundElements ?? []) {
        if (b?.type !== "text") continue
        const label = this.scene.get(b.id)
        if (label && !label.isDeleted && label.type === "text" && label.containerId === el.id)
          ids.add(label.id)
      }
    }
    return ids
  }

  // --- styling ------------------------------------------------------------

  /**
   * Applies style properties to the selection and makes them the defaults for
   * new elements. `arrowType: "sharp" | "round" | "elbow"` changes only arrows.
   */
  updateSelectedStyle(patch: Partial<NibElement> & Record<string, unknown>): void {
    if (this.appState.viewMode) return
    const { arrowType, ...rest } = sanitizeStylePatch(patch) as Record<string, unknown> & {
      arrowType?: AppState["currentItemArrowType"]
    }
    // the arrow-type control sends elbowed with roundness, which must not reshape rectangles
    const arrowOnlyRoundness = arrowType !== undefined || "elbowed" in rest
    const elementPatch: Record<string, unknown> = arrowType
      ? { ...rest, elbowed: arrowType === "elbow", roundness: arrowType === "round" ? { type: 2 } : null }
      : rest
    const defaults: Partial<AppState> = {
      ...styleDefaultsFor(elementPatch, arrowOnlyRoundness),
      ...(arrowType ? { currentItemArrowType: arrowType } : {}),
    }

    // a style change to the element being typed into lands in the same undo step as the text
    const session = this.textSession
    const touched =
      session && this.appState.editingTextId === session.id
        ? this.textTouchedIds(session.id, session.snapshot)
        : null
    let sel = this.selectedElements({ includeBoundText: true })
    const fold = !!touched && sel.length > 0 && sel.every((el) => touched.has(el.id))
    if (!fold) {
      this.settleTextSession()
      sel = this.selectedElements({ includeBoundText: true })
    }
    if (sel.length === 0) {
      this.setAppState(defaults)
      return
    }
    const apply = () => this.applyStylePatch(sel, elementPatch, arrowOnlyRoundness)
    if (fold) apply()
    else this.transact(apply)
    this.setAppState(defaults)
  }

  /**
   * Paste styles: applies a style copied from another element to the
   * selection as one step, each element taking what fits it (text properties
   * go to text and labels, arrowheads and arrow type to arrows, corners in the
   * element's own roundness kind). The defaults for new elements are left alone.
   */
  pasteStyles(style: Readonly<Record<string, unknown>>): void {
    if (this.appState.viewMode) return
    this.settleTextSession()
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(sanitizeStylePatch(style)))
      if (PASTE_STYLE_KEYS.has(key) && value !== undefined) patch[key] = value
    const sel = this.selectedElements({ includeBoundText: true })
    if (sel.length === 0 || Object.keys(patch).length === 0) return
    this.transact(() => this.applyStylePatch(sel, patch, false))
  }

  private applyStylePatch(
    sel: readonly NibElement[],
    patch: Record<string, unknown>,
    arrowOnlyRoundness: boolean,
  ): void {
    for (const el of sel) {
      const cur = this.scene.get(el.id) ?? el
      const applicable = filterPatchForElement(patch, cur, arrowOnlyRoundness)
      if (Object.keys(applicable).length === 0) continue
      let updated = mutateElement(cur, applicable as Partial<NibElement>)
      if (updated.type === "line" && applicable.polygon === true) updated = closeLine(updated)
      this.scene.update(updated)
      if (isPolygonLine(cur) && applicable.polygon === false) this.releaseShapeRole(cur.id)
      if (
        updated.type === "arrow" &&
        updated.elbowed &&
        ("elbowed" in applicable || "roundness" in applicable)
      )
        applyElbowRoute(updated, this)
      this.relayoutContainer(updated.id)
      if (updated.type === "text" && updated.containerId) this.relayoutContainer(updated.containerId)
    }
    this.refreshBoundArrows(new Set(sel.map((e) => e.id)))
  }

  // --- text ---------------------------------------------------------------

  startEditingText(text: TextElement): void {
    if (this.appState.viewMode) return
    this.parkTextSession()
    const existing = this.scene.get(text.id)
    const session: TextSession = {
      id: text.id,
      snapshot: this.scene.snapshot(),
      selection: this.selectionState(),
      isNew: !existing,
      draft: null,
    }
    if (!existing) {
      const frameId = text.containerId ? text.frameId : frameIdFor(this.scene.getNonDeleted(), text)
      this.scene.insert(frameId === text.frameId ? text : { ...text, frameId })
    }
    this.textSession = session
    // the edited element stays selected so the properties panel stays up while typing
    this.setAppState({
      editingTextId: text.id,
      selectedElementIds: { [text.id]: true },
      selectedGroupIds: {},
    })
    this.host.onEditText?.(this.scene.get(text.id) as TextElement, null)
  }

  startEditingLabel(container: NibElement): void {
    if (this.appState.viewMode || !canHaveLabel(container)) return
    this.parkTextSession()
    const snapshot = this.scene.snapshot()
    const selection = this.selectionState()
    let label = existingLabel(container, (id) => this.scene.get(id))
    let isNew = false
    if (!label) {
      label = createLabelFor(this, container)
      let host = this.scene.get(container.id) ?? container
      // a reference to a deleted label would shadow the new one
      const stale = getBoundTextId(host)
      if (stale) host = removeBoundElement(host, stale)
      this.scene.insert(label)
      this.scene.update(addBoundElement(host, { id: label.id, type: "text" }))
      isNew = true
    }
    this.textSession = { id: label.id, snapshot, selection, isNew, draft: null }
    this.setAppState({
      editingTextId: label.id,
      selectedElementIds: { [container.id]: true },
      selectedGroupIds: {},
    })
    this.host.onEditText?.(this.scene.get(label.id) as TextElement, this.scene.get(container.id) ?? null)
  }

  /**
   * Live text from the open editor: lays the label (and its container) out as
   * typed, without recording history, and lets a canvas click commit it.
   */
  previewText(draft: string): void {
    const session = this.textSession
    if (!session || this.appState.editingTextId !== session.id) return
    session.draft = draft
    const el = this.scene.get(session.id)
    if (!el || el.type !== "text") return
    this.layoutTextContent(mutateElement(el, { originalText: draft, text: draft }))
  }

  /** Called by the host when the text overlay closes. */
  commitText(id: string, value: string): void {
    const session = this.takeTextSession(id)
    const wasEditing = this.appState.editingTextId === id
    const el = this.scene.get(id)
    if (el && el.type === "text" && !el.isDeleted) this.applyTextCommit(el, value, session)
    if (!wasEditing) return
    const empty = value.trim() === ""
    const live = this.scene.get(id)
    const target = live && live.type === "text" && live.containerId ? live.containerId : id
    this.setAppState({
      editingTextId: null,
      selectedElementIds: empty || !live || live.isDeleted ? {} : { [target]: true },
      selectedGroupIds: {},
      activeTool: this.appState.toolLocked ? this.appState.activeTool : "selection",
    })
    this.syncTool()
  }

  cancelText(id: string): void {
    const session = this.takeTextSession(id)
    if (session) {
      this.restoreIds(session.snapshot, this.textTouchedIds(id, session.snapshot))
      if (this.appState.editingTextId === id) this.restoreSelection(session.selection)
    } else {
      const el = this.scene.get(id)
      if (el && el.type === "text" && el.containerId) {
        const container = this.scene.get(el.containerId)
        if (container && !el.originalText) this.scene.update(removeBoundElement(container, id))
      }
    }
    if (this.appState.editingTextId !== id) return
    this.setAppState({
      editingTextId: null,
      activeTool: this.appState.toolLocked ? this.appState.activeTool : "selection",
    })
    this.syncTool()
  }

  private takeTextSession(id: string): TextSession | null {
    if (this.textSession?.id === id) {
      const s = this.textSession
      this.textSession = null
      return s
    }
    const parked = this.parkedTextSessions.get(id) ?? null
    this.parkedTextSessions.delete(id)
    return parked
  }

  /** Commits the open editor when its text is known, so a command never interleaves with it. */
  private settleTextSession(): void {
    const session = this.textSession
    if (session && session.draft !== null && this.appState.editingTextId === session.id)
      this.commitText(session.id, session.draft)
  }

  /** Another editor is opening: commit the current one if its text is known, otherwise keep it for a late commit. */
  private parkTextSession(): void {
    const session = this.textSession
    if (!session) return
    if (session.draft !== null) {
      this.commitText(session.id, session.draft)
      return
    }
    this.textSession = null
    this.parkedTextSessions.set(session.id, session)
  }

  private applyTextCommit(el: TextElement, value: string, session: TextSession | null): void {
    const snapshot = session?.snapshot ?? this.scene.snapshot()
    const touched = (): Set<string> => this.textTouchedIds(el.id, snapshot)
    if (value.trim() === "" && session?.isNew) {
      // a new, empty text never existed as far as history is concerned
      const ids = touched()
      this.restoreIds(snapshot, ids)
      this.rebaseTransaction(ids)
      return
    }
    if (value.trim() === "") {
      this.scene.update(mutateElement(el, { isDeleted: true }))
      const container = el.containerId ? this.scene.get(el.containerId) : null
      if (container) this.scene.update(removeBoundElement(container, el.id))
    } else {
      this.layoutTextContent(mutateElement(el, { originalText: value, text: value }))
    }
    const ids = touched()
    this.record(
      ElementsChange.from(pick(snapshot, ids), pick(this.scene, ids)),
      session?.selection ?? this.selectionState(),
    )
    this.rebaseTransaction(ids)
  }

  /** Writes `text` and lays it (and its container and the container's arrows) out. */
  private layoutTextContent(text: TextElement): void {
    this.scene.update(text)
    const container = text.containerId ? this.scene.get(text.containerId) : null
    if (container) {
      const laid = layoutBoundText(container, text)
      this.scene.update(laid.container)
      this.scene.update(laid.text)
      if (laid.container !== container) this.refreshBoundArrows(new Set([container.id]))
    } else {
      this.scene.update(layoutStandaloneText(text))
    }
  }

  /** The text, its container and that container's arrows: everything a text edit can change. */
  private textTouchedIds(id: string, snapshot: ReadonlyMap<string, NibElement>): Set<string> {
    const ids = new Set([id])
    const text = this.scene.get(id) ?? snapshot.get(id)
    const containerId = text && text.type === "text" ? text.containerId : null
    if (!containerId) return ids
    ids.add(containerId)
    for (const c of [this.scene.get(containerId), snapshot.get(containerId)])
      for (const b of c?.boundElements ?? []) if (b && b.type === "arrow") ids.add(b.id)
    return ids
  }

  /** Puts `ids` back as they were in `snapshot` (removing ones that did not exist), without history. */
  private restoreIds(snapshot: ReadonlyMap<string, NibElement>, ids: ReadonlySet<string>): void {
    const change = ElementsChange.from(pick(this.scene, ids), pick(snapshot, ids))
    if (!ElementsChange.isEmpty(change)) this.scene.applyChanges(change)
  }

  /** A text edit recorded its own step: the open transaction must neither repeat nor undo it. */
  private rebaseTransaction(ids: ReadonlySet<string>): void {
    if (!this.txSnapshot) return
    const next = new Map(this.txSnapshot)
    for (const id of ids) {
      const el = this.scene.get(id)
      if (el) next.set(id, el)
      else next.delete(id)
    }
    this.txSnapshot = next
  }

  /** Re-wraps a container's label after the container changed. */
  relayoutContainer(id: string, opts: BoundTextLayoutOptions = {}): void {
    const el = this.scene.get(id)
    if (!el || el.isDeleted) return
    if (el.type === "text" && !el.containerId) {
      this.scene.update(layoutStandaloneText(el))
      return
    }
    const text = getBoundText(el, (x) => this.scene.get(x))
    if (!text) return
    const laid = layoutBoundText(el, text, opts)
    if (laid.container !== el) this.scene.update(laid.container)
    if (laid.text !== text) this.scene.update(laid.text)
  }

  /** Keeps labels glued to containers that moved. */
  moveBoundText(movedIds: ReadonlySet<string>): void {
    for (const id of movedIds) {
      const el = this.scene.get(id)
      if (!el) continue
      const textId = getBoundTextId(el)
      if (!textId || movedIds.has(textId)) continue
      this.relayoutContainer(id)
    }
  }

  /** One free text and one unlabelled shape or arrow, when that is exactly what is selected. */
  private textToBind(): { text: TextElement; container: NibElement } | null {
    if (this.appState.viewMode) return null
    const sel = this.selectedElements()
    if (sel.length !== 2) return null
    const text = sel.find((el): el is TextElement => el.type === "text" && !el.containerId)
    const container = sel.find((el) => el !== text && canHaveLabel(el))
    if (!text || !container || text.locked || container.locked) return null
    if (existingLabel(container, (id) => this.scene.get(id))) return null
    return { text, container }
  }

  /** Selected shapes and arrows (or their selected labels) that have a label to unbind. */
  private labelledSelection(): NibElement[] {
    if (this.appState.viewMode) return []
    const get = (id: string) => this.scene.get(id)
    const hosts = new Map<string, NibElement>()
    for (const el of this.selectedElements({ includeBoundText: true })) {
      const host = el.type === "text" && el.containerId ? get(el.containerId) : el
      if (host && !host.isDeleted && !host.locked && getBoundText(host, get)) hosts.set(host.id, host)
    }
    return [...hosts.values()]
  }

  private freeTextSelection(): TextElement[] {
    if (this.appState.viewMode) return []
    return this.selectedElements().filter(
      (el): el is TextElement => el.type === "text" && !el.containerId && !el.locked,
    )
  }

  /** Whether bindTextToContainer, unbindText and wrapTextInContainer would act, for menus. */
  canBindText(): boolean {
    return this.textToBind() !== null
  }
  canUnbindText(): boolean {
    return this.labelledSelection().length > 0
  }
  canWrapText(): boolean {
    return this.freeTextSelection().length > 0
  }

  /** With one free text and one shape or arrow selected, makes the text that element's label. */
  bindTextToContainer(): boolean {
    this.settleTextSession()
    const pair = this.textToBind()
    if (!pair) return false
    const { text, container } = pair
    this.transact(() => {
      this.transferArrowBindings(text.id, container.id)
      let host = this.scene.get(container.id)!
      // a reference to a deleted label would shadow this one
      const stale = getBoundTextId(host)
      if (stale) host = removeBoundElement(host, stale)
      host = addBoundElement(host, { id: text.id, type: "text" })
      this.scene.update(host)
      this.scene.update(
        mutateElement(this.scene.get(text.id) as TextElement, {
          containerId: host.id,
          textAlign: "center",
          verticalAlign: "middle",
          autoResize: true,
          boundElements: null,
          groupIds: [...host.groupIds],
          frameId: host.frameId,
          index: indexJustAbove(this, host),
          angle: isLinearElement(host) ? 0 : host.angle,
        }),
      )
      this.settleShape(host.id)
    })
    this.selectElements([container.id])
    return true
  }

  /** Turns the labels of the selected shapes and arrows back into free text where they are. Returns their ids. */
  unbindText(): string[] {
    this.settleTextSession()
    const hosts = this.labelledSelection()
    if (hosts.length === 0) return []
    const freed: string[] = []
    this.transact(() => {
      for (const { id } of hosts) {
        const text = this.freeLabel(id)
        if (text) freed.push(text)
      }
    })
    this.selectElements(freed)
    return freed
  }

  /** Puts each selected free text in a new shape (a rectangle unless `type` says otherwise) as its label. */
  wrapTextInContainer(type: "rectangle" | "diamond" | "ellipse" = "rectangle"): string[] {
    this.settleTextSession()
    const texts = this.freeTextSelection()
    if (texts.length === 0) return []
    const a = this.appState
    const ids: string[] = []
    this.transact(() => {
      for (const t of texts) {
        const text = this.scene.get(t.id) as TextElement
        // the inscribed text box of each shape, plus padding, holds the text without re-wrapping it
        const inner = text.width + BOUND_TEXT_PADDING * 2 + 1
        const width = type === "ellipse" ? inner * Math.SQRT2 : type === "diamond" ? inner * 2 : inner
        const height = containerMinHeight(newElement(type, { width }), text.height)
        const ordered = this.scene.getElements()
        const pos = ordered.findIndex((e) => e.id === text.id)
        let keys: string[]
        try {
          keys = indicesBetween(ordered[pos - 1]?.index ?? null, ordered[pos + 1]?.index ?? null, 2)
        } catch {
          keys = this.scene.nextIndices(2)
        }
        const cx = text.x + text.width / 2
        const cy = text.y + text.height / 2
        const container = newElement(type, {
          x: cx - width / 2,
          y: cy - height / 2,
          width,
          height,
          angle: text.angle,
          index: keys[0]!,
          strokeColor: a.currentItemStrokeColor,
          backgroundColor: a.currentItemBackgroundColor,
          fillStyle: a.currentItemFillStyle,
          strokeWidth: a.currentItemStrokeWidth,
          strokeStyle: a.currentItemStrokeStyle,
          roughness: a.currentItemRoughness,
          opacity: a.currentItemOpacity,
          roundness: a.currentItemRoundness === "round" && type !== "ellipse" ? { type: 3 } : null,
          groupIds: [...text.groupIds],
          frameId: text.frameId,
          boundElements: [{ id: text.id, type: "text" }],
        })
        this.scene.insert(container)
        this.transferArrowBindings(text.id, container.id)
        this.scene.update(
          mutateElement(this.scene.get(text.id) as TextElement, {
            containerId: container.id,
            textAlign: "center",
            verticalAlign: "middle",
            autoResize: true,
            boundElements: null,
            index: keys[1]!,
          }),
        )
        this.settleShape(container.id)
        ids.push(container.id)
      }
    })
    this.selectElements(ids)
    return ids
  }

  /** Detaches a container's label as free text in place and returns its id. */
  private freeLabel(containerId: string): string | null {
    const host = this.scene.get(containerId)
    const text = host ? getBoundText(host, (id) => this.scene.get(id)) : null
    if (!host || !text) return null
    this.scene.update(removeBoundElement(host, text.id))
    const cx = text.x + text.width / 2
    const cy = text.y + text.height / 2
    const laid = layoutStandaloneText(
      mutateElement(text, { containerId: null, text: text.originalText, autoResize: true }),
    )
    this.scene.update(mutateElement(laid, { x: cx - laid.width / 2, y: cy - laid.height / 2 }))
    return text.id
  }

  /** Re-points arrows bound to `fromId` at `toId`, as when a text becomes that shape's label. */
  private transferArrowBindings(fromId: string, toId: string): void {
    const moved: ArrowElement[] = []
    for (const el of this.scene.getNonDeleted()) {
      if (el.type !== "arrow") continue
      const start = el.startBinding?.elementId === fromId
      const end = el.endBinding?.elementId === fromId
      if (!start && !end) continue
      // an arrow already bound to `toId` at its other end would loop back onto it
      const retarget = (b: ArrowElement["startBinding"], other: ArrowElement["startBinding"]) =>
        other?.elementId === toId ? null : { ...b!, elementId: toId, fixedPoint: null }
      const next = mutateElement(el, {
        ...(start ? { startBinding: retarget(el.startBinding, el.endBinding) } : {}),
        ...(end ? { endBinding: retarget(el.endBinding, el.startBinding) } : {}),
      })
      this.scene.update(next)
      moved.push(next)
      const target = this.scene.get(toId)
      const bound = next.startBinding?.elementId === toId || next.endBinding?.elementId === toId
      if (target && bound) this.scene.update(this.linkBoundArrow(target, next.id))
    }
    const from = this.scene.get(fromId)
    if (from?.boundElements?.some((b) => b?.type === "arrow"))
      this.scene.update(
        mutateElement(from, { boundElements: from.boundElements.filter((b) => b?.type !== "arrow") }),
      )
    for (const arrow of moved) this.refreshArrow(this.scene.get(arrow.id) as ArrowElement)
  }

  /** ⌘⇧> and ⌘⇧<: steps the font size of the selected text and labels by about 10% (or the default size). */
  stepFontSize(direction: 1 | -1): void {
    if (this.appState.viewMode) return
    this.settleTextSession()
    const step = (size: number): number => {
      const scaled = Math.round(direction > 0 ? size * (1 + FONT_SIZE_STEP) : size / (1 + FONT_SIZE_STEP))
      return clamp(scaled === size ? size + direction : scaled, MIN_FONT_SIZE, MAX_FONT_SIZE)
    }
    const texts = this.selectedElements({ includeBoundText: true }).filter(
      (el): el is TextElement => el.type === "text" && !el.locked,
    )
    if (texts.length === 0) {
      this.setAppState({ currentItemFontSize: step(this.appState.currentItemFontSize) })
      return
    }
    const sizes = texts.map((t) => step(t.fontSize))
    this.transact(() => {
      texts.forEach((t, i) => {
        const cur = this.scene.get(t.id) as TextElement
        this.scene.update(mutateElement(cur, { fontSize: sizes[i]! }))
        this.settleShape(cur.containerId ?? cur.id)
      })
    })
    this.setAppState({ currentItemFontSize: sizes[0]! })
  }

  // --- arrows / bindings --------------------------------------------------

  linkBoundArrow(shape: NibElement, arrowId: string): NibElement {
    return addBoundElement(shape, { id: arrowId, type: "arrow" })
  }

  refreshArrow(arrow: ArrowElement): ArrowElement {
    if (arrow.elbowed) {
      const routed = applyElbowRoute(arrow, this)
      this.relayoutContainer(routed.id)
      return routed
    }
    const updated = updateBoundArrow(arrow, (id) => this.scene.get(id))
    if (updated !== arrow) this.scene.update(updated)
    this.relayoutContainer(updated.id)
    return updated
  }

  /**
   * Re-solves arrows bound to any of `movedIds`. With `rigid`, arrows that are
   * themselves in `movedIds` moved with their shapes and are left alone.
   */
  refreshBoundArrows(movedIds: ReadonlySet<string>, opts: { rigid?: boolean } = {}): void {
    if (movedIds.size === 0) return
    const get = (id: string) => this.scene.get(id)
    for (const el of this.scene.getNonDeleted()) {
      if (el.type !== "arrow") continue
      if (opts.rigid && movedIds.has(el.id)) continue
      const touches =
        (el.startBinding && movedIds.has(el.startBinding.elementId)) ||
        (el.endBinding && movedIds.has(el.endBinding.elementId))
      if (!touches) continue
      const cur = this.scene.get(el.id) as ArrowElement
      if (cur.elbowed) {
        // elbows are re-routed from the shapes; sliding an end along its focus ray would leave a diagonal
        const routed = applyElbowRoute(cur, this)
        this.relayoutContainer(routed.id)
        continue
      }
      const updated = updateBoundArrow(cur, get)
      if (updated !== cur) this.scene.update(updated)
      this.relayoutContainer(updated.id)
    }
  }

  /**
   * An arrow that moved while the shape it was bound to stayed put no longer
   * points at it: drop that binding so a later move of the shape can't yank it back.
   */
  detachArrowsLeftBehind(movedIds: ReadonlySet<string>): void {
    for (const id of movedIds) {
      const el = this.scene.get(id)
      if (!el || el.type !== "arrow" || el.isDeleted) continue
      const dropStart = !!el.startBinding && !movedIds.has(el.startBinding.elementId)
      const dropEnd = !!el.endBinding && !movedIds.has(el.endBinding.elementId)
      if (!dropStart && !dropEnd) continue
      const keep = new Set<string>()
      if (!dropStart && el.startBinding) keep.add(el.startBinding.elementId)
      if (!dropEnd && el.endBinding) keep.add(el.endBinding.elementId)
      for (const b of [dropStart ? el.startBinding : null, dropEnd ? el.endBinding : null]) {
        if (!b || keep.has(b.elementId)) continue
        const shape = this.scene.get(b.elementId)
        if (shape) this.scene.update(removeBoundElement(shape, el.id))
      }
      this.scene.update(
        mutateElement(el, {
          ...(dropStart ? { startBinding: null } : {}),
          ...(dropEnd ? { endBinding: null } : {}),
        }),
      )
    }
  }

  /**
   * After dragging an arrow endpoint, bind it to whatever shape it landed on:
   * to that spot when dropped deep inside, otherwise to the outline. With
   * `suppress` (⌘ or Ctrl held at release) the end is left unbound.
   */
  rebindArrowEnds(arrow: ArrowElement, movedIndex: number, opts: { suppress?: boolean } = {}): void {
    const isStart = movedIndex === 0
    const isEnd = movedIndex === arrow.points.length - 1
    if (!isStart && !isEnd) return
    const tip: Point = [arrow.x + arrow.points[movedIndex]![0], arrow.y + arrow.points[movedIndex]![1]]
    const shape = opts.suppress
      ? null
      : bindableElementAt(this.scene.getNonDeleted(), tip, this.appState.viewport.zoom, arrow.id)
    const key = isStart ? "startBinding" : "endBinding"
    const prev = isStart ? arrow.startBinding : arrow.endBinding
    const other = isStart ? arrow.endBinding : arrow.startBinding

    if (prev && (!shape || shape.id !== prev.elementId) && other?.elementId !== prev.elementId) {
      const old = this.scene.get(prev.elementId)
      if (old) this.scene.update(removeBoundElement(old, arrow.id))
    }
    // elbow routes leave from a side of the shape, so only straight and curved arrows pin to a spot
    const binding = shape
      ? createBinding(shape, arrow, isStart ? "start" : "end", undefined, { allowFixed: !arrow.elbowed })
      : null
    const updated = mutateElement(arrow, { [key]: binding } as Partial<ArrowElement>)
    this.scene.update(updated)
    if (shape) this.scene.update(this.linkBoundArrow(this.scene.get(shape.id)!, arrow.id))
    this.refreshArrow(updated)
  }

  private unlinkArrow(arrow: ArrowElement): void {
    for (const binding of [arrow.startBinding, arrow.endBinding]) {
      if (!binding) continue
      const shape = this.scene.get(binding.elementId)
      if (shape) this.scene.update(removeBoundElement(shape, arrow.id))
    }
  }

  // --- frames -------------------------------------------------------------

  nextFrameNumber(): number {
    return this.scene.getNonDeleted().filter((e) => e.type === "frame").length + 1
  }

  /** Elements that move with the frame. Labels are left out: they follow their container. */
  frameChildren(frameId: string): NibElement[] {
    return childrenOfFrame(this.scene.getNonDeleted(), frameId).filter((el) => !isBoundText(el))
  }

  captureFrameChildren(frameId: string): void {
    const frame = this.scene.get(frameId)
    if (!frame) return
    const captured = new Set<string>()
    for (const el of elementsInFrame(this.scene.getNonDeleted(), frame)) {
      if (el.type === "frame" || isBoundText(el)) continue
      this.scene.update(mutateElement(el, { frameId }))
      captured.add(el.id)
    }
    this.syncLabelFrames(captured)
  }

  /** Labels share their container's frame. */
  syncLabelFrames(containerIds: Iterable<string>): void {
    for (const id of containerIds) {
      const el = this.scene.get(id)
      if (!el) continue
      const text = getBoundText(el, (x) => this.scene.get(x))
      if (text && text.frameId !== el.frameId) this.scene.update(mutateElement(text, { frameId: el.frameId }))
    }
  }

  /** Puts a newly created element in the frame its centre lands in. */
  assignFrame(id: string): void {
    const el = this.scene.get(id)
    if (!el || el.type === "frame" || isBoundText(el)) return
    const frameId = frameIdFor(this.scene.getNonDeleted(), el)
    if (frameId !== el.frameId) this.scene.update(mutateElement(el, { frameId }))
    this.syncLabelFrames([id])
  }

  startRenamingFrame(frame: NibElement): void {
    if (frame.type !== "frame" || this.appState.viewMode) return
    this.host.onRenameFrame?.(frame)
  }

  /** Renames a frame; a blank name clears it, so the frame shows its default label. */
  setFrameName(id: string, name: string | null): void {
    const el = this.scene.get(id)
    if (!el || el.type !== "frame" || el.isDeleted || this.appState.viewMode) return
    const next = name?.trim() || null
    if (next === el.name) return
    this.transact(() => this.scene.update(mutateElement(el, { name: next })))
  }

  renameFrame(id: string, name: string): void {
    this.setFrameName(id, name)
  }

  /** Selects the unlocked contents of frame `frameId`, or of the one selected frame. Returns how many. */
  selectFrameChildren(frameId?: string): number {
    if (this.appState.viewMode) return 0
    const sel = this.selectedElements()
    const id = frameId ?? (sel.length === 1 && sel[0]!.type === "frame" ? sel[0]!.id : null)
    const frame = id ? this.scene.get(id) : null
    if (!frame || frame.type !== "frame" || frame.isDeleted) return 0
    const children = this.frameChildren(frame.id).filter((el) => !el.locked)
    if (children.length === 0) return 0
    this.settleTextSession()
    if (this.appState.activeTool !== "selection") this.setTool("selection")
    this.setAppState({ editingGroupId: null, editingLinearElementId: null })
    this.selectElements(children.map((el) => el.id))
    return children.length
  }

  /** Draws a new frame round the selection and puts the selected elements in it. Returns the frame's id. */
  wrapSelectionInFrame(): string | null {
    if (this.appState.viewMode) return null
    this.settleTextSession()
    const sel = this.selectedElements()
    if (sel.length === 0 || sel.some((el) => el.type === "frame")) return null
    const members = this.selectedElements({ includeBoundText: true })
    const b = getCommonBounds(members)
    const a = this.appState
    const frame = newElement("frame", {
      x: b[0] - FRAME_PADDING,
      y: b[1] - FRAME_PADDING,
      width: b[2] - b[0] + FRAME_PADDING * 2,
      height: b[3] - b[1] + FRAME_PADDING * 2,
      index: this.scene.nextIndex(),
      strokeColor: a.currentItemStrokeColor,
      backgroundColor: "transparent",
      strokeWidth: a.currentItemStrokeWidth,
      strokeStyle: a.currentItemStrokeStyle,
      roughness: 0,
      opacity: a.currentItemOpacity,
      name: `Frame ${this.nextFrameNumber()}`,
    })
    this.transact(() => {
      this.scene.insert(frame)
      for (const el of members) {
        const cur = this.scene.get(el.id)
        if (!cur || isBoundText(cur) || cur.frameId === frame.id) continue
        this.scene.update(mutateElement(cur, { frameId: frame.id }))
      }
      this.syncLabelFrames(members.map((el) => el.id))
    })
    this.setAppState({ editingGroupId: null })
    this.selectElements([frame.id])
    return frame.id
  }

  /** Takes the selected elements out of their frames, leaving them where they are. Returns how many. */
  removeSelectionFromFrame(): number {
    if (this.appState.viewMode) return 0
    this.settleTextSession()
    const sel = this.selectedElements().filter((el) => el.frameId && el.type !== "frame")
    if (sel.length === 0) return 0
    this.transact(() => {
      for (const el of sel) this.scene.update(mutateElement(this.scene.get(el.id)!, { frameId: null }))
      this.syncLabelFrames(sel.map((el) => el.id))
    })
    return sel.length
  }

  // --- images -------------------------------------------------------------

  /** Enters crop mode; natural dimensions come from the host's decoded bitmap. */
  startCropping(id: string, naturalWidth: number, naturalHeight: number): void {
    const el = this.scene.get(id)
    if (!el || el.type !== "image" || el.locked || this.appState.viewMode) return
    // an uncropped image shows the whole bitmap, so spelling that out is not an edit worth an undo step
    if (!el.crop) this.scene.update(mutateElement(el, { crop: fullCrop(naturalWidth, naturalHeight) }))
    this.setAppState({ croppingElementId: id, selectedElementIds: { [id]: true } })
  }

  stopCropping(): void {
    this.setAppState({ croppingElementId: null })
  }

  resetCrop(): void {
    const id = this.appState.croppingElementId
    const el = id ? this.scene.get(id) : null
    if (!el || el.type !== "image") return
    this.transact(() => this.scene.update(resetCrop(el)))
  }

  requestImageInsert(at: Point): void {
    if (this.appState.viewMode) return
    this.host.onRequestImage?.(at)
  }

  requestCrop(id: string): void {
    this.host.onRequestCrop?.(id)
  }

  insertImage(
    file: { id: string; mimeType: string; dataURL: string },
    naturalWidth: number,
    naturalHeight: number,
    at: Point,
  ): NibElement {
    const maxDim = 500
    const ratio = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight))
    const width = naturalWidth * ratio
    const height = naturalHeight * ratio
    const el = newElement("image", {
      x: at[0] - width / 2,
      y: at[1] - height / 2,
      width,
      height,
      index: this.scene.nextIndex(),
      fileId: file.id,
      status: "saved",
      opacity: this.appState.currentItemOpacity,
    })
    if (this.appState.viewMode) return el
    this.transact(() => {
      this.scene.addFile(file.id, { ...file, created: Date.now() })
      this.scene.insert(el)
      this.assignFrame(el.id)
    })
    this.setAppState({
      selectedElementIds: { [el.id]: true },
      selectedGroupIds: {},
      activeTool: "selection",
    })
    this.syncTool()
    return this.scene.get(el.id) ?? el
  }

  // --- view ---------------------------------------------------------------

  /**
   * Wheel and trackpad input. Deltas are normalised from `deltaMode` (lines,
   * pages) to pixels; a zoom step is capped so one mouse notch is about 10%
   * while trackpad pinches stay smooth; Shift turns a vertical wheel into a
   * horizontal pan.
   */
  wheel(
    dx: number,
    dy: number,
    zoomModifier: boolean,
    anchor: Point,
    opts: { deltaMode?: number; shiftKey?: boolean } = {},
  ): void {
    const unit =
      opts.deltaMode === 1 ? LINE_HEIGHT_PX : opts.deltaMode === 2 ? (this.viewportSize?.height ?? 800) : 1
    let x = dx * unit
    let y = dy * unit
    if (zoomModifier) {
      const step = Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, y))
      this.setAppState({ viewport: zoomAt(this.appState.viewport, anchor, Math.exp(-step * 0.01)) })
      return
    }
    if (opts.shiftKey && x === 0) {
      x = y
      y = 0
    }
    this.setAppState({ viewport: panBy(this.appState.viewport, -x, -y) })
  }

  zoomTo(zoom: number, anchor: Point): void {
    this.setAppState({ viewport: zoomToValue(this.appState.viewport, anchor, zoom) })
  }

  zoomToFit(width: number, height: number, onlySelection = false): void {
    const els = onlySelection ? this.selectedElements() : this.scene.getNonDeleted()
    if (els.length === 0) {
      this.setAppState({ viewport: { scrollX: 0, scrollY: 0, zoom: 1 } })
      return
    }
    this.setAppState({ viewport: fitBounds(getCommonVisualBounds(els), width, height) })
  }

  /**
   * Straightens arrows and lines: attaches loose ends to the shape they point
   * at, runs connected arrows straight between facing borders, routes the rest
   * orthogonally, and squares up anything nearly axis-aligned. Works on the
   * selection, or on everything when nothing is selected.
   */
  tidyUp(): number {
    if (this.appState.viewMode) return 0
    this.settleTextSession()
    const all = this.scene.getNonDeleted()
    const selected = this.selectedElements()
    const picked = new Set(selected.map((el) => el.id))
    const boundToPicked = (el: NibElement): boolean =>
      el.type === "arrow" &&
      ((!!el.startBinding && picked.has(el.startBinding.elementId)) ||
        (!!el.endBinding && picked.has(el.endBinding.elementId)))
    // selected shapes bring the connectors attached to them, as the shapes' "Tidy up connectors" promises
    const targets = all.filter(
      (el) => isLinearElement(el) && (selected.length === 0 || picked.has(el.id) || boundToPicked(el)),
    )
    if (targets.length === 0) return 0

    const outcome = tidyLinearElements(targets, { all, zoom: this.appState.viewport.zoom })
    if (outcome.changed === 0) return 0

    this.transact(() => {
      this.scene.updateMany(outcome.elements)
      for (const link of outcome.newLinks) {
        const shape = this.scene.get(link.shapeId)
        if (shape) this.scene.update(this.linkBoundArrow(shape, link.arrowId))
      }
      for (const el of outcome.elements) this.relayoutContainer(el.id)
    })
    return outcome.changed
  }

  /**
   * Precise geometry edit from the stats panel. Width and height scale the
   * element's own points so lines and freehand strokes follow their box. Lines
   * and arrows take a rotation into their points and keep angle 0.
   */
  setElementGeometry(
    id: string,
    patch: { x?: number; y?: number; width?: number; height?: number; angle?: number },
  ): void {
    const el = this.scene.get(id)
    if (!el || el.locked || el.isDeleted) return
    this.transact(() => {
      const width = patch.width !== undefined ? Math.max(1, patch.width) : el.width
      const height = patch.height !== undefined ? Math.max(1, patch.height) : el.height
      const next: Record<string, unknown> = {
        x: patch.x ?? el.x,
        y: patch.y ?? el.y,
        width,
        height,
        // frames never turn: their contents would stay level and be clipped by the tilted border
        angle: el.type === "frame" ? el.angle : (patch.angle ?? el.angle),
      }
      if ("points" in el && Array.isArray(el.points) && (el.width > 0 || el.height > 0)) {
        const sx = el.width === 0 ? 1 : width / el.width
        const sy = el.height === 0 ? 1 : height / el.height
        next.points = (el.points as Point[]).map((pt): Point => [pt[0] * sx, pt[1] * sy])
      }
      if (el.type === "text" && !el.containerId) {
        // text lays itself out: a width becomes its wrap width, a height scales the font
        if (patch.width !== undefined && width !== el.width) next.autoResize = false
        if (patch.height !== undefined && height !== el.height && el.height > 0)
          next.fontSize = el.fontSize * (height / el.height)
      }
      let updated = mutateElement(el, next as Partial<NibElement>)
      if (isLinearElement(updated)) updated = bakeRotation(updated)
      this.scene.update(updated)
      this.relayoutContainer(id)
      const ids = new Set([id])
      this.detachArrowsLeftBehind(ids)
      this.refreshBoundArrows(ids)
    })
  }

  /** True when the scene has content but none of it is on screen. */
  isContentOffscreen(width: number, height: number): boolean {
    const els = this.scene.getNonDeleted()
    if (els.length === 0) return false
    const visible = visibleSceneBounds(this.appState.viewport, width, height)
    return !els.some((el) => boundsIntersect(getElementBounds(el), visible))
  }

  scrollToElement(el: NibElement, width: number, height: number): void {
    const b = getElementBounds(el)
    const { zoom } = this.appState.viewport
    this.setAppState({
      viewport: {
        zoom,
        scrollX: width / zoom / 2 - (b[0] + b[2]) / 2,
        scrollY: height / zoom / 2 - (b[1] + b[3]) / 2,
      },
    })
  }

  toggleTheme(): void {
    this.setAppState({ theme: this.appState.theme === "light" ? "dark" : "light" })
  }
  toggleGrid(): void {
    if (this.appState.gridSize) this.lastGridSize = this.appState.gridSize
    this.setAppState({ gridSize: this.appState.gridSize ? null : this.lastGridSize })
  }
  /** Shows the grid at `size` (kept within sane limits), or hides it with null. */
  setGridSize(size: number | null): void {
    const next = size === null ? null : normalizeGridSize(size)
    if (next !== null) this.lastGridSize = next
    this.setAppState({ gridSize: next })
  }
  toggleSnap(): void {
    this.setAppState({ objectsSnapMode: !this.appState.objectsSnapMode })
  }
  toggleZen(): void {
    this.setAppState({ zenMode: !this.appState.zenMode })
  }
  /** View mode is read-only: entering it drops drafts, editors and the selection. */
  toggleViewMode(): void {
    const entering = !this.appState.viewMode
    if (entering) {
      const editing = this.appState.editingTextId
      if (editing) this.commitText(editing, this.textSession?.draft ?? this.currentText(editing))
      if (!VIEW_MODE_TOOLS.has(this.appState.activeTool) || this.appState.activeTool === "selection")
        this.setTool("selection")
      else this.cancelTool()
      this.setAppState({
        viewMode: true,
        selectedElementIds: {},
        selectedGroupIds: {},
        editingGroupId: null,
        editingLinearElementId: null,
        croppingElementId: null,
      })
      return
    }
    // leaving view mode by hand ends a slide show where it is
    this.presentation = null
    this.presentationRestore = null
    this.setAppState({ viewMode: false })
  }
  toggleToolLock(): void {
    this.setAppState({ toolLocked: !this.appState.toolLocked })
  }

  private currentText(id: string): string {
    const el = this.scene.get(id)
    return el && el.type === "text" ? el.originalText : ""
  }

  // --- history ------------------------------------------------------------

  undo(): void {
    if (this.appState.viewMode) return
    this.batch(() => {
      this.settleBeforeHistory()
      this.lastCorrection = null
      const after = this.selectionState()
      const change = this.history.undo(this.scene)
      if (!change) return
      if (change.state) this.setAppState(change.state.before)
      const sel = this.entrySelections.get(change)
      if (sel) {
        sel.after = after
        this.restoreSelection(sel.before)
      }
      this.pruneEditingState()
    })
  }
  redo(): void {
    if (this.appState.viewMode) return
    this.batch(() => {
      this.settleBeforeHistory()
      this.lastCorrection = null
      const change = this.history.redo(this.scene)
      if (!change) return
      if (change.state) this.setAppState(change.state.after)
      const sel = this.entrySelections.get(change)
      if (sel?.after) this.restoreSelection(sel.after)
      this.pruneEditingState()
    })
  }

  /**
   * History steps must not interleave with an open editor, an in-progress draft or a transaction
   * the host left open (a slider drag): that one is committed first, so undo takes it back whole.
   */
  private settleBeforeHistory(): void {
    const editing = this.appState.editingTextId
    if (editing) this.commitText(editing, this.textSession?.draft ?? this.currentText(editing))
    this.interruptTool()
    this.closeHostTransactions()
    this.closeDanglingTransactions()
  }

  /** Drops selection and editing modes whose elements are gone. */
  private pruneEditingState(): void {
    const live = (id: string | null): boolean => {
      if (!id) return false
      const el = this.scene.get(id)
      return !!el && !el.isDeleted
    }
    const a = this.appState
    const selectedElementIds: Record<string, true> = {}
    for (const id of Object.keys(a.selectedElementIds)) if (live(id)) selectedElementIds[id] = true
    const groups = new Set<string>()
    for (const el of this.scene.getNonDeleted()) for (const g of el.groupIds) groups.add(g)
    const selectedGroupIds: Record<string, true> = {}
    for (const g of Object.keys(a.selectedGroupIds)) if (groups.has(g)) selectedGroupIds[g] = true
    const editingTextId = live(a.editingTextId) ? a.editingTextId : null
    if (!editingTextId && this.textSession) this.textSession = null
    const editingLinearElementId =
      live(a.editingLinearElementId) && !this.scene.get(a.editingLinearElementId!)!.locked
        ? a.editingLinearElementId
        : null
    const linear = editingLinearElementId ? this.scene.get(editingLinearElementId) : null
    const pointCount = linear && isLinearElement(linear) ? linear.points.length : 0
    this.setAppState({
      selectedElementIds,
      selectedGroupIds,
      editingTextId,
      editingLinearElementId,
      selectedPointIndices: a.selectedPointIndices.filter((i) => i < pointCount),
      croppingElementId: live(a.croppingElementId) ? a.croppingElementId : null,
      editingGroupId: a.editingGroupId && groups.has(a.editingGroupId) ? a.editingGroupId : null,
    })
  }

  // --- document -----------------------------------------------------------

  /** Replaces the document. The theme is the user's preference and stays as it is. */
  loadScene(
    elements: readonly NibElement[],
    appState: Partial<AppState> = {},
    files: BinaryFiles = {},
  ): void {
    this.cancelTool()
    this.resetTransientState()
    this.scene.replaceAll(elements, files)
    this.history.clear()
    this.appState = {
      ...DEFAULT_APP_STATE,
      // tool defaults belong to the user, not the document
      ...toolDefaults(this.appState),
      ...appState,
      theme: this.appState.theme,
      toolLocked: this.appState.toolLocked,
      selectedElementIds: {},
      selectedGroupIds: {},
      editingTextId: null,
      editingLinearElementId: null,
      selectedPointIndices: [],
      editingGroupId: null,
      croppingElementId: null,
      viewMode: false,
      activeTool: "selection",
    }
    this.tool = new SelectionTool()
    this.staticVersion++
    this.emit()
  }

  private resetTransientState(): void {
    // a slider still open over the old document commits into nothing
    this.closedHostLevels += this.hostDepth
    this.hostDepth = 0
    this.txDepth = 0
    this.txSnapshot = null
    this.txSelection = null
    this.txState = null
    this.textSession = null
    this.parkedTextSessions.clear()
    this.spaceHeld = false
    this.panning = false
    this.pointerIsDown = false
    this.lastPointer = null
    this.marquee = null
    this.lasso = null
    this.snapLines = []
    this.bindingHighlight = null
    this.bindingHints = []
    this.frameHighlight = null
    this.laserTrail = []
    this.lastCorrection = null
    this.pendingEraseIds = []
    this.flowAdd = null
    this.flowNav = null
    this.presentation = null
    this.presentationRestore = null
  }

  resetScene(): void {
    this.loadScene([], { viewport: { scrollX: 0, scrollY: 0, zoom: 1 } }, {})
  }

  /** Reset canvas: clears every element and the canvas colour as one undoable step. New makes a fresh document instead. */
  resetCanvas(): void {
    if (this.appState.viewMode) return
    this.settleBeforeHistory()
    this.transact(() => {
      this.deleteElements(this.scene.getNonDeleted(), { frameChildren: "delete" })
      this.setAppState({ viewBackgroundColor: DEFAULT_APP_STATE.viewBackgroundColor })
    })
    this.setAppState({
      selectedElementIds: {},
      selectedGroupIds: {},
      editingGroupId: null,
      editingLinearElementId: null,
      croppingElementId: null,
      viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    })
    this.pruneEditingState()
  }

  /** Changes the canvas colour as an undoable step; a picker drag inside one transaction is a single step. */
  setViewBackgroundColor(color: string): void {
    if (this.appState.viewMode || typeof color !== "string" || color === this.appState.viewBackgroundColor)
      return
    this.transact(() => this.setAppState({ viewBackgroundColor: color }))
  }

  /** Adds elements as one undoable step, keyed above everything already in the scene, and selects them. */
  addElements(elements: readonly NibElement[], files: BinaryFiles = {}): void {
    if (this.appState.viewMode || elements.length === 0) return
    this.interruptTool()
    const ordered = elements
      .map((el, i) => ({ el, i }))
      .sort((a, b) => (a.el.index < b.el.index ? -1 : a.el.index > b.el.index ? 1 : a.i - b.i))
    const keys = this.scene.nextIndices(ordered.length)
    const rekeyed = ordered.map(({ el }, i) => ({ ...el, index: keys[i]! }) as NibElement)
    this.transact(() => {
      for (const [id, file] of Object.entries(files)) this.scene.addFile(id, file)
      this.scene.insertMany(rekeyed)
    })
    this.selectElements(rekeyed.filter((e) => !isBoundText(e) && !e.isDeleted).map((e) => e.id))
  }

  /**
   * Inserts another scene into this one as one undoable step: fresh ids, groups
   * and bindings re-keyed, z-indices above everything, centred on `at` when given.
   */
  insertScene(elements: readonly NibElement[], files: BinaryFiles = {}, at?: Point): NibElement[] {
    if (this.appState.viewMode) return []
    const live = elements.filter((e) => e && !e.isDeleted)
    if (live.length === 0) return []
    let dx = 0
    let dy = 0
    if (at) {
      const b = getCommonBounds(live)
      dx = at[0] - (b[0] + b[2]) / 2
      dy = at[1] - (b[1] + b[3]) / 2
    }
    const editing = this.appState.editingGroupId
    if (editing) this.setAppState({ editingGroupId: null })
    const copies = this.cloneWithRelations(live, dx, dy)
    this.addElements(copies, files)
    return copies.map((c) => this.scene.get(c.id) ?? c)
  }

  // --- flowcharts ---------------------------------------------------------

  /**
   * ⌘+Arrow: adds a shape like `fromId` (default: the one selected shape) on
   * that side of it, joined by a bound elbow arrow, selects it and scrolls it
   * into view. A side that is taken fans the new shape out beside the others,
   * clear of everything. Returns the new shape's id.
   */
  createLinkedNode(direction: FlowDirection, fromId?: string): string | null {
    if (this.appState.viewMode) return null
    this.settleTextSession()
    const sel = this.selectedElements()
    const source = fromId ? this.scene.get(fromId) : sel.length === 1 ? sel[0] : undefined
    if (!source || source.isDeleted || source.locked || !isFlowNode(source)) return null
    const [x, y] = this.placeLinkedNode(source, direction)
    const a = this.appState
    let nodeId: string | null = null
    this.transact(() => {
      const keys = this.scene.nextIndices(2)
      const node = newElement(source.type, {
        x,
        y,
        width: source.width,
        height: source.height,
        index: keys[0]!,
        strokeColor: source.strokeColor,
        backgroundColor: source.backgroundColor,
        fillStyle: source.fillStyle,
        strokeWidth: source.strokeWidth,
        strokeStyle: source.strokeStyle,
        roughness: source.roughness,
        opacity: source.opacity,
        roundness: source.roundness,
        ...(source.type === "line" ? { points: source.points, polygon: true } : {}),
      })
      this.scene.insert(node)
      this.assignFrame(node.id)
      const [dx, dy] = FLOW_STEP[direction]
      const from = edgeMidpoint(source, dx, dy)
      const to = edgeMidpoint(node, -dx, -dy)
      let arrow = rebaseFromPoints(
        newElement("arrow", {
          index: keys[1]!,
          strokeColor: a.currentItemStrokeColor,
          strokeWidth: a.currentItemStrokeWidth,
          strokeStyle: a.currentItemStrokeStyle,
          roughness: 0,
          opacity: a.currentItemOpacity,
          roundness: null,
          startArrowhead: a.currentItemStartArrowhead,
          endArrowhead: a.currentItemEndArrowhead,
          elbowed: true,
        }),
        [from, to],
      )
      arrow = mutateElement(arrow, {
        startBinding: createBinding(source, arrow, "start"),
        endBinding: createBinding(node, arrow, "end"),
      })
      this.scene.insert(arrow)
      for (const id of [source.id, node.id])
        this.scene.update(this.linkBoundArrow(this.scene.get(id)!, arrow.id))
      this.refreshArrow(arrow)
      this.assignFrame(arrow.id)
      nodeId = node.id
    })
    if (!nodeId) return null
    if (this.appState.activeTool !== "selection") this.setTool("selection")
    this.setAppState({ editingGroupId: null, editingLinearElementId: null })
    this.selectElements([nodeId])
    this.revealElement(nodeId)
    return nodeId
  }

  /**
   * ⌥+Arrow: selects the shape connected to the selected one on that side.
   * Pressing the same direction again while ⌥ is held cycles through the
   * shapes found there. Returns the id now selected, or null.
   */
  navigateLinked(direction: FlowDirection): string | null {
    if (this.appState.viewMode) return null
    const sel = this.selectedElements()
    if (sel.length !== 1) return null
    const current = sel[0]!
    const nav = this.flowNav
    let id: string
    if (nav && nav.direction === direction && nav.nodes[nav.index] === current.id && nav.nodes.length > 1) {
      nav.index = (nav.index + 1) % nav.nodes.length
      id = nav.nodes[nav.index]!
    } else {
      const nodes = this.linkedNodesToward(current, direction)
      if (nodes.length === 0) return null
      this.flowNav = { direction, nodes, index: 0 }
      id = nodes[0]!
    }
    this.settleTextSession()
    if (this.appState.activeTool !== "selection") this.setTool("selection")
    this.setAppState({ editingGroupId: null, editingLinearElementId: null })
    this.selectElements([id])
    this.revealElement(id)
    return id
  }

  /** Top-left for a node beside `source`: straight out first, then fanning out until clear of everything. */
  private placeLinkedNode(source: NibElement, direction: FlowDirection): Point {
    const b = getElementBounds(source)
    const [dx, dy] = FLOW_STEP[direction]
    const w = source.width
    const h = source.height
    const base: Point = [
      (b[0] + b[2]) / 2 + dx * ((b[2] - b[0]) / 2 + FLOWCHART_GAP + w / 2),
      (b[1] + b[3]) / 2 + dy * ((b[3] - b[1]) / 2 + FLOWCHART_GAP + h / 2),
    ]
    const spread = dx !== 0 ? h + FLOWCHART_GAP / 2 : w + FLOWCHART_GAP / 2
    const blockers = this.scene
      .getNonDeleted()
      .filter(
        (el) =>
          el.id !== source.id &&
          (!isLinearElement(el) || isPolygonLine(el)) &&
          !isBoundText(el) &&
          el.type !== "frame",
      )
      .map(getElementBounds)
    for (let i = 0; i <= 40; i++) {
      // 0, +1, -1, +2, -2…: siblings alternate either side of the straight-out spot
      const k = i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -i / 2
      const cx = base[0] + Math.abs(dy) * k * spread
      const cy = base[1] + Math.abs(dx) * k * spread
      const box: Bounds = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
      const room = expandBounds(box, FLOWCHART_GAP / 4)
      if (!blockers.some((o) => boundsIntersect(room, o))) return [box[0], box[1]]
    }
    return [base[0] - w / 2, base[1] - h / 2]
  }

  /**
   * Shapes joined to `node` by an arrow that leaves `node` from its
   * `direction` side, nearest first; failing those, connected shapes lying
   * within 45° of that direction.
   */
  private linkedNodesToward(node: NibElement, direction: FlowDirection): string[] {
    const nb = getElementBounds(node)
    const c: Point = [(nb[0] + nb[2]) / 2, (nb[1] + nb[3]) / 2]
    const [dx, dy] = FLOW_STEP[direction]
    const found = new Map<string, { along: number; across: number; side: FlowDirection }>()
    for (const el of this.scene.getNonDeleted()) {
      if (el.type !== "arrow") continue
      const fromStart = el.startBinding?.elementId === node.id
      const other = fromStart ? el.endBinding?.elementId : el.startBinding?.elementId
      if (!fromStart && el.endBinding?.elementId !== node.id) continue
      if (!other || other === node.id || found.has(other)) continue
      const target = this.scene.get(other)
      if (!target || target.isDeleted || target.locked) continue
      const pts = absolutePointsOf(el)
      const tb = getElementBounds(target)
      const vx = (tb[0] + tb[2]) / 2 - c[0]
      const vy = (tb[1] + tb[3]) / 2 - c[1]
      found.set(other, {
        along: vx * dx + vy * dy,
        across: vx * dy - vy * dx,
        side: sideOf(nb, fromStart ? pts[0]! : pts[pts.length - 1]!),
      })
    }
    const all = [...found.entries()]
    const leaving = all.filter(([, v]) => v.side === direction)
    const ahead =
      leaving.length > 0 ? leaving : all.filter(([, v]) => v.along > 0 && Math.abs(v.across) <= v.along)
    return ahead
      .sort(
        ([, a], [, b]) =>
          Math.hypot(a.along, a.across) - Math.hypot(b.along, b.across) || a.across - b.across,
      )
      .map(([id]) => id)
  }

  /** Pans (keeping the zoom) so element `id` is in view when it is not already. */
  private revealElement(id: string): void {
    const el = this.scene.get(id)
    if (!el) return
    const { width, height } = this.viewportSize ?? { width: 800, height: 600 }
    const visible = visibleSceneBounds(this.appState.viewport, width, height)
    if (!boundsContainBounds(visible, getElementBounds(el))) this.scrollToElement(el, width, height)
  }

  // --- keyboard -----------------------------------------------------------

  keyDown(e: KeyInput): boolean {
    if (this.appState.editingTextId) return false
    this.keyCalls++
    try {
      return this.batch(() => this.handleKey(e))
    } finally {
      this.keyCalls--
    }
  }

  /**
   * Runs a keyboard edit the host dispatches itself (the shell's ⇧H flip, ⌥T, ⇧⌘L, ⌥⌘V) as keyDown runs
   * core's own: a step of its own, never folded into a level the host left open, such as a slider drag.
   */
  runKeyCommand<T>(run: () => T): T {
    this.keyCalls++
    try {
      this.closeHostTransactions()
      return run()
    } finally {
      this.keyCalls--
    }
  }

  private handleKey(e: KeyInput): boolean {
    if (this.presentation && this.presentationKey(e)) return true
    const view = this.appState.viewMode
    if (!view && this.callTool((tool) => tool.onKeyDown?.(e, this))) {
      this.syncTool()
      return true
    }
    // Escape and Space work whatever modifiers happen to be held
    if (e.key === "Escape") return this.escape()
    const mod = e.metaKey || e.ctrlKey
    if (!mod && (e.key === " " || e.code === "Space")) {
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.emit()
      }
      return true
    }

    const id = matchShortcut(e, undefined, this.macKeys)
    const tool = id ? SHORTCUT_TOOLS[id] : undefined
    if (tool) {
      // switching now would cancel the stroke, shape or move under the pointer
      if (this.pointerIsDown || (view && !VIEW_MODE_TOOLS.has(tool))) return true
      this.setTool(tool)
      return true
    }

    const nudge = this.nudgeFor(e)
    const isEdit = nudge !== null || (id !== null && CORE_EDIT_COMMANDS.has(id))
    if (!isEdit) {
      if (id === "view.snap") {
        this.toggleSnap()
        return true
      }
      if (id === "view.grid") {
        this.toggleGrid()
        return true
      }
      if (id === "flow.navigate") {
        // swallowed even when nothing is connected: Alt+Left would otherwise be the browser's Back
        const dir = ARROW_DIRECTIONS[e.key]
        if (dir && !view) this.navigateLinked(dir)
        return true
      }
      const page = id ? PAGE_SCROLL[id] : undefined
      if (page) {
        const { width, height } = this.viewportSize ?? { width: 800, height: 600 }
        this.setAppState({ viewport: panBy(this.appState.viewport, -page[0] * width, -page[1] * height) })
        return true
      }
      // the host normally runs these; a chord only core's matcher recognises (German ⌘+) still zooms
      const zoom = id ? KEY_ZOOM[id] : undefined
      if (zoom) {
        const { width, height } = this.viewportSize ?? { width: 800, height: 600 }
        this.zoomTo(zoom(this.appState.viewport.zoom), [width / 2, height / 2])
        return true
      }
      return false
    }
    // edits are swallowed in view mode and while a pointer gesture is under way
    if (view || this.pointerIsDown) return true
    if (id !== "selection.all") {
      this.interruptTool()
      // a keyboard edit is recorded as its own step, not folded into a slider drag the host left open
      this.closeHostTransactions()
    }

    if (nudge) {
      this.nudge(nudge[0], nudge[1])
      return true
    }
    switch (id) {
      case "history.undo":
        this.undo()
        break
      case "history.redo":
        this.redo()
        break
      case "selection.all":
        this.selectAll()
        break
      case "edit.duplicate":
        this.duplicateSelected()
        break
      case "edit.delete":
        this.deleteSelected()
        break
      case "arrange.group":
        this.group()
        break
      case "arrange.ungroup":
        this.ungroup()
        break
      case "arrange.forward":
        this.moveZ("forward")
        break
      case "arrange.backward":
        this.moveZ("backward")
        break
      case "arrange.front":
        this.moveZ("front")
        break
      case "arrange.back":
        this.moveZ("back")
        break
      case "arrange.alignLeft":
        this.align("left")
        break
      case "arrange.alignRight":
        this.align("right")
        break
      case "arrange.alignTop":
        this.align("top")
        break
      case "arrange.alignBottom":
        this.align("bottom")
        break
      case "style.fontSizeUp":
        this.stepFontSize(1)
        break
      case "style.fontSizeDown":
        this.stepFontSize(-1)
        break
      case "flow.addNode":
        this.addLinkedNodeFromKeyboard(e)
        break
    }
    return true
  }

  /** While ⌘ stays held, each ⌘+Arrow adds another sibling to the shape the first press started from. */
  private addLinkedNodeFromKeyboard(e: KeyInput): void {
    const dir = ARROW_DIRECTIONS[e.key]
    if (!dir) return
    const sel = this.selectedElements()
    const add = this.flowAdd
    const source = add ? this.scene.get(add.sourceId) : undefined
    const sibling = !!add && !!source && !source.isDeleted && sel.length === 1 && sel[0]!.id === add.lastId
    const sourceId = sibling ? add!.sourceId : sel.length === 1 ? sel[0]!.id : null
    if (!sourceId) return
    const created = this.createLinkedNode(dir, sourceId)
    if (created) this.flowAdd = { sourceId, lastId: created }
  }

  /** Arrow keys move by 1px (Shift: 10px), or by one grid cell (Shift: five) when the grid is on. */
  private nudgeFor(e: KeyInput): Point | null {
    const dir = NUDGE_KEYS[e.key]
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return null
    const grid = this.appState.gridSize
    const step = grid ? (e.shiftKey ? grid * 5 : grid) : e.shiftKey ? 10 : 1
    return [dir[0] * step, dir[1] * step]
  }

  private escape(): boolean {
    this.cancelTool()
    const a = this.appState
    if (a.croppingElementId) {
      this.setAppState({ croppingElementId: null })
      return true
    }
    if (a.editingLinearElementId) {
      this.setAppState({ editingLinearElementId: null })
      return true
    }
    if (a.editingGroupId) {
      // leaving a group selects it as a whole
      const gid = a.editingGroupId
      this.setAppState({ editingGroupId: null })
      const members: Record<string, true> = {}
      for (const el of this.scene.getNonDeleted()) if (el.groupIds.includes(gid)) members[el.id] = true
      this.applySelection(members)
      return true
    }
    this.clearSelection()
    if (a.activeTool !== "selection") this.setTool("selection")
    return true
  }

  keyUp(e: KeyInput): void {
    if (e.key === "Meta" || e.key === "Control") this.flowAdd = null
    if (e.key === "Alt") this.flowNav = null
    if ((e.key === " " || e.code === "Space") && this.spaceHeld) {
      this.spaceHeld = false
      this.emit()
    }
  }
}

/** Shortcuts core runs itself that change the document. */
const CORE_EDIT_COMMANDS: ReadonlySet<string> = new Set([
  "history.undo",
  "history.redo",
  "selection.all",
  "edit.duplicate",
  "edit.delete",
  "arrange.group",
  "arrange.ungroup",
  "arrange.forward",
  "arrange.backward",
  "arrange.front",
  "arrange.back",
  "arrange.alignLeft",
  "arrange.alignRight",
  "arrange.alignTop",
  "arrange.alignBottom",
  "style.fontSizeUp",
  "style.fontSizeDown",
  "flow.addNode",
])

/** The factor one zoom-in key press or button applies. */
export const KEY_ZOOM_STEP = 1.2

/** Keyboard zooms, as the next zoom from the current one, about the middle of the viewport. */
const KEY_ZOOM: Readonly<Record<string, (zoom: number) => number>> = {
  "view.zoomIn": (z) => z * KEY_ZOOM_STEP,
  "view.zoomOut": (z) => z / KEY_ZOOM_STEP,
  "view.zoomReset": () => 1,
}

/** Page scrolls, as fractions of the viewport (x, y). */
const PAGE_SCROLL: Readonly<Record<string, Point>> = {
  "view.pageUp": [0, -1],
  "view.pageDown": [0, 1],
  "view.pageLeft": [-1, 0],
  "view.pageRight": [1, 0],
}

/** Shapes ⌘+Arrow can grow a flowchart from, closed lines (parallelograms, pencil polygons) included. */
const isFlowNode = (
  el: NibElement,
): el is Extract<NibElement, { type: "rectangle" | "diamond" | "ellipse" }> | LineElement =>
  el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse" || isPolygonLine(el)

/** The side of box `b` that point `p` (an arrow end attached to it) is on. */
const sideOf = (b: Bounds, p: Point): FlowDirection => {
  const nx = (p[0] - (b[0] + b[2]) / 2) / Math.max(1, (b[2] - b[0]) / 2)
  const ny = (p[1] - (b[1] + b[3]) / 2) / Math.max(1, (b[3] - b[1]) / 2)
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? "right" : "left"
  return ny >= 0 ? "down" : "up"
}

/** Middle of the side of `el`'s box that faces (dx, dy), moved in onto the outline of a closed line. */
const edgeMidpoint = (el: NibElement, dx: number, dy: number): Point => {
  const b = getElementBounds(el)
  const c: Point = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  const mid: Point = [c[0] + (dx * (b[2] - b[0])) / 2, c[1] + (dy * (b[3] - b[1])) / 2]
  if (!isPolygonLine(el)) return mid
  // a slanted or pointed side lies inside the box, and the arrow must meet the edge that is drawn
  return attachAlongRay(el, [mid[0] + dx, mid[1] + dy], c, 0) ?? mid
}

/** A storable form of `url`: element links in their `#element=` form, other links normalised, or null. */
const canonicalLink = (url: string): string | null => {
  const id = elementIdFromLink(url)
  return id ? elementLink(id) : normalizeLink(url)
}

const toolDefaults = (a: AppState): Partial<AppState> =>
  Object.fromEntries(Object.entries(a).filter(([key]) => key.startsWith("currentItem"))) as Partial<AppState>

/** Screen room kept round a frame shown as a slide. */
const SLIDE_PADDING = 48

/** Room kept round an element that a link jumps to. */
const JUMP_PADDING = 80

/** `ids` of `src` as a map, for diffing just the elements an edit touched. */
const pick = (
  src: Scene | ReadonlyMap<string, NibElement>,
  ids: ReadonlySet<string>,
): Map<string, NibElement> => {
  const out = new Map<string, NibElement>()
  for (const id of ids) {
    const el = src.get(id)
    if (el) out.set(id, el)
  }
  return out
}

const STYLE_TO_DEFAULT: Record<string, keyof AppState> = {
  strokeColor: "currentItemStrokeColor",
  backgroundColor: "currentItemBackgroundColor",
  fillStyle: "currentItemFillStyle",
  strokeWidth: "currentItemStrokeWidth",
  strokeStyle: "currentItemStrokeStyle",
  roughness: "currentItemRoughness",
  opacity: "currentItemOpacity",
  fontFamily: "currentItemFontFamily",
  fontSize: "currentItemFontSize",
  textAlign: "currentItemTextAlign",
  startArrowhead: "currentItemStartArrowhead",
  endArrowhead: "currentItemEndArrowhead",
}

const styleDefaultsFor = (patch: Record<string, unknown>, arrowOnlyRoundness: boolean): Partial<AppState> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const target = STYLE_TO_DEFAULT[key]
    if (target) out[target] = value
  }
  if ("roundness" in patch && !arrowOnlyRoundness)
    out.currentItemRoundness = patch.roundness ? "round" : "sharp"
  return out as Partial<AppState>
}

/** Text properties must not leak onto shapes, and vice versa. */
const filterPatchForElement = (
  patch: Record<string, unknown>,
  el: NibElement,
  arrowOnlyRoundness: boolean,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (TEXT_ONLY.has(key) && el.type !== "text") continue
    if (ARROW_ONLY.has(key) && el.type !== "arrow") continue
    if (key === "polygon" && el.type !== "line") continue
    // text and freehand strokes never paint a background, so storing one only makes hit areas lie
    if (key === "backgroundColor" && (el.type === "text" || el.type === "freedraw")) continue
    // frames are drawn as a plain border whatever their fill or roughness says
    if (el.type === "frame" && FRAME_FIXED.has(key)) continue
    if (key === "strokeColor" && el.type === "text" && patch.__skipTextColor) continue
    if (key.startsWith("__")) continue
    if (key === "roundness") {
      if (arrowOnlyRoundness && el.type !== "arrow") continue
      const elbowed = el.type === "arrow" && ((patch.elbowed as boolean | undefined) ?? el.elbowed)
      const kind = roundnessKind(el)
      if (kind === null || (elbowed && value)) continue
      const r = value as { type?: number; value?: number } | null
      out.roundness = !r ? null : r.type === kind ? r : { type: kind }
      continue
    }
    out[key] = value
  }
  return out
}

/** The roundness type an element's corners use (3 for boxes and diamonds, 2 for paths), or null for none. */
const roundnessKind = (el: NibElement): 2 | 3 | null => {
  if (el.type === "rectangle" || el.type === "diamond" || el.type === "embeddable") return 3
  if (el.type === "line" || el.type === "arrow") return 2
  return null
}

/** Drops style values that would corrupt an element (a NaN or negative font size), clamping the rest. */
const sanitizeStylePatch = <T extends Readonly<Record<string, unknown>>>(patch: T): T => {
  if (!("fontSize" in patch)) return patch
  const { fontSize, ...rest } = patch as Record<string, unknown>
  if (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize <= 0) return rest as T
  return { ...rest, fontSize: clamp(fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE) } as unknown as T
}

/** What paste styles carries; geometry, ids and links never travel with a style. */
const PASTE_STYLE_KEYS: ReadonlySet<string> = new Set([
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
  "fontFamily",
  "fontSize",
  "textAlign",
  "verticalAlign",
  "lineHeight",
  "startArrowhead",
  "endArrowhead",
  "elbowed",
])

const FRAME_FIXED: ReadonlySet<string> = new Set(["backgroundColor", "fillStyle", "roughness", "roundness"])

/** A polygon line whose last point repeats its first. */
const isClosedLine = (el: LinearElement): boolean => {
  if (el.type !== "line" || !el.polygon || el.points.length < 4) return false
  const first = el.points[0]!
  const last = el.points[el.points.length - 1]!
  return first[0] === last[0] && first[1] === last[1]
}

/** A closed line ends where it starts, so its outline (and fill) is a proper polygon. */
const closeLine = (line: LineElement): LineElement => {
  const pts = line.points
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (!first || !last || pts.length < 3) return line
  if (first[0] === last[0] && first[1] === last[1]) return line
  return { ...line, points: [...pts, [first[0], first[1]] as Point] }
}

const TEXT_ONLY = new Set(["fontSize", "fontFamily", "textAlign", "verticalAlign", "lineHeight"])
const ARROW_ONLY = new Set(["startArrowhead", "endArrowhead", "elbowed"])

export { isLinearElement, normalizeLinear }
