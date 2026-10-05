import {
  type CanvasPalette,
  type EditorCore,
  type NibElement,
  type Point,
  type PointerInput,
  ShapeCache,
  asCanvas2D,
  elementAtPoint,
  embedSource,
  getCommonBounds,
  panBy,
  renderInteractiveScene,
  renderStaticScene,
  sceneToScreen,
  screenToScene,
} from "@nib/core"
import { type ReactNode, useEffect, useId, useRef } from "react"
import { isModalOpen } from "../hooks/useLayer"
import { isTypingTarget } from "../hooks/useShortcuts"
import "./canvas.css"
import { elementPicker } from "./elementPicker"
import { embedState } from "./embedState"
import { canvasGesture } from "./gestureState"
import { MiddlePan, type PointerKind, PointerRouter, gestureViewport, pinchViewport } from "./gestures"
import {
  type ContextSelection,
  linkBadgeAt,
  linkToFollow,
  pressHitsHandle,
  resolveContextTarget,
} from "./hitTargets"
import type { ImageCache } from "./imageCache"
import { followLink } from "./links"
import { canvasFontsVersion, onCanvasFontsChange } from "./measure"
import { type StaticKey, backingSize, correctionFlashAt, staticKeyChanged } from "./paint"
import { textNeedingRelayout } from "./textRelayout"

/** What a context menu opened on: where (window coordinates) and the element under the pointer. */
export interface CanvasContextTarget {
  x: number
  y: number
  scene: Point
  /** The element under the pointer, locked ones included; null for empty board or a keyboard open. */
  element: NibElement | null
  source: "pointer" | "keyboard"
}

interface Props {
  core: EditorCore
  images: ImageCache
  /** The selection already follows the pointer when this is called; build the menu from `target`. */
  onContextMenu(e: React.MouseEvent, target: CanvasContextTarget): void
  onSizeChange?(size: { width: number; height: number }): void
  /** Opener for web links when the core host has none; links normally open through core.host.onOpenLink. */
  onOpenLink?(url: string): void
  /** A link core refused to open (unsafe scheme), for a toast. */
  onLinkRefused?(link: string): void
  /** The theme's canvas colours (canvasPaletteFor); defaults follow the canvas mode. */
  palette?: CanvasPalette
  searchMatches?: readonly string[]
  activeSearchMatch?: string | null
  /** The frame whose inline rename field is open; its drawn name is hidden under the field. */
  renamingFrameId?: string | null
  /** Overlays in canvas pixels: TextEditorOverlay, FrameNameOverlay, EmbedOverlay (which sorts itself under
   *  the interactive layer). */
  children?: ReactNode
}

/** Tools whose strokes follow every coalesced pointer sample for a smooth line. */
const SAMPLED_TOOLS = new Set(["freedraw", "pencil", "laser", "eraser", "lasso"])

const TEXT_EDITOR = "[data-text-editor]"

/** Screen px a press may travel and still count as the click that wakes an embed. */
const EMBED_CLICK_SLOP = 4

interface PointerLike {
  clientX: number
  clientY: number
  buttons: number
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  detail: number
  pressure?: number
}

interface GestureEventLike extends Event {
  scale: number
  clientX?: number
  clientY?: number
}

// the Preferences override (applyMotionPreference marks the root) stops scripted motion as well as CSS
const reducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  (document.documentElement.dataset.nibMotion === "reduce" ||
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)

/**
 * Canvas presses are preventDefault-ed so they never move focus (the text editor that opens on
 * release keeps it), so whatever else was focused (a rename field, a tray button) is released here.
 */
const releaseFocus = (): void => {
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body || active.closest?.(TEXT_EDITOR)) return
  active.blur?.()
}

/** Ends an open text edit the way leaving the editor does, before a menu or another gesture takes over. */
const commitTextEditor = (): void => {
  const active = document.activeElement as HTMLElement | null
  if (active?.closest?.(TEXT_EDITOR)) active.blur()
}

/** Synthetic pointers (and ones already released) cannot be captured; the gesture then runs uncaptured. */
const capture = (target: Element, id: number): boolean => {
  try {
    target.setPointerCapture(id)
    return true
  } catch {
    return false
  }
}

const holdsCapture = (target: Element, id: number): boolean => {
  try {
    return target.hasPointerCapture(id)
  } catch {
    return false
  }
}

