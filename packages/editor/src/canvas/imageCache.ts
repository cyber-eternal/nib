import type { BinaryFiles } from "@nib/core"

interface Entry {
  image: HTMLImageElement
  width: number
  height: number
}

/**
 * Decodes data URLs once and tells the renderer when a new bitmap is ready. It holds only the current
 * scene's files: New and Open reuse one cache, and a decoded photo can take tens of MB.
 */
export class ImageCache {
  private entries = new Map<string, Entry>()
  private loading = new Map<string, HTMLImageElement>()
  /** Data URLs that failed to decode, by file id; skipped until the file's data changes. */
  private failed = new Map<string, string>()
  private listeners = new Set<() => void>()
  private decodes = 0
  private synced: BinaryFiles | null = null

  /** Fires whenever a new bitmap finishes decoding. */
  onDecoded(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Bumps on every finished decode, so a painter can tell its bitmaps changed. */
  get version(): number {
    return this.decodes
  }

  get(fileId: string): Entry | null {
    return this.entries.get(fileId) ?? null
  }

  hasFailed(fileId: string): boolean {
    return this.failed.has(fileId)
  }

  put(fileId: string, entry: Entry): void {
    this.entries.set(fileId, entry)
    this.failed.delete(fileId)
  }

  get size(): number {
    return this.entries.size
  }

  /** Drops every bitmap, pending decode and failure whose file is not in `files`. */
  retain(files: BinaryFiles): void {
    for (const id of this.entries.keys()) if (!(id in files)) this.entries.delete(id)
    for (const id of this.failed.keys()) if (!(id in files)) this.failed.delete(id)
    for (const [id, img] of this.loading) {
      if (id in files) continue
      img.onload = null
      img.onerror = null
      this.loading.delete(id)
    }
  }

  sync(files: BinaryFiles, createImage: () => HTMLImageElement = () => new Image()): void {
    // the scene replaces its files object on every change, so an unchanged one needs no work
    if (files === this.synced) return
    this.synced = files
    this.retain(files)
    for (const [id, file] of Object.entries(files)) {
      if (this.entries.has(id) || this.loading.has(id)) continue
      if (this.failed.get(id) === file.dataURL) continue
      this.failed.delete(id)
      const img = createImage()
      this.loading.set(id, img)
      img.onload = () => {
        if (this.loading.get(id) !== img) return
        this.entries.set(id, { image: img, width: img.naturalWidth, height: img.naturalHeight })
        this.loading.delete(id)
        this.decodes++
        for (const listener of this.listeners) listener()
      }
      img.onerror = () => {
        if (this.loading.get(id) !== img) return
        this.loading.delete(id)
        this.failed.set(id, file.dataURL)
        this.decodes++
        for (const listener of this.listeners) listener()
      }
      img.src = file.dataURL
    }
  }
}

export const loadImageFile = (
  file: File,
): Promise<{ dataURL: string; width: number; height: number; mimeType: string }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read the image"))
    reader.onload = () => {
      const dataURL = String(reader.result)
      const img = new Image()
      img.onload = () =>
        resolve({ dataURL, width: img.naturalWidth, height: img.naturalHeight, mimeType: file.type })
      img.onerror = () => reject(new Error("Could not decode the image"))
      img.src = dataURL
    }
    reader.readAsDataURL(file)
  })
