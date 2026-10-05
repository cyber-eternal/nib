import { describe, expect, test } from "vitest"
import { ElementsChange } from "../src/change/elementsChange"
import { History } from "../src/history/history"
import { duplicateElement, mutateElement, newElement } from "../src/model/element"
import { expandSelectionToGroups } from "../src/model/groups"
import { Scene } from "../src/model/scene"
import { computeMoveIndices } from "../src/model/zindex"

const rect = (over = {}) => newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, ...over })

describe("mutateElement", () => {
  test("bumps version and leaves the original untouched", () => {
    const a = rect()
    const b = mutateElement(a, { x: 5 })
    expect(a.x).toBe(0)
    expect(b.x).toBe(5)
    expect(b.version).toBe(a.version + 1)
    expect(b.versionNonce).not.toBe(a.versionNonce)
    expect(b.id).toBe(a.id)
  })
  test("a patch that changes nothing returns the same object", () => {
    const a = rect()
    expect(mutateElement(a, { x: 0 })).toBe(a)
  })
})

describe("duplicateElement", () => {
  test("gives a new identity", () => {
    const a = rect()
    const b = duplicateElement(a)
    expect(b.id).not.toBe(a.id)
    expect(b.seed).not.toBe(a.seed)
    expect(b.x).toBe(a.x)
  })
})

describe("Scene", () => {
  test("orders by fractional index", () => {
    const s = new Scene()
    const a = rect({ index: s.nextIndex() })
    s.insert(a)
    const b = rect({ index: s.nextIndex() })
    s.insert(b)
    expect(s.getElements().map((e) => e.id)).toEqual([a.id, b.id])
    expect(a.index < b.index).toBe(true)
  })
  test("notifies subscribers on update", () => {
    const s = new Scene()
    const a = rect()
    s.insert(a)
    let calls = 0
    s.subscribe(() => calls++)
    s.update(mutateElement(a, { x: 3 }))
    expect(calls).toBe(1)
    expect(s.get(a.id)!.x).toBe(3)
  })
  test("getNonDeleted filters tombstones", () => {
    const s = new Scene()
    const a = rect()
    s.insert(a)
    s.update(mutateElement(a, { isDeleted: true }))
    expect(s.getNonDeleted()).toHaveLength(0)
    expect(s.getElements()).toHaveLength(1)
  })
})

describe("ElementsChange", () => {
  test("round-trips an edit through inverse", () => {
    const a = rect()
    const s = new Scene([a])
    const before = s.snapshot()
    s.update(mutateElement(a, { x: 50 }))
    const change = ElementsChange.from(before, s)
    expect(change.before.get(a.id)!.x).toBe(0)
    s.applyChanges(ElementsChange.inverse(change))
    expect(s.get(a.id)!.x).toBe(0)
  })
  test("inverse of an insert removes the element outright", () => {
    const s = new Scene()
    const before = s.snapshot()
    const a = rect()
    s.insert(a)
    const change = ElementsChange.from(before, s)
    expect(change.before.get(a.id)).toBeNull()
    s.applyChanges(ElementsChange.inverse(change))
    expect(s.get(a.id)).toBeUndefined()
  })
})

describe("History", () => {
  test("undo and redo walk both directions", () => {
    const s = new Scene()
    const h = new History()
    const commit = (fn: () => void) => {
      const snap = s.snapshot()
      fn()
      h.record(ElementsChange.from(snap, s))
    }
    const a = rect()
    commit(() => s.insert(a))
    commit(() => s.update(mutateElement(a, { x: 10 })))

    expect(h.undo(s)).not.toBeNull()
    expect(s.get(a.id)!.x).toBe(0)
    expect(h.undo(s)).not.toBeNull()
    expect(s.get(a.id)).toBeUndefined()
    expect(h.undo(s)).toBeNull()

    h.redo(s)
    expect(s.get(a.id)!.x).toBe(0)
    h.redo(s)
    expect(s.get(a.id)!.x).toBe(10)
  })
  test("a new edit clears the redo stack", () => {
    const s = new Scene()
    const h = new History()
    const a = rect()
    const snap = s.snapshot()
    s.insert(a)
    h.record(ElementsChange.from(snap, s))
    h.undo(s)
    expect(h.canRedo()).toBe(true)
    const snap2 = s.snapshot()
    s.insert(rect())
    h.record(ElementsChange.from(snap2, s))
    expect(h.canRedo()).toBe(false)
  })
})

describe("groups", () => {
  test("selecting one member selects the whole group", () => {
    const a = rect({ groupIds: ["g1"] })
    const b = rect({ groupIds: ["g1"] })
    const c = rect()
    const out = expandSelectionToGroups([a, b, c], { [a.id]: true }, null)
    expect(Object.keys(out.selectedElementIds).sort()).toEqual([a.id, b.id].sort())
    expect(out.selectedGroupIds).toEqual({ g1: true })
  })
  test("editing a group selects members individually", () => {
    const a = rect({ groupIds: ["g1"] })
    const b = rect({ groupIds: ["g1"] })
    const out = expandSelectionToGroups([a, b], { [a.id]: true }, "g1")
    expect(Object.keys(out.selectedElementIds)).toEqual([a.id])
  })
})

