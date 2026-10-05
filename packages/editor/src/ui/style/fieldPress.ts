import type { MouseEvent, RefObject } from "react"

/**
 * onMouseDown for a short field's whole frame: its label, box (the # or px, the padding) and message. A
 * press anywhere on it types into the input. Left to the browser, focus lands on the popover and the next
 * key reaches the board's shortcuts, and leaving the input reverts an invalid draft.
 */
export const keepFieldFocus =
  (inputRef: RefObject<HTMLInputElement | null>) =>
  (e: MouseEvent<HTMLElement>): void => {
    const input = inputRef.current
    const target = e.target as Element
    if (!input || e.button !== 0 || target === input || target.closest?.("button")) return
    e.preventDefault()
    const box = input.getBoundingClientRect()
    // the prefix left of the text puts the caret first, anywhere else at the end
    const before = e.clientX < box.left && e.clientY >= box.top && e.clientY <= box.bottom
    const caret = before ? 0 : input.value.length
    input.focus({ preventScroll: true })
    input.setSelectionRange(caret, caret)
  }
