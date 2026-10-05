import type { PlatformPrefs } from "@nib/platform"
import type { KeyLike } from "../../src/hooks/useShortcuts"

export const memoryPrefs = (
  seed: Record<string, string> = {},
): PlatformPrefs & { store: Map<string, string> } => {
  const store = new Map(Object.entries(seed))
  return {
    store,
    get: (k) => store.get(k) ?? null,
    set: (k, v) => {
      if (v === null) store.delete(k)
      else store.set(k, v)
    },
  }
}

export interface FakeKey extends KeyLike {
  prevented: boolean
  preventDefault(): void
  stopPropagation(): void
}

/** A keydown as the browser delivers it; `target` defaults to the page body. */
export const keydown = (k: Partial<KeyLike> & { key: string; code: string }): FakeKey => {
  const e: FakeKey = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: "BODY", getAttribute: () => null },
    prevented: false,
    preventDefault() {
      e.prevented = true
      e.defaultPrevented = true
    },
    stopPropagation() {},
    ...k,
  }
  return e
}

export const elementTarget = (tagName: string, attrs: Record<string, string> = {}) => ({
  tagName,
  type: attrs.type,
  isContentEditable: false,
  getAttribute: (n: string) => attrs[n] ?? null,
})

export const noop = () => {}

export const attrsOf = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))].map(([, attrs = ""]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })
