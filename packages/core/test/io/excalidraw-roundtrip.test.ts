import { describe, expect, test } from "vitest"
import { parseExcalidraw, toExcalidraw } from "../../src/io/excalidraw"
import { serializeNib } from "../../src/io/nibFile"
import { newElement } from "../../src/model/element"
import { DEFAULT_APP_STATE } from "../../src/model/types"

const roundTrip = (elements: unknown[]) => {
  const parsed = parseExcalidraw(JSON.stringify({ type: "excalidraw", version: 2, elements, files: {} }))
  if (!parsed.ok) throw new Error(parsed.error)
  return JSON.parse(toExcalidraw(parsed.elements, DEFAULT_APP_STATE)).elements as Record<string, unknown>[]
}

describe("IO excalidraw round trip", () => {
  test("binding fixedPoint survives import and export", () => {
    const [, arrow] = roundTrip([
      { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
      {
        id: "e",
        type: "arrow",
        x: 50,
        y: 100,
        width: 0,
        height: 100,
        elbowed: true,
        points: [
          [0, 0],
          [0, 100],
        ],
        startBinding: { elementId: "r", focus: 0, gap: 4, fixedPoint: [0.5, 1] },
        endBinding: null,
      },
    ])
    expect((arrow!.startBinding as { fixedPoint?: unknown }).fixedPoint).toEqual([0.5, 1])
  })

  test("a custom corner radius value survives import and export", () => {
    const [rect] = roundTrip([
      { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 100, roundness: { type: 3, value: 32 } },
    ])
    expect(rect!.roundness).toEqual({ type: 3, value: 32 })
  })

  test("embeddable elements are exported, not silently dropped", () => {
    const embed = newElement("embeddable", {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      index: "a0",
      link: "https://www.youtube.com/watch?v=abc",
    })
    const out = JSON.parse(toExcalidraw([embed], DEFAULT_APP_STATE)).elements
    expect(out.map((e: { type: string }) => e.type)).toEqual(["embeddable"])
  })

  test("a deleted image's file is not written into the .nibd file", () => {
    const img = newElement("image", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fileId: "secret",
      index: "a0",
      isDeleted: true,
    })
    const files = {
      secret: { id: "secret", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 0 },
    }
    const saved = JSON.parse(serializeNib([img], DEFAULT_APP_STATE, files))
    expect(Object.keys(saved.files)).toEqual([])
  })

  test("excalidraw export only carries files referenced by exported images", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })
    const files = {
      unused: { id: "unused", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 0 },
    }
    const out = JSON.parse(toExcalidraw([rect], DEFAULT_APP_STATE, files))
    expect(Object.keys(out.files)).toEqual([])
  })
})
