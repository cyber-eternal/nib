import { describe, expect, it } from "vitest"
import { onOutsidePress } from "../../src/ui/style/useCommitOnOutsidePress"

/** A press's capture path as the browser walks it: window first, then document. */
const press = (win: EventTarget, doc: EventTarget) => {
  win.dispatchEvent(new Event("pointerdown"))
  doc.dispatchEvent(new Event("pointerdown"))
}

describe("committing a field draft on an outside press", () => {
  it("commits before the popover layer, registered first on document, dismisses and unmounts the field", () => {
    const win = new EventTarget()
    const doc = new EventTarget()
    const log: string[] = []
    let unmountField = () => {}
    // the layer controller attaches when the popover opens, before the field's effect runs
    doc.addEventListener(
      "pointerdown",
      () => {
        log.push("dismiss")
        unmountField()
      },
      true,
    )
    unmountField = onOutsidePress(
      win,
      () => false,
      () => log.push("commit"),
    )
    press(win, doc)
    expect(log).toEqual(["commit", "dismiss"])
  })

  it("keeps the draft for a press inside the field, and stops listening once unmounted", () => {
    const win = new EventTarget()
    let commits = 0
    let inside = true
    const off = onOutsidePress(
      win,
      () => inside,
      () => commits++,
    )
    win.dispatchEvent(new Event("pointerdown"))
    expect(commits).toBe(0)
    inside = false
    win.dispatchEvent(new Event("pointerdown"))
    expect(commits).toBe(1)
    off()
    win.dispatchEvent(new Event("pointerdown"))
    expect(commits).toBe(1)
  })
})
