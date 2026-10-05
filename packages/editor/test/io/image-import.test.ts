import { EditorCore, type ImageElement, type ImageEncoding } from "@nib/core"
import { describe, expect, test } from "vitest"
import { ingestFiles } from "../../src/document/clipboard"
import {
  type DecodedImage,
  type ImageDecoder,
  NOT_AN_IMAGE,
  prepareImage,
} from "../../src/document/imageImport"

const MB = 1024 * 1024

interface FakeDecoderOptions {
  width: number
  height: number
  alpha?: boolean
  /** Bytes each format encodes to; a missing format can't be written. */
  sizes?: Partial<Record<ImageEncoding, number>>
  /** What the "browser" hands back instead, e.g. PNG for an unsupported WebP. */
  substitute?: Partial<Record<ImageEncoding, string>>
}

const fakeDecoder = (o: FakeDecoderOptions) => {
  const encodes: [number, number, string][] = []
  let closed = 0
  const decode: ImageDecoder = async () =>
    ({
      width: o.width,
      height: o.height,
      async encode(w, h, type) {
        encodes.push([w, h, type])
        const size = o.sizes?.[type]
        if (size === undefined) return null
        return new Blob([new Uint8Array(size)], { type: o.substitute?.[type] ?? type })
      },
      hasAlpha: () => o.alpha ?? false,
      close: () => {
        closed++
      },
    }) satisfies DecodedImage
  return { decode, encodes, closed: () => closed }
}

const fileOf = (bytes: number, type: string, name = "photo") =>
  new File([new Uint8Array(bytes)], name, { type })

describe("prepareImage", () => {
  test("a 6000px photo is stored at 2560px in the smaller of WebP and JPEG", async () => {
    const d = fakeDecoder({
      width: 6000,
      height: 4000,
      sizes: { "image/webp": 300_000, "image/jpeg": 400_000 },
    })
    const out = await prepareImage(fileOf(8 * MB, "image/jpeg"), "image/jpeg", { decode: d.decode })
    expect([out.width, out.height, out.mimeType, out.converted]).toEqual([2560, 1707, "image/webp", true])
    expect(out.dataURL.startsWith("data:image/webp;base64,")).toBe(true)
    expect(d.encodes.map((e) => e[2])).toEqual(["image/webp", "image/jpeg"])
    expect(d.closed()).toBe(1)
  })

  test("a browser that can't write WebP falls back to JPEG", async () => {
    const d = fakeDecoder({
      width: 5000,
      height: 5000,
      sizes: { "image/webp": 100, "image/jpeg": 500_000 },
      substitute: { "image/webp": "image/png" },
    })
    const out = await prepareImage(fileOf(6 * MB, "image/jpeg"), "image/jpeg", { decode: d.decode })
    expect(out.mimeType).toBe("image/jpeg")
  })

  test("a transparent PNG stays PNG even when a lossy encoding would be smaller", async () => {
    const d = fakeDecoder({
      width: 4000,
      height: 2000,
      alpha: true,
      sizes: { "image/png": 900_000, "image/webp": 100_000, "image/jpeg": 80_000 },
    })
    const out = await prepareImage(fileOf(3 * MB, "image/png"), "image/png", { decode: d.decode })
    expect([out.mimeType, out.width, out.height]).toEqual(["image/png", 2560, 1280])
    expect(d.encodes.map((e) => e[2])).toEqual(["image/png"])
  })

  test("an opaque PNG screenshot may go lossy when that is smaller", async () => {
    const d = fakeDecoder({
      width: 4000,
      height: 2000,
      sizes: { "image/png": 900_000, "image/webp": 150_000, "image/jpeg": 200_000 },
    })
    const out = await prepareImage(fileOf(3 * MB, "image/png"), "image/png", { decode: d.decode })
    expect(out.mimeType).toBe("image/webp")
  })

  test("a small image is stored byte for byte", async () => {
    const d = fakeDecoder({ width: 800, height: 600, sizes: { "image/png": 1 } })
    const out = await prepareImage(fileOf(50_000, "image/png"), "image/png", { decode: d.decode })
    expect([out.width, out.height, out.mimeType, out.converted]).toEqual([800, 600, "image/png", false])
    expect(d.encodes).toEqual([])
  })

  test("recompressing that doesn't make a heavy file smaller keeps the original", async () => {
    const d = fakeDecoder({ width: 2000, height: 1000, sizes: { "image/png": 3 * MB, "image/webp": 3 * MB } })
    const out = await prepareImage(fileOf(2 * MB, "image/png"), "image/png", { decode: d.decode })
    expect([out.mimeType, out.converted]).toEqual(["image/png", false])
  })

  test("keepOriginal stores a large photo untouched", async () => {
    const d = fakeDecoder({ width: 6000, height: 4000, sizes: { "image/jpeg": 1 } })
    const out = await prepareImage(fileOf(8 * MB, "image/jpeg"), "image/jpeg", {
      decode: d.decode,
      keepOriginal: true,
    })
    expect([out.width, out.converted]).toEqual([6000, false])
  })

  test("a BMP is always converted, and fails cleanly when it can't be", async () => {
    const ok = fakeDecoder({ width: 10, height: 10, sizes: { "image/png": 100 } })
    expect((await prepareImage(fileOf(400, "image/bmp"), "image/bmp", { decode: ok.decode })).mimeType).toBe(
      "image/png",
    )
    const none = fakeDecoder({ width: 10, height: 10 })
    await expect(
      prepareImage(fileOf(400, "image/bmp"), "image/bmp", { decode: none.decode }),
    ).rejects.toThrow(NOT_AN_IMAGE)
  })

  test("an SVG keeps its markup and takes its size from its own attributes", async () => {
    const d = fakeDecoder({ width: 300, height: 150 })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"/>'
    const out = await prepareImage(new Blob([svg]), "image/svg+xml", { decode: d.decode })
    expect([out.width, out.height, out.mimeType]).toEqual([64, 32, "image/svg+xml"])
    expect(atob(out.dataURL.split(",")[1]!)).toBe(svg)
  })

  test("a file the decoder rejects reports that it isn't an image", async () => {
    const decode: ImageDecoder = async () => {
      throw new Error("decode failed")
    }
    await expect(prepareImage(fileOf(10, "image/png"), "image/png", { decode })).rejects.toThrow(NOT_AN_IMAGE)
  })
})

describe("dropped images go through the import pipeline", () => {
  test("ingestFiles stores the scaled-down bitmap and its size", async () => {
    const core = new EditorCore()
    const d = fakeDecoder({ width: 5120, height: 2560, sizes: { "image/webp": 1000, "image/jpeg": 2000 } })
    const result = await ingestFiles(core, [fileOf(5 * MB, "image/jpeg", "big.jpg")], [0, 0], {
      decodeImage: d.decode,
    })
    expect(result).toMatchObject({ images: 1, errors: [] })
    const image = core.scene.getNonDeleted().find((e): e is ImageElement => e.type === "image")!
    const file = core.scene.files[image.fileId!]!
    expect(file.mimeType).toBe("image/webp")
    expect(image.width / image.height).toBeCloseTo(2)
  })

  test("an undecodable file is reported by name", async () => {
    const core = new EditorCore()
    const decode: ImageDecoder = async () => {
      throw new Error("nope")
    }
    const result = await ingestFiles(core, [fileOf(10, "image/png", "broken.png")], [0, 0], {
      mode: "insert-image",
      decodeImage: decode,
    })
    expect(result.errors).toEqual([`broken.png: ${NOT_AN_IMAGE}`])
    expect(core.scene.getNonDeleted()).toHaveLength(0)
  })
})
