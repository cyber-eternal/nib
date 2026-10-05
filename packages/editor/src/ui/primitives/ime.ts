export interface ImeKeyLike {
  keyCode?: number
  isComposing?: boolean
  nativeEvent?: { isComposing?: boolean }
}

/**
 * True for a keydown that belongs to an input method rather than the field. WebKit sends the keydown that
 * confirms or cancels a candidate after compositionend, with isComposing false but keyCode 229.
 */
export const isImeKey = (e: ImeKeyLike): boolean =>
  e.nativeEvent?.isComposing === true || e.isComposing === true || e.keyCode === 229
