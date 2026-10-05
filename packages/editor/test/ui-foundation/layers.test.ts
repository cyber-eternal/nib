import { describe, expect, it, vi } from "vitest"
import { isModalOpen, layerController } from "../../src/hooks/useLayer"
import { type LayerEntry, LayerStack, trapTabIndex } from "../../src/ui/primitives/layerStack"

const entry = (id: string, over: Partial<LayerEntry> = {}): LayerEntry => ({
  id,
  modal: false,
  dismissOnEscape: true,
  dismissOnOutside: true,
  ...over,
})

describe("LayerStack", () => {
  it("Escape belongs to the top layer only", () => {
    const s = new LayerStack()
    s.push(entry("sidebar"))
    s.push(entry("menu"))
    expect(s.escapeTarget()?.id).toBe("menu")
    s.remove("menu")
    expect(s.escapeTarget()?.id).toBe("sidebar")
    s.remove("sidebar")
    expect(s.escapeTarget()).toBeUndefined()
  })

  it("an outside press closes layers above the one it lands in, top first", () => {
    const s = new LayerStack()
    s.push(entry("library"))
    s.push(entry("menu"))
    s.push(entry("submenu"))
    const inLibrary = s.outsideDismissals((e) => (e.id === "library" ? "inside" : "outside"))
    expect(inLibrary).toEqual(["submenu", "menu"])
    const nowhere = s.outsideDismissals(() => "outside")
    expect(nowhere).toEqual(["submenu", "menu", "library"])
  })

  it("a press on the opener is ignored so the opener can toggle", () => {
    const s = new LayerStack()
    s.push(entry("stroke-popover"))
    expect(s.outsideDismissals(() => "ignored")).toEqual([])
  })

  it("a modal layer, or one that does not close on outside presses, shields the layers under it", () => {
    const s = new LayerStack()
    s.push(entry("sidebar"))
    s.push(entry("export", { modal: true, dismissOnOutside: false }))
    s.push(entry("scale-popover"))
    expect(s.outsideDismissals(() => "outside")).toEqual(["scale-popover"])

    const t = new LayerStack()
    t.push(entry("sidebar"))
    t.push(entry("help", { modal: true, dismissOnOutside: true }))
    expect(t.outsideDismissals(() => "outside")).toEqual(["help"])
  })

  it("reports modal state and where focus may go", () => {
    const s = new LayerStack()
    s.push(entry("popover"))
    expect(s.isModalOpen()).toBe(false)
    expect(s.allowsFocusIn(-1)).toBe(true)
    s.push(entry("dialog", { modal: true }))
    s.push(entry("dialog-popover"))
    expect(s.isModalOpen()).toBe(true)
    expect(s.allowsFocusIn(-1)).toBe(false)
    expect(s.allowsFocusIn(0)).toBe(false)
    expect(s.allowsFocusIn(1)).toBe(true)
    expect(s.allowsFocusIn(2)).toBe(true)
  })

  it("a parent registered after its child (same commit) still sits below it", () => {
    const s = new LayerStack()
    s.push(entry("other"))
    s.push(entry("child", { parentId: "parent" }))
    s.push(entry("parent"))
    expect(s.layers.map((l) => l.id)).toEqual(["other", "parent", "child"])
    expect(s.top()?.id).toBe("child")
  })

  it("re-registering an id updates it in place", () => {
    const s = new LayerStack()
    s.push(entry("a"))
    s.push(entry("b"))
    s.push(entry("a", { modal: true }))
    expect(s.layers.map((l) => l.id)).toEqual(["a", "b"])
    expect(s.layers[0]!.modal).toBe(true)
  })

  it("notifies subscribers on every change", () => {
    const s = new LayerStack()
    const fn = vi.fn()
    const off = s.subscribe(fn)
    s.push(entry("a"))
    s.remove("a")
    s.remove("a")
    off()
    s.push(entry("b"))
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe("trapTabIndex", () => {
  it("wraps at both ends and pulls stray focus back in", () => {
    expect(trapTabIndex(3, 2, false)).toBe(0)
    expect(trapTabIndex(3, 0, true)).toBe(2)
    expect(trapTabIndex(3, 1, false)).toBeNull()
    expect(trapTabIndex(3, -1, false)).toBe(0)
    expect(trapTabIndex(3, -1, true)).toBe(2)
    expect(trapTabIndex(0, -1, false)).toBe(-1)
  })
})

describe("layerController", () => {
  const node = (name: string) => ({
    name,
    contains: (t: unknown) => (t as { owner?: string })?.owner === name,
  })

  const keyEvent = (key: string) => ({
    key,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  })

  it("Escape dismisses only the top layer and stops the key reaching the canvas", () => {
    const lower = vi.fn()
    const upper = vi.fn()
    const offLower = layerController.register(entry("t-lower"), {
      element: () => node("lower") as unknown as HTMLElement,
      ignores: () => false,
      dismiss: lower,
    })
    const offUpper = layerController.register(entry("t-upper"), {
      element: () => node("upper") as unknown as HTMLElement,
      ignores: () => false,
      dismiss: upper,
    })
    const e = keyEvent("Escape")
    expect(layerController.onKeyDown(e)).toBe(true)
    expect(upper).toHaveBeenCalledWith("escape")
    expect(lower).not.toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    offUpper()
    offLower()
    expect(layerController.onKeyDown(keyEvent("Escape"))).toBe(false)
  })

  it("an outside press inside the lower layer closes only the upper one", () => {
    const lower = vi.fn()
    const upper = vi.fn()
    const offLower = layerController.register(entry("p-lower"), {
      element: () => node("lower") as unknown as HTMLElement,
      ignores: () => false,
      dismiss: lower,
    })
    const offUpper = layerController.register(entry("p-upper"), {
      element: () => node("upper") as unknown as HTMLElement,
      ignores: () => false,
      dismiss: upper,
    })
    layerController.onPointerDown({ target: { owner: "lower" } as unknown as EventTarget })
    expect(upper).toHaveBeenCalledWith("outside")
    expect(lower).not.toHaveBeenCalled()
    offUpper()
    offLower()
  })

  it("isModalOpen() gates global shortcuts while a dialog is registered", () => {
    expect(isModalOpen()).toBe(false)
    const off = layerController.register(entry("m", { modal: true, dismissOnOutside: false }), {
      element: () => null,
      ignores: () => false,
      dismiss: () => {},
    })
    expect(isModalOpen()).toBe(true)
    off()
    expect(isModalOpen()).toBe(false)
  })

  it("an Escape that cancels an IME candidate leaves the layer open (R-UI-13b)", () => {
    const dismiss = vi.fn()
    const off = layerController.register(entry("ime"), {
      element: () => null,
      ignores: () => false,
      dismiss,
    })
    const webkit = { ...keyEvent("Escape"), keyCode: 229 }
    const composing = { ...keyEvent("Escape"), isComposing: true }
    expect(layerController.onKeyDown(webkit)).toBe(false)
    expect(layerController.onKeyDown(composing)).toBe(false)
    expect(dismiss).not.toHaveBeenCalled()
    expect(webkit.preventDefault).not.toHaveBeenCalled()
    off()
  })

  it("a layer that opts out of Escape still swallows it", () => {
    const dismiss = vi.fn()
    const off = layerController.register(entry("busy", { dismissOnEscape: false }), {
      element: () => null,
      ignores: () => false,
      dismiss,
    })
    const e = keyEvent("Escape")
    expect(layerController.onKeyDown(e)).toBe(true)
    expect(dismiss).not.toHaveBeenCalled()
    expect(e.preventDefault).toHaveBeenCalled()
    off()
  })
})
