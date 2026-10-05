import { describe, expect, test } from "vitest"
import {
  NIB_FILE_VERSION,
  type NibMigration,
  migrateNib,
  newerVersionWarning,
  parseNib,
  serializeNib,
} from "../../src/io/nibFile"
import { newElement } from "../../src/model/element"
import { DEFAULT_APP_STATE } from "../../src/model/types"

const box = () => newElement("rectangle", { x: 1, y: 2, width: 3, height: 4, index: "a0" })

describe("file version migrations", () => {
  test("a current file passes through unchanged", () => {
    const parsed = parseNib(serializeNib([box()], DEFAULT_APP_STATE))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.newerVersion).toBeUndefined()
    expect(parsed.warnings).toBeUndefined()
  })

  test("migrations run in order from the file's version up to the current one", () => {
    const calls: number[] = []
    const migrations: Record<number, NibMigration> = {
      1: (doc) => {
        calls.push(1)
        return { ...doc, elements: (doc.elements as unknown[]).map((e) => ({ ...(e as object), width: 30 })) }
      },
      2: (doc) => {
        calls.push(2)
        return {
          ...doc,
          elements: (doc.elements as unknown[]).map((e) => ({ ...(e as object), height: 40 })),
        }
      },
    }
    const v1 = JSON.stringify({ type: "nib", version: 1, elements: [box()], appState: {}, files: {} })
    const parsed = parseNib(v1, { migrations, currentVersion: 3 })
    expect(calls).toEqual([1, 2])
    expect(parsed.ok && [parsed.elements[0]!.width, parsed.elements[0]!.height]).toEqual([30, 40])

    const v2 = JSON.stringify({ type: "nib", version: 2, elements: [box()], appState: {}, files: {} })
    calls.length = 0
    parseNib(v2, { migrations, currentVersion: 3 })
    expect(calls).toEqual([2])
  })

  test("a version without a step, or a file with no version, needs no change", () => {
    expect(migrateNib({ version: 1, elements: [] }, { currentVersion: 2, migrations: {} })).toEqual({
      doc: { version: 2, elements: [] },
      from: 1,
      newer: false,
    })
    expect(migrateNib({ elements: [] }).from).toBe(NIB_FILE_VERSION)
  })

  test("a file from a newer Nib opens, flagged, with a warning that says saving makes a copy", () => {
    const newer = JSON.stringify({
      type: "nib",
      version: NIB_FILE_VERSION + 1,
      elements: [box(), { id: "x", type: "hologram", x: 0, y: 0, width: 1, height: 1 }],
      appState: {},
      files: {},
    })
    const parsed = parseNib(newer)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.elements).toHaveLength(1)
    expect(parsed.newerVersion).toBe(NIB_FILE_VERSION + 1)
    expect(parsed.warnings).toEqual([newerVersionWarning(NIB_FILE_VERSION + 1)])
    expect(parsed.warnings![0]).toContain("newer version of Nib")
    expect(parsed.warnings![0]).toContain("saving makes a copy")
  })

  test("a nonsense version is read as the current one", () => {
    const parsed = parseNib(JSON.stringify({ type: "nib", version: "two", elements: [box()] }))
    expect(parsed.ok && parsed.newerVersion).toBe(undefined)
  })
})
