export type ToastKind = "info" | "success" | "error"

export interface Toast {
  id: string
  message: string
  kind: ToastKind
  /** ms before it dismisses itself; 0 keeps it until dismissed. */
  duration: number
  action?: { label: string; run: () => void }
}

export const TOAST_DURATION = 3000
export const TOAST_MAX = 3

/** Adds a toast, newest last. A repeat of the newest message replaces it (restarting its timer) instead of stacking. */
export const pushToast = (queue: readonly Toast[], toast: Toast, max: number = TOAST_MAX): Toast[] => {
  const last = queue[queue.length - 1]
  const base = last && last.message === toast.message && last.kind === toast.kind ? queue.slice(0, -1) : queue
  return [...base.filter((t) => t.id !== toast.id), toast].slice(-max)
}

export const removeToast = (queue: readonly Toast[], id: string): Toast[] => queue.filter((t) => t.id !== id)

/** What can start or end a pause; `focus` and `hover` say whether each still sits in the region. */
export type PauseEvent =
  | { kind: "enter" | "focus" | "acted" }
  | { kind: "leave" | "blur" | "changed"; focus: boolean; hover: boolean }

/**
 * Whether the region's timers stay paused after an event: while the pointer or focus is in the region. An
 * action that ran clears it, and so does a change of toasts that took the focused action away.
 */
export const pauseAfter = (paused: boolean, e: PauseEvent): boolean => {
  switch (e.kind) {
    case "enter":
    case "focus":
      return true
    case "acted":
      return false
    case "changed":
      return paused && (e.focus || e.hover)
    default:
      return e.focus || e.hover
  }
}
