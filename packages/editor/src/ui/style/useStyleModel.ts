import type { AppState, EditorCore, NibElement } from "@nib/core"
import { useCallback, useSyncExternalStore } from "react"
import { type StyleModel, sameModel, styleModel } from "./model"

interface CachedModel {
  els: readonly NibElement[]
  app: AppState
  model: StyleModel | null
}

const cache = new WeakMap<EditorCore, CachedModel>()

/**
 * styleModel for the core's current scene and app state, computed once per change however many readers
 * ask (the bar and the shell's lift both do on every emit). An unchanged model keeps its identity.
 */
export const readStyleModel = (core: EditorCore): StyleModel | null => {
  const els = core.scene.getElements()
  const app = core.appState
  const hit = cache.get(core)
  if (hit && hit.els === els && hit.app === app) return hit.model
  const next = styleModel(core)
  const model = hit && sameModel(hit.model, next) ? hit.model : next
  cache.set(core, { els, app, model })
  return model
}

const useCoreSubscribe = (core: EditorCore) => useCallback((cb: () => void) => core.subscribe(cb), [core])

/** Re-renders only when what the bar shows changes, not on every pointer frame. */
export const useStyleModel = (core: EditorCore): StyleModel | null => {
  const subscribe = useCoreSubscribe(core)
  const read = () => readStyleModel(core)
  return useSyncExternalStore(subscribe, read, read)
}

/** Whether the style bar is showing, by the bar's own rule, so the shell can lift what sits above it. */
export const useStyleBarShown = (core: EditorCore): boolean => {
  const subscribe = useCoreSubscribe(core)
  const read = () => readStyleModel(core) !== null
  return useSyncExternalStore(subscribe, read, read)
}
