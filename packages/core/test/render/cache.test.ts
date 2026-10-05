import { describe, expect, test, vi } from "vitest"

const strokeCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock("perfect-freehand", async (importOriginal) => {
  const mod = await importOriginal<typeof import("perfect-freehand")>()
  return {
    ...mod,
    getStroke: (...args: Parameters<typeof mod.getStroke>) => {
      strokeCalls.n += 1
      return mod.getStroke(...args)
    },
  }
})

import { normalizeElements } from "../../src/io/nibFile"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { DEFAULT_APP_STATE } from "../../src/model/types"
import { ShapeCache, generateShape } from "../../src/render/shapes"
import { renderStaticScene } from "../../src/render/staticScene"
import { recordingCanvas } from "./mockCanvas"

describe("rough shapes are stable for every seed", () => {
  // roughjs treats seed 0 as "use Math.random", so the shape re-jitters on every regenerate
  test("an element loaded with seed 0 renders identically twice", () => {
    const [rect] = normalizeElements([
      { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 60, seed: 0 },
    ])
    const a = JSON.stringify(generateShape(rect!, "light")[0]!.sets)
    const b = JSON.stringify(generateShape(rect!, "light")[0]!.sets)
    expect(a).toBe(b)
  })
})

describe("shape cache key distinguishes different content", () => {
  test("same id and version but a different versionNonce regenerates", () => {
    const cache = new ShapeCache()
    const a = newElement("rectangle", { id: "x", width: 100, height: 60, version: 3, versionNonce: 1 })
    const b = { ...a, width: 300, versionNonce: 2 }
    const first = JSON.stringify(cache.get(a, "light"))
    const second = JSON.stringify(cache.get(b, "light"))
    expect(second).not.toBe(first)
  })
})

describe("freedraw outlines are cached per version", () => {
  test("repainting an unchanged freedraw stroke does not recompute its outline", () => {
    const points: [number, number][] = []
    for (let i = 0; i < 50; i++) points.push([i * 2, Math.sin(i / 5) * 10 + 10])
    const stroke = newElement("freedraw", {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      points,
      pressures: points.map(() => 0.5),
      lastCommittedPoint: points[points.length - 1]!,
      index: "a0",
    })
    const scene = new Scene([stroke])
    const cache = new ShapeCache()
    const frame = () =>
      renderStaticScene(recordingCanvas().ctx, {
        scene,
        appState: DEFAULT_APP_STATE,
        width: 800,
        height: 600,
        dpr: 1,
        theme: "light",
        cache,
      })
    strokeCalls.n = 0
    frame()
    frame()
    frame()
    expect(strokeCalls.n).toBe(1)
  })
})
