import { describe, expect, it, vi } from "vitest"
import { boardColorPickerAvailable, pickColorFromBoard, setBoardColorPicker } from "../../src/ui/style/bus"

describe("the board colour picker hand-off", () => {
  it("is unavailable until the shell installs one, and gone again once it uninstalls", () => {
    expect(boardColorPickerAvailable()).toBe(false)
    expect(pickColorFromBoard("stroke")).toBe(false)
    const picker = vi.fn()
    const off = setBoardColorPicker(picker)
    expect(boardColorPickerAvailable()).toBe(true)
    expect(pickColorFromBoard("background")).toBe(true)
    expect(picker).toHaveBeenCalledWith("background")
    off()
    expect(boardColorPickerAvailable()).toBe(false)
  })

  it("an older picker's cleanup leaves a newer one installed", () => {
    const offOld = setBoardColorPicker(vi.fn())
    const fresh = vi.fn()
    const offNew = setBoardColorPicker(fresh)
    offOld()
    expect(pickColorFromBoard("stroke")).toBe(true)
    expect(fresh).toHaveBeenCalledWith("stroke")
    offNew()
  })
})
