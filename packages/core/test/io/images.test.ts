import { describe, expect, test } from "vitest"
import {
  MAX_IMAGE_SIDE,
  RECOMPRESS_BYTES,
  bytesToBase64,
  dataUrlOf,
  fitImageSize,
  isWebSafeImageType,
  planImageImport,
  svgIntrinsicSize,
} from "../../src/io/images"
import { normalizeFiles } from "../../src/io/nibFile"

const MB = 1024 * 1024

describe("image import plan", () => {
  test("large images fit 2560px on the long side, keeping their aspect", () => {
    expect(MAX_IMAGE_SIDE).toBe(2560)
    expect(fitImageSize(4000, 3000)).toEqual({ width: 2560, height: 1920, scaled: true })
    expect(fitImageSize(1000, 6000)).toEqual({ width: 427, height: 2560, scaled: true })
    expect(fitImageSize(800, 600)).toEqual({ width: 800, height: 600, scaled: false })
    expect(fitImageSize(Number.NaN, -1)).toEqual({ width: 1, height: 1, scaled: false })
  })

  test("a big photo is scaled down and re-encoded as WebP or JPEG", () => {
    expect(planImageImport({ mimeType: "image/jpeg", width: 6000, height: 4000, bytes: 8 * MB })).toEqual({
      action: "reencode",
      width: 2560,
      height: 1707,
      formats: ["image/webp", "image/jpeg"],
      lossyOnlyIfOpaque: false,
      quality: 0.85,
    })
  })

  test("a big PNG stays lossless unless it turns out to be opaque", () => {
    const plan = planImageImport({ mimeType: "image/png", width: 3000, height: 3000, bytes: 5 * MB })
    expect(plan).toMatchObject({ action: "reencode", width: 2560, height: 2560, lossyOnlyIfOpaque: true })
    expect(plan.action === "reencode" && plan.formats[0]).toBe("image/png")
  })

  test("a heavy file within the size limit is recompressed without scaling", () => {
    expect(
      planImageImport({ mimeType: "image/png", width: 2000, height: 1500, bytes: RECOMPRESS_BYTES + 1 }),
    ).toMatchObject({ action: "reencode", width: 2000, height: 1500 })
  })

  test("small web images, SVG, GIF and an explicit opt-in are kept as they are", () => {
    expect(planImageImport({ mimeType: "image/png", width: 800, height: 600, bytes: 200_000 })).toEqual({
      action: "keep",
      reason: "small",
    })
    expect(
      planImageImport({ mimeType: "image/svg+xml", width: 9000, height: 9000, bytes: 9 * MB }).action,
    ).toBe("keep")
    expect(planImageImport({ mimeType: "image/gif", width: 4000, height: 4000, bytes: 9 * MB })).toEqual({
      action: "keep",
      reason: "animated",
    })
    expect(
      planImageImport(
        { mimeType: "image/jpeg", width: 6000, height: 4000, bytes: 9 * MB },
        { keepOriginal: true },
      ),
    ).toEqual({ action: "keep", reason: "requested" })
  })

  test("formats other browsers can't draw are always converted", () => {
    expect(planImageImport({ mimeType: "image/bmp", width: 10, height: 10, bytes: 400 }).action).toBe(
      "reencode",
    )
    expect(planImageImport({ mimeType: "image/heic", width: 10, height: 10, bytes: 400 }).action).toBe(
      "reencode",
    )
    expect(isWebSafeImageType("image/WEBP")).toBe(true)
    expect(isWebSafeImageType("image/tiff")).toBe(false)
  })

  test("maxSide can be lowered", () => {
    expect(
      planImageImport({ mimeType: "image/jpeg", width: 2000, height: 1000, bytes: 100 }, { maxSide: 1000 }),
    ).toMatchObject({ width: 1000, height: 500 })
  })
})

describe("SVG intrinsic size", () => {
  test("width and height, or viewBox, or both", () => {
    expect(svgIntrinsicSize('<svg width="120" height="80px">')).toEqual({ width: 120, height: 80 })
    expect(svgIntrinsicSize('<svg viewBox="0 0 300 150">')).toEqual({ width: 300, height: 150 })
    expect(svgIntrinsicSize("<svg width='600' viewBox='0,0,300,150'>")).toEqual({ width: 600, height: 300 })
    expect(svgIntrinsicSize('<svg width="100%" height="100%">')).toBeNull()
    expect(svgIntrinsicSize("<div/>")).toBeNull()
  })
})

describe("data URLs without a DOM", () => {
  test("base64 matches the standard encoding for every padding length", () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s))
    expect([enc(""), enc("f"), enc("fo"), enc("foo"), enc("foob")]).toEqual([
      "",
      "Zg==",
      "Zm8=",
      "Zm9v",
      "Zm9vYg==",
    ])
    expect(bytesToBase64(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe("//79")
  })

  test("the data URL is one a reopened file keeps", () => {
    const url = dataUrlOf("image/png", new Uint8Array([137, 80, 78, 71]))
    expect(Object.keys(normalizeFiles({ f: { dataURL: url } }))).toEqual(["f"])
  })
})
