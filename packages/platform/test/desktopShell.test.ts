import { describe, expect, it, vi } from "vitest"
import { createCloseGuard, createOpenFileHub } from "../../../apps/desktop/src/shell"

describe("desktop close guard", () => {
  it("allows closing when every handler allows it", async () => {
    const guard = createCloseGuard()
    guard.add(async () => true)
    guard.add(async () => true)
    await expect(guard.run()).resolves.toBe(true)
  })

  it("keeps the window open when any handler refuses", async () => {
    const guard = createCloseGuard()
    guard.add(async () => true)
    guard.add(async () => false)
    await expect(guard.run()).resolves.toBe(false)
  })

  it("closes when nothing is registered", async () => {
    await expect(createCloseGuard().run()).resolves.toBe(true)
  })

  it("stops consulting a handler after unsubscribe, and unsubscribe is idempotent", async () => {
    const guard = createCloseGuard()
    const off = guard.add(async () => false)
    off()
    off()
    await expect(guard.run()).resolves.toBe(true)
  })

  it("shares one run between overlapping close and quit requests", async () => {
    const guard = createCloseGuard()
    let release!: (v: boolean) => void
    const handler = vi.fn(() => new Promise<boolean>((r) => (release = r)))
    guard.add(handler)
    const first = guard.run()
    const second = guard.run()
    release(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("keeps the window open after a failed prompt, but not twice in a row", async () => {
    const log = vi.fn()
    const guard = createCloseGuard(log)
    guard.add(async () => {
      throw new Error("dialog plugin unavailable")
    })
    await expect(guard.run()).resolves.toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    await expect(guard.run()).resolves.toBe(true)
  })
})

describe("open-file hub", () => {
  it("buffers launch-time opens until someone subscribes", async () => {
    const hub = createOpenFileHub()
    hub.push("/Users/a/Board.NIBD")
    const seen: string[] = []
    hub.subscribe((p) => seen.push(p))
    expect(seen).toEqual([])
    await Promise.resolve()
    expect(seen).toEqual(["/Users/a/Board.NIBD"])
  })

  it("delivers to the surviving StrictMode subscriber exactly once", async () => {
    const hub = createOpenFileHub()
    hub.push("/a.nibd")
    const first = vi.fn()
    const second = vi.fn()
    const off = hub.subscribe(first)
    off()
    hub.subscribe(second)
    await Promise.resolve()
    await Promise.resolve()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith("/a.nibd")
  })

  it("delivers later opens immediately", () => {
    const hub = createOpenFileHub()
    const cb = vi.fn()
    hub.subscribe(cb)
    hub.push("/b.excalidraw")
    expect(cb).toHaveBeenCalledWith("/b.excalidraw")
  })
})
