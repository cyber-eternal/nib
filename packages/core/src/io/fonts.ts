import type { FontFamily } from "../model/types"

// Excalidraw's FONT_FAMILY: Virgil 1, Helvetica 2, Cascadia 3, Local 4, Excalifont 5, Nunito 6,
// Lilita One 7, Comic Shanns 8, Liberation Sans 9, Assistant 10
const FAMILY_BY_CODE: Record<number, FontFamily> = {
  1: "hand",
  2: "normal",
  3: "code",
  4: "normal",
  5: "hand",
  6: "normal",
  7: "normal",
  8: "code",
  9: "normal",
  10: "normal",
}

const CODE_BY_FAMILY: Record<FontFamily, number> = { hand: 5, normal: 6, code: 3, serif: 6, mono: 3 }

export const fontFamilyFromExcalidraw = (code: number): FontFamily => FAMILY_BY_CODE[code] ?? "hand"

/** Prefers the code the element was imported with, so an untouched Excalidraw font round-trips exactly. */
export const fontFamilyToExcalidraw = (family: FontFamily, importedCode?: unknown): number => {
  if (typeof importedCode === "number" && FAMILY_BY_CODE[importedCode] === family) return importedCode
  return CODE_BY_FAMILY[family] ?? 5
}
