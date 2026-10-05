import cascadiaCodeArabic from "@fontsource/cascadia-code/files/cascadia-code-arabic-400-normal.woff2?url"
import cascadiaCodeBraille from "@fontsource/cascadia-code/files/cascadia-code-braille-400-normal.woff2?url"
import cascadiaCodeCyrillic from "@fontsource/cascadia-code/files/cascadia-code-cyrillic-400-normal.woff2?url"
import cascadiaCodeCyrillicExt from "@fontsource/cascadia-code/files/cascadia-code-cyrillic-ext-400-normal.woff2?url"
import cascadiaCodeGreek from "@fontsource/cascadia-code/files/cascadia-code-greek-400-normal.woff2?url"
import cascadiaCodeHebrew from "@fontsource/cascadia-code/files/cascadia-code-hebrew-400-normal.woff2?url"
import cascadiaCodeLatin from "@fontsource/cascadia-code/files/cascadia-code-latin-400-normal.woff2?url"
import cascadiaCodeLatinExt from "@fontsource/cascadia-code/files/cascadia-code-latin-ext-400-normal.woff2?url"
import cascadiaCodeSymbols2 from "@fontsource/cascadia-code/files/cascadia-code-symbols2-400-normal.woff2?url"
import cascadiaCodeVietnamese from "@fontsource/cascadia-code/files/cascadia-code-vietnamese-400-normal.woff2?url"
import cascadiaCodeRanges from "@fontsource/cascadia-code/unicode.json"
import nunitoCyrillic from "@fontsource/nunito/files/nunito-cyrillic-400-normal.woff2?url"
import nunitoCyrillicExt from "@fontsource/nunito/files/nunito-cyrillic-ext-400-normal.woff2?url"
import nunitoLatin from "@fontsource/nunito/files/nunito-latin-400-normal.woff2?url"
import nunitoLatinExt from "@fontsource/nunito/files/nunito-latin-ext-400-normal.woff2?url"
import nunitoVietnamese from "@fontsource/nunito/files/nunito-vietnamese-400-normal.woff2?url"
import nunitoRanges from "@fontsource/nunito/unicode.json"
import shantellSansCyrillic from "@fontsource/shantell-sans/files/shantell-sans-cyrillic-400-normal.woff2?url"
import shantellSansCyrillicExt from "@fontsource/shantell-sans/files/shantell-sans-cyrillic-ext-400-normal.woff2?url"
import shantellSansLatin from "@fontsource/shantell-sans/files/shantell-sans-latin-400-normal.woff2?url"
import shantellSansLatinExt from "@fontsource/shantell-sans/files/shantell-sans-latin-ext-400-normal.woff2?url"
import shantellSansVietnamese from "@fontsource/shantell-sans/files/shantell-sans-vietnamese-400-normal.woff2?url"
import shantellSansRanges from "@fontsource/shantell-sans/unicode.json"
import type { FontFaceFile } from "./embedFonts"

/** The bundled OFL faces (regular weight), one file per Unicode subset, as built asset URLs. */
export const BUNDLED_FONT_FILES: readonly FontFaceFile[] = [
  {
    family: "hand",
    name: "Shantell Sans",
    subset: "latin",
    unicodeRange: shantellSansRanges.latin,
    url: shantellSansLatin,
  },
  {
    family: "hand",
    name: "Shantell Sans",
    subset: "latin-ext",
    unicodeRange: shantellSansRanges["latin-ext"],
    url: shantellSansLatinExt,
  },
  {
    family: "hand",
    name: "Shantell Sans",
    subset: "cyrillic",
    unicodeRange: shantellSansRanges.cyrillic,
    url: shantellSansCyrillic,
  },
  {
    family: "hand",
    name: "Shantell Sans",
    subset: "cyrillic-ext",
    unicodeRange: shantellSansRanges["cyrillic-ext"],
    url: shantellSansCyrillicExt,
  },
  {
    family: "hand",
    name: "Shantell Sans",
    subset: "vietnamese",
    unicodeRange: shantellSansRanges.vietnamese,
    url: shantellSansVietnamese,
  },
  {
    family: "normal",
    name: "Nunito",
    subset: "latin",
    unicodeRange: nunitoRanges.latin,
    url: nunitoLatin,
  },
  {
    family: "normal",
    name: "Nunito",
    subset: "latin-ext",
    unicodeRange: nunitoRanges["latin-ext"],
    url: nunitoLatinExt,
  },
  {
    family: "normal",
    name: "Nunito",
    subset: "cyrillic",
    unicodeRange: nunitoRanges.cyrillic,
    url: nunitoCyrillic,
  },
  {
    family: "normal",
    name: "Nunito",
    subset: "cyrillic-ext",
    unicodeRange: nunitoRanges["cyrillic-ext"],
    url: nunitoCyrillicExt,
  },
  {
    family: "normal",
    name: "Nunito",
    subset: "vietnamese",
    unicodeRange: nunitoRanges.vietnamese,
    url: nunitoVietnamese,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "latin",
    unicodeRange: cascadiaCodeRanges.latin,
    url: cascadiaCodeLatin,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "latin-ext",
    unicodeRange: cascadiaCodeRanges["latin-ext"],
    url: cascadiaCodeLatinExt,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "cyrillic",
    unicodeRange: cascadiaCodeRanges.cyrillic,
    url: cascadiaCodeCyrillic,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "cyrillic-ext",
    unicodeRange: cascadiaCodeRanges["cyrillic-ext"],
    url: cascadiaCodeCyrillicExt,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "greek",
    unicodeRange: cascadiaCodeRanges.greek,
    url: cascadiaCodeGreek,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "hebrew",
    unicodeRange: cascadiaCodeRanges.hebrew,
    url: cascadiaCodeHebrew,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "arabic",
    unicodeRange: cascadiaCodeRanges.arabic,
    url: cascadiaCodeArabic,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "vietnamese",
    unicodeRange: cascadiaCodeRanges.vietnamese,
    url: cascadiaCodeVietnamese,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "symbols2",
    unicodeRange: cascadiaCodeRanges.symbols2,
    url: cascadiaCodeSymbols2,
  },
  {
    family: "code",
    name: "Cascadia Code",
    subset: "braille",
    unicodeRange: cascadiaCodeRanges.braille,
    url: cascadiaCodeBraille,
  },
]
