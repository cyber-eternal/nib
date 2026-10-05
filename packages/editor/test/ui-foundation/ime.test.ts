import { describe, expect, it } from "vitest"
import { isImeKey } from "../../src/ui/primitives/ime"

describe("isImeKey", () => {
  it("catches WebKit's confirming keydown after compositionend, which says it is not composing", () => {
    expect(isImeKey({ keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true)
  })

  it("catches a keydown during composition, from React or the DOM", () => {
    expect(isImeKey({ keyCode: 13, nativeEvent: { isComposing: true } })).toBe(true)
    expect(isImeKey({ keyCode: 13, isComposing: true })).toBe(true)
  })

  it("lets ordinary Enter and Escape through", () => {
    expect(isImeKey({ keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false)
    expect(isImeKey({ keyCode: 27 })).toBe(false)
  })
})
