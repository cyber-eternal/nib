import { EditorCore, type NibElement, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  decideCommit,
  elementTypeLabel,
  fieldValue,
  geometryAvailability,
  geometryPatch,
  parseFieldInput,
} from "../../src/ui/panels/statsModel"

describe("stats field input", () => {
  it("accepts numbers, decimal commas and a typed degree sign", () => {
    expect(parseFieldInput("x", " 12.5 ")).toEqual({ ok: true, value: 12.5 })
    expect(parseFieldInput("y", "-3,25")).toEqual({ ok: true, value: -3.25 })
    expect(parseFieldInput("angle", "90°")).toEqual({ ok: true, value: 90 })
  })

  it("normalises angles into 0-360", () => {
    expect(parseFieldInput("angle", "-90")).toEqual({ ok: true, value: 270 })
    expect(parseFieldInput("angle", "725")).toEqual({ ok: true, value: 5 })
  })

  it("refuses negative and zero sizes with a reason instead of clamping them", () => {
    const r = parseFieldInput("width", "-40")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Width must be at least 1/)
    expect(parseFieldInput("height", "0").ok).toBe(false)
    expect(parseFieldInput("x", "-40").ok).toBe(true)
  })

  it("refuses text and empty input", () => {
    expect(parseFieldInput("x", "abc").ok).toBe(false)
    expect(parseFieldInput("x", "").ok).toBe(false)
  })

  it("commits only a real change", () => {
    expect(decideCommit("x", "10", 10)).toEqual({ kind: "keep" })
    expect(decideCommit("x", "10.001", 10)).toEqual({ kind: "keep" })
    expect(decideCommit("x", "11", 10)).toEqual({ kind: "commit", value: 11 })
    expect(decideCommit("width", "-1", 10).kind).toBe("invalid")
  })

  it("builds the geometry patch, converting degrees", () => {
    expect(geometryPatch("width", 40)).toEqual({ width: 40 })
    expect(geometryPatch("angle", 180).angle).toBeCloseTo(Math.PI)
  })
})

describe("which fields an element accepts", () => {
  it("explains how auto-sized text takes width and height", () => {
    const t = newElement("text", {
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      text: "hi",
      originalText: "hi",
    } as never)
    const a = geometryAvailability(t)
    expect(a.fields.width.disabled).toBe(false)
    expect(a.note).toMatch(/wraps/)
  })

  it("disables a label's fields: it follows its shape", () => {
    const box = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const label = newElement("text", {
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      text: "hi",
      originalText: "hi",
      containerId: box.id,
    } as never)
    const a = geometryAvailability(label)
    expect(Object.values(a.fields).every((f) => f.disabled)).toBe(true)
    expect(elementTypeLabel(label)).toBe("Label")
  })

  it("disables the flat axis of a level line", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
    } as never)
    const a = geometryAvailability(line)
    expect(a.fields.height.disabled).toBe(true)
    expect(a.fields.width.disabled).toBe(false)
  })

  it("disables a frame's angle: frames can't be rotated", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 200, height: 100 })
    const a = geometryAvailability(frame)
    expect(a.fields.angle).toEqual({ disabled: true, reason: "Frames can't be rotated." })
    expect(a.fields.width.disabled).toBe(false)
  })

  it("locks every field of a locked element", () => {
    const r = {
      ...newElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }),
      locked: true,
    } as NibElement
    expect(geometryAvailability(r).fields.x.disabled).toBe(true)
  })

  it("shows angles in degrees", () => {
    const r = { ...newElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }), angle: Math.PI / 2 }
    expect(fieldValue(r as NibElement, "angle")).toBe(90)
  })
})

describe("a committed field is one undo step on the element", () => {
  it("moves the element and undoes in one step", () => {
    const core = new EditorCore()
    const r = newElement("rectangle", { x: 0, y: 0, width: 10, height: 10 })
    core.scene.insert({ ...r, index: core.scene.nextIndex() })
    const d = decideCommit("x", "50", 0)
    if (d.kind !== "commit") throw new Error("expected a commit")
    core.setElementGeometry(r.id, geometryPatch("x", d.value))
    expect(core.scene.get(r.id)?.x).toBe(50)
    core.undo()
    expect(core.scene.get(r.id)?.x).toBe(0)
  })
})
