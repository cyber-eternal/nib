import { DEFAULT_APP_STATE, newElement } from "@nib/core"
import { describe, expect, test } from "vitest"
import {
  MAX_EXPORT_AREA,
  MAX_EXPORT_SIDE,
  effectiveExportScale,
  embedSceneInPng,
  exportToSvgString,
  extractSceneFromPng,
} from "../../src/export/exportImage"

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** A 1x1 PNG skeleton (signature, IHDR, extra chunks, IEND); pixel data is irrelevant to text chunks. */
const png = (...extra: Uint8Array[]): Blob => {
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, 1)
  new DataView(ihdr.buffer).setUint32(4, 1)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IEND", new Uint8Array()),
  ]
  return new Blob(parts as BlobPart[], { type: "image/png" })
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const textChunk = (keyword: string, text: Uint8Array) => {
  const data = new Uint8Array(keyword.length + 1 + text.length)
  data.set(latin1(keyword), 0)
  data.set(text, keyword.length + 1)
  return chunk("tEXt", data)
}

const deflate = async (bytes: Uint8Array) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  )

const chunkTypes = async (blob: Blob): Promise<string[]> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const types: string[] = []
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset)
    types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)))
    offset += 12 + length
  }
  return types
}

describe("IO PNG scene chunks", () => {
  test("a scene with non-Latin-1 text survives a PNG round trip in a compressed iTXt chunk", async () => {
    const scene = JSON.stringify({
      type: "nib",
      version: 1,
      elements: [],
      note: "Привет, 世界 ✓".repeat(50),
    })
    const out = await embedSceneInPng(png(), scene)
    expect(await chunkTypes(out)).toEqual(["IHDR", "iTXt", "IEND"])
    const bytes = new Uint8Array(await out.arrayBuffer())
    expect(String.fromCharCode(...bytes.subarray(41, 45))).toBe("nib\0")
    expect(out.size).toBeLessThan(png().size + new TextEncoder().encode(scene).length)
    await expect(extractSceneFromPng(out)).resolves.toBe(scene)
  })

  test("PNGs written by earlier builds (UTF-8 in tEXt) still open", async () => {
    const scene = JSON.stringify({ type: "nib", elements: [], name: "Zürich" })
    const earlier = png(textChunk("nib", new TextEncoder().encode(scene)))
    await expect(extractSceneFromPng(earlier)).resolves.toBe(scene)
  })

  test("Excalidraw's compressed scene PNGs are recognised", async () => {
    const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: { name: "Büro" } })
    const deflated = await deflate(new TextEncoder().encode(scene))
    const envelope = JSON.stringify({
      version: "1",
      encoding: "bstring",
      compressed: true,
      encoded: String.fromCharCode(...deflated),
    })
    const file = png(textChunk("application/vnd.excalidraw+json", latin1(envelope)))
    await expect(extractSceneFromPng(file)).resolves.toBe(scene)
  })

  test("Excalidraw's uncompressed scene PNGs are recognised", async () => {
    const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: { name: "Café" } })
    const encoded = String.fromCharCode(...new TextEncoder().encode(scene))
    const envelope = JSON.stringify({ version: "1", encoding: "bstring", compressed: false, encoded })
    const file = png(textChunk("application/vnd.excalidraw+json", latin1(envelope)))
    await expect(extractSceneFromPng(file)).resolves.toBe(scene)
  })

  test("a PNG without a scene, or with a damaged chunk, yields null", async () => {
    await expect(extractSceneFromPng(png())).resolves.toBeNull()
    const broken = png(
      textChunk("application/vnd.excalidraw+json", latin1('{"encoded":"x","compressed":true}')),
    )
    await expect(extractSceneFromPng(broken)).resolves.toBeNull()
  })
})

describe("IO PNG export size limits", () => {
  const options = (elements: ReturnType<typeof newElement>[], scale: number) => ({
    elements,
    appState: DEFAULT_APP_STATE,
    files: {},
    scale,
    exportBackground: true,
    theme: "light" as const,
  })

  test("a large scene is exported at a reduced scale that fits the canvas limits", () => {
    const elements = [
      newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" }),
      newElement("rectangle", { x: 15000, y: 9000, width: 10, height: 10, index: "a1" }),
    ]
    const opts = options(elements, 3)
    const scale = effectiveExportScale(opts)
    expect(scale).toBeLessThan(1)
    const w = (15010 + 32) * scale
    const h = (9010 + 32) * scale
    expect(w).toBeLessThanOrEqual(MAX_EXPORT_SIDE + 4)
    expect(w * h).toBeLessThanOrEqual(MAX_EXPORT_AREA * 1.01)
  })

  test("a small scene keeps the requested scale", () => {
    const elements = [newElement("rectangle", { x: 0, y: 0, width: 100, height: 100, index: "a0" })]
    expect(effectiveExportScale(options(elements, 3))).toBe(3)
    expect(effectiveExportScale(options(elements, Number.NaN))).toBe(1)
  })
})

describe("exporting one frame", () => {
  const frame = newElement("frame", {
    id: "f",
    x: 100,
    y: 50,
    width: 400,
    height: 300,
    name: "Slide",
    index: "a0",
  })
  const inside = newElement("rectangle", { x: 150, y: 100, width: 50, height: 50, frameId: "f", index: "a1" })
  // sticks out past the frame's right edge: clipped, so it must not widen the image
  const overflowing = newElement("rectangle", {
    x: 450,
    y: 100,
    width: 300,
    height: 50,
    frameId: "f",
    index: "a2",
  })
  const outside = newElement("ellipse", { x: 2000, y: 2000, width: 50, height: 50, index: "a3" })
  const opts = {
    elements: [frame, inside, overflowing, outside],
    appState: DEFAULT_APP_STATE,
    files: {},
    scale: 1,
    exportBackground: true,
    theme: "light" as const,
    frameId: "f",
  }

  test("the SVG is exactly the frame, holds only its contents, and leaves out its border and name", () => {
    const svg = exportToSvgString(opts)
    expect(svg).toContain('width="400" height="300" viewBox="0 0 400 300"')
    expect(svg).not.toContain(">Slide<")
    // each child sits in its own clip group; the ellipse outside the frame is not drawn
    expect((svg.match(/<g clip-path=/g) ?? []).length).toBe(2)
    expect(svg).not.toContain("translate(2000 2000)")
  })

  test("the PNG is sized to the frame too, whatever its clipped contents reach", () => {
    const huge = newElement("rectangle", {
      x: 450,
      y: 100,
      width: 20000,
      height: 50,
      frameId: "f",
      index: "a4",
    })
    const withHuge = { ...opts, elements: [...opts.elements, huge], scale: 2 }
    expect(effectiveExportScale({ ...withHuge, frameId: null })).toBeLessThan(1)
    expect(effectiveExportScale(withHuge)).toBe(2)
  })
})
