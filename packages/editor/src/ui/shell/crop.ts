import type { BinaryFiles } from "@nib/core"

export interface DecodedImage {
  width: number
  height: number
}

/** The part of ImageCache cropping waits on. */
export interface DecodeSource {
  get(fileId: string): DecodedImage | null
  hasFailed(fileId: string): boolean
  sync(files: BinaryFiles): void
  onDecoded(cb: () => void): () => void
}

/**
 * Calls `ready` with the image's bitmap once it has decoded, at once if it already has, or `failed` when
 * it cannot be: its data is missing or did not decode. Returns a cancel for a pending wait.
 */
export const whenDecoded = (
  images: DecodeSource,
  fileId: string,
  files: BinaryFiles,
  handlers: { ready(image: DecodedImage): void; failed(): void },
): (() => void) => {
  const settle = (): boolean => {
    const image = images.get(fileId)
    if (image) {
      handlers.ready(image)
      return true
    }
    if (!files[fileId] || images.hasFailed(fileId)) {
      handlers.failed()
      return true
    }
    return false
  }
  if (settle()) return () => {}
  let off: (() => void) | null = null
  off = images.onDecoded(() => {
    if (off && settle()) {
      off()
      off = null
    }
  })
  // the painter may not have asked for this file yet, such as an image scrolled off the board
  images.sync(files)
  return () => {
    off?.()
    off = null
  }
}
