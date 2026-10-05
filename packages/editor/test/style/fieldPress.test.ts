import type { MouseEvent } from "react"
import { describe, expect, it } from "vitest"
import { keepFieldFocus } from "../../src/ui/style/fieldPress"

const fakeInput = (value: string) => {
  const calls = { focused: 0, caret: [] as [number, number][] }
  const input = {
    value,
    getBoundingClientRect: () => ({ left: 20, right: 90, top: 4, bottom: 31 }),
    focus: () => {
      calls.focused++
    },
    setSelectionRange: (a: number, b: number) => calls.caret.push([a, b]),
  } as unknown as HTMLInputElement
  return { input, calls }
}

const target = (opts: { inButton?: boolean } = {}) =>
  ({ closest: (sel: string) => (sel === "button" && opts.inButton ? {} : null) }) as unknown as Element

const press = (t: unknown, x: number, y: number, button = 0) => {
  let prevented = false
  const e = {
    button,
    target: t,
    clientX: x,
    clientY: y,
    preventDefault: () => {
      prevented = true
    },
  } as unknown as MouseEvent<HTMLElement>
  return { e, prevented: () => prevented }
}

describe("a short field's frame types into its input", () => {
  it("a press on the # prefix keeps focus in the input with the caret first", () => {
    const { input, calls } = fakeInput("e03131")
    const p = press(target(), 10, 18)
    keepFieldFocus({ current: input })(p.e)
    expect(p.prevented()).toBe(true)
    expect(calls.focused).toBe(1)
    expect(calls.caret).toEqual([[0, 0]])
  })

  it("a press on the px suffix, the padding or the message puts the caret last", () => {
    const { input, calls } = fakeInput("20")
    keepFieldFocus({ current: input })(press(target(), 95, 18).e)
    keepFieldFocus({ current: input })(press(target(), 50, 40).e)
    expect(calls.caret).toEqual([
      [2, 2],
      [2, 2],
    ])
  })

  it("leaves the input's own presses, buttons beside it and other buttons to the browser", () => {
    const { input, calls } = fakeInput("e03131")
    const own = press(input, 50, 18)
    keepFieldFocus({ current: input })(own.e)
    const eyedropper = press(target({ inButton: true }), 120, 18)
    keepFieldFocus({ current: input })(eyedropper.e)
    const right = press(target(), 10, 18, 2)
    keepFieldFocus({ current: input })(right.e)
    expect([own.prevented(), eyedropper.prevented(), right.prevented()]).toEqual([false, false, false])
    expect(calls.focused).toBe(0)
  })
})
