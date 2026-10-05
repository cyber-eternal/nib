import { type RefObject, useEffect, useRef } from "react"

type Listenable = Pick<EventTarget, "addEventListener" | "removeEventListener">

/** Calls `commit` on each capture-phase pointerdown on `root` that lands outside; returns the unsubscribe. */
export const onOutsidePress = (
  root: Listenable,
  isInside: (target: EventTarget | null) => boolean,
  commit: () => void,
): (() => void) => {
  const onDown = (e: Event) => {
    if (!isInside(e.target)) commit()
  }
  root.addEventListener("pointerdown", onDown, { capture: true })
  return () => root.removeEventListener("pointerdown", onDown, { capture: true })
}

/**
 * Runs `commit` on a press outside `ref` before anything else handles it: a press on the canvas both
 * closes the popover and changes the selection, and the draft belongs to the selection it was typed for.
 */
export const useCommitOnOutsidePress = (ref: RefObject<HTMLElement | null>, commit: () => void): void => {
  const latest = useRef(commit)
  latest.current = commit
  useEffect(
    () =>
      // window, not document: the layer controller's document capture listener, added when the popover
      // opened, would dismiss it and unmount this field before a later document listener ran
      onOutsidePress(
        window,
        (target) => {
          const el = ref.current
          return !el || el.contains(target as Node)
        },
        () => latest.current(),
      ),
    [ref],
  )
}
