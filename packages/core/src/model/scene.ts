import type { ElementsChange } from "../change/elementsChange"
import { randomInteger } from "../math/random"
import type { BinaryFiles, NibElement } from "./types"
import { indexBetween, indicesBetween, isValidIndex } from "./zindex"

/**
 * Ordered element store. Holds soft-deleted elements too, because undo,
 * history and collaboration all need to resurrect them by id.
 */
export class Scene {
  private byId = new Map<string, NibElement>()
  private sortedCache: NibElement[] | null = null
  private nonDeletedCache: NibElement[] | null = null
  private listeners = new Set<() => void>()
  files: BinaryFiles = {}

  constructor(elements: readonly NibElement[] = [], files: BinaryFiles = {}) {
    this.byId = new Map(normalizeIndices(elements).map((e) => [e.id, e]))
    this.files = { ...files }
  }

  getElements(): readonly NibElement[] {
    if (!this.sortedCache) {
      this.sortedCache = [...this.byId.values()].sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
      )
    }
    return this.sortedCache
  }

  getNonDeleted(): readonly NibElement[] {
    if (!this.nonDeletedCache) this.nonDeletedCache = this.getElements().filter((e) => !e.isDeleted)
    return this.nonDeletedCache
  }

  get(id: string): NibElement | undefined {
    return this.byId.get(id)
  }

  getMany(ids: Iterable<string>): NibElement[] {
    const out: NibElement[] = []
    for (const id of ids) {
      const el = this.byId.get(id)
      if (el) out.push(el)
    }
    return out
  }

  snapshot(): ReadonlyMap<string, NibElement> {
    return new Map(this.byId)
  }

  lastIndex(): string | null {
    const els = this.getElements()
    return els.length ? els[els.length - 1]!.index : null
  }

  nextIndex(): string {
    return indexBetween(this.lastIndex(), null)
  }

  /** `n` ascending keys above everything in the scene. */
  nextIndices(n: number): string[] {
    return n > 0 ? indicesBetween(this.lastIndex(), null, n) : []
  }

  replaceAll(elements: readonly NibElement[], files?: BinaryFiles): void {
    this.byId = new Map(normalizeIndices(elements).map((e) => [e.id, e]))
    if (files) this.files = { ...files }
    this.invalidate()
  }

  insert(el: NibElement): void {
    this.byId.set(el.id, el)
    this.invalidate()
  }

  insertMany(els: readonly NibElement[]): void {
    for (const el of els) this.byId.set(el.id, el)
    this.invalidate()
  }

  update(el: NibElement): void {
    this.byId.set(el.id, el)
    this.invalidate()
  }

  updateMany(els: readonly NibElement[]): void {
    for (const el of els) this.byId.set(el.id, el)
    this.invalidate()
  }

  remove(id: string): void {
    this.byId.delete(id)
    this.invalidate()
  }

  /**
   * Applies the `after` side of a change. Restored elements get a version above
   * both the stored and the current one, so versions only ever move forward and
   * version-keyed caches never serve a drawing made for other content.
   */
  applyChanges(change: ElementsChange): void {
    for (const [id, el] of change.after) {
      if (el === null) {
        this.byId.delete(id)
        continue
      }
      const current = this.byId.get(id)
      this.byId.set(id, {
        ...el,
        version: Math.max(el.version, current?.version ?? 0) + 1,
        versionNonce: randomInteger(),
      })
    }
    this.invalidate()
  }

  addFile(id: string, file: BinaryFiles[string]): void {
    this.files = { ...this.files, [id]: file }
    this.invalidate()
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private invalidate(): void {
    this.sortedCache = null
    this.nonDeletedCache = null
    for (const l of this.listeners) l()
  }
}

/**
 * Files written by other tools (or by older versions) can carry duplicate,
 * unordered or malformed z-indices, which makes reordering ambiguous or makes
 * the next key impossible to generate. Rewrite them once on load, preserving
 * the array order the file already implies.
 */
export const normalizeIndices = (elements: readonly NibElement[]): readonly NibElement[] => {
  let previous: string | null = null
  let needsFix = false
  for (const el of elements) {
    if (!isValidIndex(el.index) || (previous !== null && el.index <= previous)) {
      needsFix = true
      break
    }
    previous = el.index
  }
  if (!needsFix) return elements
  const keys = indicesBetween(null, null, elements.length)
  return elements.map((el, i) => ({ ...el, index: keys[i]! }))
}