describe("index normalization", () => {
  test("duplicate indices from an imported file are rewritten in array order", () => {
    const a = rect({ index: "a0" })
    const b = rect({ index: "a0" })
    const c = rect({ index: "a0" })
    const s = new Scene([a, b, c])
    const order = s.getElements().map((e) => e.id)
    expect(order).toEqual([a.id, b.id, c.id])
    expect(new Set(s.getElements().map((e) => e.index)).size).toBe(3)
  })
  test("already valid indices are left alone", () => {
    const a = rect({ index: "a0" })
    const b = rect({ index: "a1" })
    const s = new Scene([a, b])
    expect(s.getElements().map((e) => e.index)).toEqual(["a0", "a1"])
  })
})

describe("z-order", () => {
  const build = () => {
    const s = new Scene()
    const els = [0, 1, 2, 3].map(() => {
      const el = rect({ index: s.nextIndex() })
      s.insert(el)
      return el
    })
    return { s, els }
  }
  test("bring to front puts the element last", () => {
    const { s, els } = build()
    const moved = computeMoveIndices(s.getNonDeleted(), new Set([els[0]!.id]), "front")
    s.update(mutateElement(els[0]!, { index: moved.get(els[0]!.id)! }))
    expect(s.getElements()[3]!.id).toBe(els[0]!.id)
  })
  test("send to back puts the element first", () => {
    const { s, els } = build()
    const moved = computeMoveIndices(s.getNonDeleted(), new Set([els[3]!.id]), "back")
    s.update(mutateElement(els[3]!, { index: moved.get(els[3]!.id)! }))
    expect(s.getElements()[0]!.id).toBe(els[3]!.id)
  })
  test("forward swaps with the next neighbour", () => {
    const { s, els } = build()
    const moved = computeMoveIndices(s.getNonDeleted(), new Set([els[1]!.id]), "forward")
    s.update(mutateElement(els[1]!, { index: moved.get(els[1]!.id)! }))
    expect(s.getElements().map((e) => e.id)).toEqual([els[0]!.id, els[2]!.id, els[1]!.id, els[3]!.id])
  })
})

describe("version and index hygiene", () => {
  test("applying a change moves versions forward, never back", () => {
    const a = rect()
    const s = new Scene([a])
    const before = s.snapshot()
    s.update(mutateElement(a, { x: 5 }))
    const edited = s.get(a.id)!
    s.applyChanges(ElementsChange.inverse(ElementsChange.from(before, s)))
    expect(s.get(a.id)!.x).toBe(0)
    expect(s.get(a.id)!.version).toBeGreaterThan(edited.version)
  })

  test("a change that only touches bookkeeping fields is not an edit", () => {
    const a = rect()
    const s = new Scene([a])
    const before = s.snapshot()
    s.update({ ...a, version: a.version + 3, versionNonce: 42, updated: a.updated + 1 })
    expect(ElementsChange.isEmpty(ElementsChange.from(before, s))).toBe(true)
    s.update(mutateElement(s.get(a.id)!, { x: 1 }))
    expect(ElementsChange.isEmpty(ElementsChange.from(before, s))).toBe(false)
  })

  test("malformed keys are rewritten on load, keeping array order", () => {
    const s = new Scene([rect({ id: "one", index: "1" }), rect({ id: "two", index: "a0!" })])
    expect(s.getElements().map((e) => e.id)).toEqual(["one", "two"])
    expect(() => s.nextIndex()).not.toThrow()
  })

  test("z-order moves survive tied keys", () => {
    const els = [rect({ index: "a0" }), rect({ index: "a0" }), rect({ index: "a1" })]
    const moved = computeMoveIndices(els, new Set([els[0]!.id]), "forward")
    const next = els.map((e) => ({ ...e, index: moved.get(e.id) ?? e.index }))
    const keys = next.map((e) => e.index)
    expect(new Set(keys).size).toBe(3)
    const order = [...next].sort((x, y) => (x.index < y.index ? -1 : 1)).map((e) => e.id)
    expect(order).toEqual([els[1]!.id, els[0]!.id, els[2]!.id])
  })

  test("group expansion skips locked members and labels", () => {
    const a = rect({ groupIds: ["g"] })
    const b = rect({ groupIds: ["g"], locked: true })
    const label = newElement("text", { groupIds: ["g"], containerId: a.id })
    const out = expandSelectionToGroups([a, b, label], { [a.id]: true }, null)
    expect(Object.keys(out.selectedElementIds)).toEqual([a.id])
  })
})