export function CanvasHost(props: Props) {
  const { core, images, children } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const interactiveRef = useRef<HTMLCanvasElement>(null)
  const shapeCache = useRef(new ShapeCache())
  const frame = useRef(0)
  const lastStatic = useRef<StaticKey | null>(null)
  const schedule = useRef<() => void>(() => {})
  const latest = useRef(props)
  latest.current = props
  const router = useRef(new PointerRouter())
  const middlePan = useRef(new MiddlePan())
  const hintId = useId()
  const lastInput = useRef<PointerInput | null>(null)
  const gestureActive = useRef(false)
  /** A press on the selected embed: released in place, it hands the pointer to the page inside. */
  const embedPress = useRef<{ id: string; at: Point } | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: these props are read through `latest` at draw time; a change only needs a frame
  useEffect(() => {
    schedule.current()
  }, [props.palette, props.searchMatches, props.activeSearchMatch, props.renamingFrameId])

  useEffect(() => {
    const wrap = wrapRef.current!
    const staticCanvas = staticRef.current!
    const interactiveCanvas = interactiveRef.current!
    let size = { width: -1, height: -1 }
    lastStatic.current = null

    const draw = () => {
      frame.current = 0
      const p = latest.current
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const bw = backingSize(width, dpr)
      const bh = backingSize(height, dpr)
      for (const canvas of [staticCanvas, interactiveCanvas]) {
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw
          canvas.height = bh
        }
      }
      // report a new size only when it really changed
      if (size.width !== width || size.height !== height) {
        size = { width, height }
        core.setViewportSize(width, height)
        p.onSizeChange?.(size)
      }
      images.sync(core.scene.files)

      const palette = p.palette
      const renaming = p.renamingFrameId ?? null
      const key: StaticKey = {
        version: core.staticVersion,
        width,
        height,
        dpr,
        palette,
        images: images.version,
        fonts: canvasFontsVersion(),
        hiddenFrameLabel: renaming,
      }
      try {
        if (staticKeyChanged(lastStatic.current, key)) {
          lastStatic.current = key
          const hidden = new Set<string>()
          if (core.appState.editingTextId) hidden.add(core.appState.editingTextId)
          renderStaticScene(asCanvas2D(staticCanvas.getContext("2d")), {
            scene: core.scene,
            appState: core.appState,
            width,
            height,
            dpr,
            theme: core.appState.theme,
            cache: shapeCache.current,
            hiddenElementIds: hidden,
            resolveImage: (id) => images.get(id),
            palette,
            pendingEraseIds: core.pendingEraseIds,
            hiddenFrameLabelIds: renaming ? new Set([renaming]) : undefined,
          })
        }
      } finally {
        // a static-layer failure must not also blank the selection and handles
        const flash = correctionFlashAt(core.lastCorrection, Date.now(), reducedMotion())
        const pickHover = elementPicker.hovered ? (core.scene.get(elementPicker.hovered) ?? null) : null
        const editingLinearId = core.appState.editingLinearElementId
        renderInteractiveScene(asCanvas2D(interactiveCanvas.getContext("2d")), {
          appState: core.appState,
          selected: core.selectedElements(),
          width,
          height,
          dpr,
          marquee: core.marquee,
          lasso: core.lasso,
          snapLines: core.snapLines,
          bindingHighlight: elementPicker.active ? pickHover : core.bindingHighlight,
          bindingHints: core.bindingHints,
          frameHighlight: core.frameHighlight,
          editingLinear: editingLinearId ? (core.scene.get(editingLinearId) ?? null) : null,
          laserTrail: core.laserTrail,
          // handles under an open text or frame-name field would only catch presses meant for it
          suppressHandles: !!core.appState.editingTextId || renaming !== null,
          palette,
          scene: core.scene,
          correctionFlash: flash ?? undefined,
          searchMatches: p.searchMatches,
          activeSearchMatch: p.activeSearchMatch ?? null,
          resolveImage: (id) => images.get(id),
        })
        if (flash) run()
      }
    }

    const run = () => {
      if (!frame.current) frame.current = requestAnimationFrame(draw)
    }
    schedule.current = run

    const unsubscribe = core.subscribe(run)
    const unsubscribeImages = images.onDecoded(run)
    const unsubscribePicker = elementPicker.subscribe(run)
    const unsubscribeFonts = onCanvasFontsChange(() => {
      const ids = textNeedingRelayout(
        core.scene.getNonDeleted(),
        (id) => core.scene.get(id),
        core.appState.editingTextId,
      )
      for (const id of ids) core.relayoutContainer(id)
      run()
    })
    const observer = new ResizeObserver(run)
    observer.observe(wrap)
    elementPicker.setSurface(interactiveCanvas)

    // moving the window to a display with another pixel ratio repaints at the new density
    let dprQuery: MediaQueryList | null = null
    const onDprChange = () => {
      armDpr()
      run()
    }
    const armDpr = () => {
      dprQuery?.removeEventListener?.("change", onDprChange)
      dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null
      dprQuery?.addEventListener?.("change", onDprChange)
    }
    armDpr()
    run()

    // the laser trail fades on a timer rather than on input
    const laserTimer = window.setInterval(() => {
      if (core.laserTrail.length) core.pruneLaser()
    }, 60)

    return () => {
      unsubscribe()
      unsubscribeImages()
      unsubscribePicker()
      unsubscribeFonts()
      observer.disconnect()
      dprQuery?.removeEventListener?.("change", onDprChange)
      window.clearInterval(laserTimer)
      if (elementPicker.surface === interactiveCanvas) elementPicker.setSurface(null)
      if (frame.current) cancelAnimationFrame(frame.current)
      // the ref outlives this effect, so a remount would otherwise see a
      // pending frame that was already cancelled and never draw again
      frame.current = 0
      schedule.current = () => {}
    }
  }, [core, images])

  const toInput = (e: PointerLike): PointerInput => {
    const rect = interactiveRef.current!.getBoundingClientRect()
    const screen: Point = [e.clientX - rect.left, e.clientY - rect.top]
    return {
      screen,
      scene: screenToScene(screen, core.appState.viewport),
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      pressure: typeof e.pressure === "number" ? e.pressure : 0.5,
      detail: e.detail,
    }
  }

  const applyContextSelection = (s: ContextSelection) => {
    if (s.kind === "clear") core.clearSelection()
    else if (s.kind === "select") core.selectElements([s.id])
  }

  const openContextMenu = (
    e: React.MouseEvent,
    scene: Point,
    client: Point,
    source: "pointer" | "keyboard",
  ) => {
    const r =
      source === "pointer"
        ? resolveContextTarget(core.scene.getNonDeleted(), scene, core.appState.viewport.zoom, core.appState)
        : { element: null, selection: { kind: "keep" } as ContextSelection }
    applyContextSelection(r.selection)
    latest.current.onContextMenu(e, { x: client[0], y: client[1], scene, element: r.element, source })
  }

  const openLink = (link: string) => {
    if (followLink(core, link, latest.current.onOpenLink) === "refused") latest.current.onLinkRefused?.(link)
  }

  const cancelToolGesture = () => {
    const tool = core.appState.activeTool
    // re-arming the same tool abandons its draft; the image tool would reopen its picker instead
    if (tool !== "image") core.setTool(tool)
  }

  const canFollowLinks = () => {
    const tool = core.appState.activeTool
    return core.appState.viewMode || tool === "selection" || tool === "hand"
  }

  /** The selection whose resize and rotate handles a press can grab, which win over a link badge. */
  const handleSelection = (): readonly NibElement[] =>
    core.appState.activeTool === "selection" && !core.appState.viewMode && !core.appState.editingTextId
      ? core.selectedElements()
      : []

  // non-React listeners: wheel must be non-passive, and WebKit's gesture events have no React binding
  // biome-ignore lint/correctness/useExhaustiveDependencies: openContextMenu reads current props through `latest`
  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = interactiveRef.current!
    const local = (x: number, y: number): Point => {
      const rect = canvas.getBoundingClientRect()
      return [x - rect.left, y - rect.top]
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // WebKit reports its trackpad pinch as gesture events; a stray ctrl+wheel then would zoom twice
      if (gestureActive.current) return
      core.wheel(e.deltaX, e.deltaY, e.ctrlKey || e.metaKey, local(e.clientX, e.clientY), {
        deltaMode: e.deltaMode,
        shiftKey: e.shiftKey,
      })
    }
    // a pinch over the chrome arrives as ctrl+wheel too, and would otherwise zoom the whole page
    const onWindowWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault()
    }

    // Safari and the macOS app's WKWebView pinch with gesture events, not ctrl+wheel
    let lastScale = 1
    let anchor: Point | null = null
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEventLike
      anchor = wrap.contains(e.target as Node) ? local(g.clientX ?? 0, g.clientY ?? 0) : null
      gestureActive.current = anchor !== null
      lastScale = g.scale || 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEventLike
      if (!anchor) return
      if (g.clientX !== undefined && g.clientY !== undefined) anchor = local(g.clientX, g.clientY)
      core.setAppState({ viewport: gestureViewport(core.appState.viewport, anchor, lastScale, g.scale) })
      lastScale = g.scale
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      anchor = null
      gestureActive.current = false
    }

    // Shift+F10 and the context-menu key open the menu for the selection, or for the board
    const onKeyDown = (e: KeyboardEvent) => {
      const isMenuKey = e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)
      if (!isMenuKey || e.defaultPrevented || isTypingTarget(e) || isModalOpen()) return
      const target = e.target as Node | null
      if (target && target !== document.body && !wrap.contains(target)) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sel = core.selectedElements()
      let at: Point = [rect.width / 2, rect.height / 2]
      if (sel.length > 0) {
        const b = getCommonBounds(sel)
        at = sceneToScreen([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], core.appState.viewport)
      }
      const client: Point = [rect.left + at[0], rect.top + at[1]]
      const synthetic = {
        clientX: client[0],
        clientY: client[1],
        currentTarget: canvas,
        target: canvas,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as React.MouseEvent
      openContextMenu(synthetic, screenToScene(at, core.appState.viewport), client, "keyboard")
    }

    canvas.addEventListener("wheel", onWheel, { passive: false })
    window.addEventListener("wheel", onWindowWheel, { passive: false })
    document.addEventListener("gesturestart", onGestureStart)
    document.addEventListener("gesturechange", onGestureChange)
    document.addEventListener("gestureend", onGestureEnd)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      canvas.removeEventListener("wheel", onWheel)
      window.removeEventListener("wheel", onWindowWheel)
      document.removeEventListener("gesturestart", onGestureStart)
      document.removeEventListener("gesturechange", onGestureChange)
      document.removeEventListener("gestureend", onGestureEnd)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [core])

  useEffect(
    () => () => {
      router.current.reset()
      canvasGesture.set(false)
    },
    [],
  )

  /** The selected embed under `p` when it shows a live page and the selection tool is out. */
  const selectedEmbedAt = (p: Point): string | null => {
    if (core.appState.activeTool !== "selection" || core.appState.viewMode) return null
    const sel = core.selectedElements()
    const only = sel.length === 1 ? sel[0]! : null
    if (only?.type !== "embeddable" || !only.link || !embedSource(only.link)) return null
    const hit = elementAtPoint(core.scene.getNonDeleted(), p, core.appState.viewport.zoom, core.appState)
    return hit?.id === only.id ? only.id : null
  }

  const finishToolGesture = (input: PointerInput) => {
    lastInput.current = null
    core.pointerUp(input)
    canvasGesture.set(false)
    const press = embedPress.current
    embedPress.current = null
    if (press && Math.hypot(input.screen[0] - press.at[0], input.screen[1] - press.at[1]) < EMBED_CLICK_SLOP)
      embedState.activate(press.id)
  }

  const endToolGesture = (e: React.PointerEvent) => {
    if (router.current.up(e.pointerId).action !== "tool") return
    finishToolGesture(toInput(e))
  }

  /** A gesture whose release never arrived ends where it was last seen, as if let go there. */
  const abandonToolGesture = () => {
    const input = lastInput.current
    lastInput.current = null
    embedPress.current = null
    if (input) core.pointerUp({ ...input, buttons: 0 })
    canvasGesture.set(false)
  }

  return (
    // a name needs a role (ARIA 1.2): the board handles its own pointer and key input, an application
    <div
      ref={wrapRef}
      className="sc-canvas canvas-wrap"
      role="application"
      aria-label="Drawing board"
      aria-describedby={hintId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab reaches the application so screen readers enter focus mode and read its hint
      tabIndex={0}
    >
      <p id={hintId} className="sc-visually-hidden">
        Pick a tool in the tray below, then draw on the board. Press question mark for the keyboard shortcuts.
      </p>
      <canvas ref={staticRef} className="sc-canvas-layer" data-testid="canvas-static" />
      <canvas
        ref={interactiveRef}
        className="sc-canvas-layer"
        data-layer="interactive"
        data-testid="canvas-interactive"
        onPointerDown={(e) => {
          const target = e.currentTarget
          e.preventDefault()
          releaseFocus()
          if (e.button === 1) {
            middlePan.current.start(e.pointerId, e.clientX, e.clientY)
            capture(target, e.pointerId)
            return
          }
          if (e.button !== 0) return
          const input = toInput(e)
          if (elementPicker.active) {
            const hit = elementAtPoint(
              core.scene.getNonDeleted(),
              input.scene,
              core.appState.viewport.zoom,
              core.appState,
              { includeLocked: true },
            )
            elementPicker.pick(hit)
            return
          }
          const held = router.current.toolPointerId
          const stale = router.current.takeStale(e.pointerId, held !== null && holdsCapture(target, held))
          if (stale !== null) abandonToolGesture()
          const routed = router.current.down(
            e.pointerId,
            input.screen,
            e.pointerType as PointerKind,
            e.isPrimary,
          )
          if (routed.action === "pinch-start") {
            if (routed.cancelTool) cancelToolGesture()
            lastInput.current = null
            canvasGesture.set(false)
            return
          }
          if (routed.action === "ignore") return
          if (canFollowLinks()) {
            const link = linkToFollow(
              core.scene.getNonDeleted(),
              input.scene,
              core.appState.viewport.zoom,
              core.appState,
              e.metaKey || e.ctrlKey,
              handleSelection(),
            )
            if (link) {
              router.current.up(e.pointerId)
              openLink(link)
              return
            }
          }
          if (embedState.active) embedState.activate(null)
          const embedId = selectedEmbedAt(input.scene)
          embedPress.current = embedId ? { id: embedId, at: input.screen } : null
          capture(target, e.pointerId)
          lastInput.current = input
          canvasGesture.set(true)
          core.pointerDown(input)
        }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={(e) => {
          const pan = middlePan.current.move(e.pointerId, e.clientX, e.clientY, e.buttons)
          if (pan) {
            core.setAppState({ viewport: panBy(core.appState.viewport, pan[0], pan[1]) })
            return
          }
          const input = toInput(e)
          const canvas = e.currentTarget
          if (elementPicker.active) {
            const hit = elementAtPoint(
              core.scene.getNonDeleted(),
              input.scene,
              core.appState.viewport.zoom,
              core.appState,
              { includeLocked: true },
            )
            elementPicker.hover(hit)
            canvas.style.cursor = elementPicker.accepts(hit) ? "pointer" : "crosshair"
            return
          }
          const routed = router.current.move(e.pointerId, input.screen, e.buttons)
          if (routed.action === "released") {
            finishToolGesture({ ...input, buttons: 0 })
            return
          }
          if (routed.action === "pinch") {
            core.setAppState({ viewport: pinchViewport(core.appState.viewport, routed.from, routed.to) })
            return
          }
          const toolPointer = router.current.toolPointerId
          if (routed.action === "ignore" && (e.pointerType === "touch" || toolPointer !== null)) return
          if (toolPointer === e.pointerId && SAMPLED_TOOLS.has(core.appState.activeTool)) {
            const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
            for (const s of samples.slice(0, -1)) core.pointerMove(toInput(s))
          }
          lastInput.current = toolPointer === e.pointerId ? input : lastInput.current
          core.pointerMove(input)
          const zoom = core.appState.viewport.zoom
          const overBadge =
            toolPointer === null &&
            canFollowLinks() &&
            linkBadgeAt(core.scene.getNonDeleted(), input.scene, zoom) !== null &&
            !pressHitsHandle(handleSelection(), input.scene, zoom, core.appState.croppingElementId)
          canvas.style.cursor = overBadge ? "pointer" : core.cursor(input)
        }}
        onPointerUp={(e) => {
          if (middlePan.current.end(e.pointerId) && e.button === 1) return
          endToolGesture(e)
        }}
        onPointerCancel={(e) => {
          middlePan.current.end(e.pointerId)
          endToolGesture(e)
        }}
        onLostPointerCapture={(e) => {
          middlePan.current.end(e.pointerId)
          // capture lost without a pointerup (window blur, element swap): end the gesture where it was
          if (router.current.toolPointerId !== e.pointerId) return
          router.current.up(e.pointerId)
          abandonToolGesture()
        }}
        onPointerLeave={() => {
          if (elementPicker.active) elementPicker.hover(null)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          if (elementPicker.active) return
          core.doubleClick(toInput(e))
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (elementPicker.active) return
          commitTextEditor()
          const input = toInput(e)
          openContextMenu(e, input.scene, [e.clientX, e.clientY], "pointer")
        }}
      />
      {children}
    </div>
  )
}
