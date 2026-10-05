import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { newElement } from "../../src/model/element"
import type { NibElement } from "../../src/model/types"
import { indicesBetween } from "../../src/model/zindex"
import { click, drag, drawShape, key, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

const grid = (n: number): NibElement[] =>
  indicesBetween(null, null, n).map((index, i) =>
    newElement("rectangle", {
      x: (i % 50) * 30,
      y: Math.floor(i / 50) * 30,
      width: 20,
      height: 20,
      index,
    }),
  )

const counter = (ed: EditorCore) => {
  const c = { emits: 0 }
  ed.subscribe(() => c.emits++)
  return c
}

describe("scene changes notify once per gesture step", () => {
  test("a select-all drag emits once per pointer move", () => {
    const ed = new EditorCore()
    ed.loadScene(grid(400))
    ed.selectAll()
    const c = counter(ed)
    ed.pointerDown(ptr(10, 10))
    expect(c.emits).toBeLessThanOrEqual(1)
    for (const [x, y] of [
      [40, 40],
      [60, 70],
      [90, 90],
    ] as const) {
      c.emits = 0
      ed.pointerMove(ptr(x, y))
      expect(c.emits).toBe(1)
    }
    c.emits = 0
    ed.pointerUp(ptr(90, 90))
    expect(c.emits).toBeLessThanOrEqual(1)
    expect(ed.scene.get(ed.scene.getNonDeleted()[0]!.id)!.x).toBe(80)
  })

  test("nudge, z-order and delete from the keyboard emit once each", () => {
    const ed = new EditorCore()
    ed.loadScene(grid(400))
    ed.selectElements(
      ed.scene
        .getNonDeleted()
        .slice(200)
        .map((el) => el.id),
    )
    const c = counter(ed)
    ed.keyDown(key("ArrowRight"))
    expect(c.emits).toBe(1)
    c.emits = 0
    ed.keyDown({ ...key("[", { metaKey: true }), code: "BracketLeft" })
    expect(c.emits).toBe(1)
    c.emits = 0
    ed.keyDown(key("Delete"))
    expect(c.emits).toBe(1)
    expect(ed.scene.getNonDeleted()).toHaveLength(200)
  })

  test("a transaction with many updates emits once", () => {
    const ed = new EditorCore()
    ed.loadScene(grid(100))
    const c = counter(ed)
    ed.transact(() => {
      for (const el of ed.scene.getNonDeleted()) ed.scene.update({ ...el, x: el.x + 1 })
    })
    expect(c.emits).toBe(1)
    expect(ed.history.canUndo()).toBe(true)
  })
})

describe("an exception inside a gesture cannot leave its transaction open", () => {
  test("a throw during a drag's release rolls the drag back and history keeps recording", () => {
    const ed = new EditorCore()
    const errors: unknown[] = []
    ed.host = { onError: (e) => errors.push(e) }
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const sync = ed.syncLabelFrames.bind(ed)
    let armed = true
    ed.syncLabelFrames = (ids) => {
      if (armed) {
        armed = false
        throw new Error("boom")
      }
      sync(ids)
    }
    drag(ed, [50, 50], [250, 250])
    expect(errors).toHaveLength(1)
    expect(ed.inTransaction).toBe(false)
    expect(ed.scene.get(rect.id)!.x).toBe(0)

    const depth = undoDepth(ed)
    drawShape(ed, "rectangle", [300, 300], [400, 400])
    drawShape(ed, "ellipse", [500, 300], [600, 400])
    expect(undoDepth(ed)).toBe(depth + 2)
    expect(ed.history.canUndo()).toBe(true)
  })

  test("a throw mid-move leaves no transaction open and the next gesture works", () => {
    const ed = new EditorCore()
    ed.host = { onError: () => {} }
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const refresh = ed.refreshBoundArrows.bind(ed)
    ed.refreshBoundArrows = () => {
      throw new Error("mid-move")
    }
    ed.pointerDown(ptr(50, 50))
    ed.pointerMove(ptr(80, 80))
    ed.pointerMove(ptr(120, 120))
    ed.pointerUp(ptr(120, 120))
    expect(ed.inTransaction).toBe(false)
    expect(ed.scene.get(rect.id)!.x).toBe(0)
    ed.refreshBoundArrows = refresh
    drag(ed, [50, 50], [70, 50])
    expect(ed.scene.get(rect.id)!.x).toBe(20)
    expect(ed.inTransaction).toBe(false)
  })

  test("without a host handler the error is still contained", () => {
    const ed = new EditorCore()
    const original = console.error
    const logged: unknown[] = []
    console.error = (e: unknown) => logged.push(e)
    try {
      drawShape(ed, "rectangle", [0, 0], [100, 100])
      ed.syncLabelFrames = () => {
        throw new Error("boom")
      }
      expect(() => drag(ed, [50, 50], [150, 150])).not.toThrow()
    } finally {
      console.error = original
    }
    expect(logged).toHaveLength(1)
    expect(ed.inTransaction).toBe(false)
  })

  test("a level left dangling is committed by the next press", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    // what a failed tool left behind before this guard existed: an open level nobody owns
    ;(ed as unknown as { txDepth: number }).txDepth = 1
    ;(ed as unknown as { txSnapshot: unknown }).txSnapshot = ed.scene.snapshot()
    ed.setTool("ellipse")
    expect(ed.inTransaction).toBe(false)
    drawShape(ed, "ellipse", [200, 0], [300, 100])
    expect(ed.inTransaction).toBe(false)
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
  })
})

describe("a tool key mid-gesture does not throw the gesture away", () => {
  test("pen stroke with R pressed before release", () => {
    const ed = new EditorCore()
    ed.setTool("freedraw")
    ed.pointerDown(ptr(0, 0))
    for (let i = 1; i <= 30; i++) ed.pointerMove(ptr(i * 3, i * 2))
    expect(ed.keyDown({ ...key("r"), code: "KeyR" })).toBe(true)
    ed.pointerUp(ptr(90, 60))
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(ed.scene.getNonDeleted()[0]!.type).toBe("freedraw")
    expect(ed.appState.activeTool).toBe("freedraw")
  })

  test("a shape being dragged out and a selection move survive tool keys", () => {
    const ed = new EditorCore()
    ed.setTool("rectangle")
    ed.pointerDown(ptr(0, 0))
    ed.pointerMove(ptr(60, 60))
    ed.keyDown({ ...key("o"), code: "KeyO" })
    ed.pointerMove(ptr(100, 100))
    ed.pointerUp(ptr(100, 100))
    const rect = ed.scene.getNonDeleted()[0]!
    expect(rect.type).toBe("rectangle")
    expect(rect.width).toBe(100)

    ed.pointerDown(ptr(50, 50))
    ed.pointerMove(ptr(80, 50))
    ed.keyDown({ ...key("a"), code: "KeyA" })
    ed.pointerMove(ptr(100, 50))
    ed.pointerUp(ptr(100, 50))
    expect(ed.scene.get(rect.id)!.x).toBe(50)
    expect(ed.appState.activeTool).toBe("selection")
    // once the pointer is up the key works again
    ed.keyDown({ ...key("a"), code: "KeyA" })
    expect(ed.appState.activeTool).toBe("arrow")
  })
})

describe("history never nests inside a transaction the host left open", () => {
  const filledRect = (ed: EditorCore) => {
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.selectElements([rect.id])
    ed.updateSelectedStyle({ backgroundColor: "#ff0000" })
    return rect
  }

  test("undo while a slider drag is open takes the drag back as its own step", () => {
    const ed = new EditorCore()
    const rect = filledRect(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 50 })
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
    expect(ed.scene.get(rect.id)!.backgroundColor).toBe("#ff0000")
    expect(ed.history.canRedo()).toBe(true)
    ed.updateSelectedStyle({ opacity: 40 })
    // the slider's late commit closes the step the rest of the drag made
    ed.commitTransaction()
    expect(ed.inTransaction).toBe(false)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
    expect(ed.scene.get(rect.id)!.backgroundColor).toBe("#ff0000")
    ed.undo()
    expect(ed.scene.get(rect.id)!.backgroundColor).toBe("transparent")
  })

  test("a pencil stroke and its correction stay two steps while a host transaction is open", () => {
    const ed = new EditorCore()
    filledRect(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 60 })
    const depth = undoDepth(ed)
    ed.setTool("pencil")
    ed.pointerDown(ptr(300, 300))
    for (let i = 0; i <= 40; i++) ed.pointerMove(ptr(300 + i * 5, 300))
    ed.pointerUp(ptr(500, 300))
    ed.commitTransaction()
    expect(ed.inTransaction).toBe(false)
    // the slider step, the raw stroke and its correction
    expect(undoDepth(ed)).toBe(depth + 3)
    const line = ed.scene.getNonDeleted().find((e) => e.type === "line" || e.type === "arrow")
    expect(line).toBeTruthy()
    ed.undo()
    expect(ed.scene.getNonDeleted().some((e) => e.type === "freedraw")).toBe(true)
  })

  test("a keyboard edit during an open host transaction is recorded", () => {
    const ed = new EditorCore()
    const rect = filledRect(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 70 })
    const depth = undoDepth(ed)
    ed.keyDown(key("ArrowRight"))
    expect(undoDepth(ed)).toBe(depth + 2)
    expect(ed.scene.get(rect.id)!.x).toBe(1)
    ed.commitTransaction()
    expect(undoDepth(ed)).toBe(depth + 2)
  })

  test("a late host commit does not close a gesture's transaction", () => {
    const ed = new EditorCore()
    const rect = filledRect(ed)
    ed.beginTransaction()
    ed.pointerDown(ptr(50, 50))
    ed.pointerMove(ptr(80, 50))
    ed.commitTransaction()
    expect(ed.inTransaction).toBe(true)
    ed.pointerMove(ptr(100, 50))
    ed.pointerUp(ptr(100, 50))
    expect(ed.inTransaction).toBe(false)
    expect(ed.scene.get(rect.id)!.x).toBe(50)
    ed.undo()
    expect(ed.scene.get(rect.id)!.x).toBe(0)
  })

  test("after an undo mid-drag, the rest of the drag is one more step", () => {
    const ed = new EditorCore()
    const rect = filledRect(ed)
    const depth = undoDepth(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 90 })
    ed.undo()
    expect(undoDepth(ed)).toBe(depth)
    for (const opacity of [80, 70, 60, 50, 40]) ed.updateSelectedStyle({ opacity })
    expect(ed.scene.get(rect.id)!.opacity).toBe(40)
    ed.commitTransaction()
    expect(ed.inTransaction).toBe(false)
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
    expect(ed.scene.get(rect.id)!.backgroundColor).toBe("#ff0000")
  })

  test("a keyboard edit after an undo mid-drag stays its own step", () => {
    const ed = new EditorCore()
    const rect = filledRect(ed)
    const depth = undoDepth(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 90 })
    ed.keyDown(key("z", { metaKey: true, code: "KeyZ" }))
    ed.keyDown(key("ArrowRight"))
    expect(undoDepth(ed)).toBe(depth + 1)
    for (const opacity of [80, 70]) ed.updateSelectedStyle({ opacity })
    ed.commitTransaction()
    expect(undoDepth(ed)).toBe(depth + 2)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
    expect(ed.scene.get(rect.id)!.x).toBe(1)
    // a commit with nothing left open changes nothing
    ed.commitTransaction()
    ed.updateSelectedStyle({ opacity: 30 })
    expect(undoDepth(ed)).toBe(depth + 2)
  })

  // a flip of one plain rectangle changes nothing, so the pair gives the flip something to record
  const flippablePair = (ed: EditorCore) => {
    const rect = filledRect(ed)
    const other = drawShape(ed, "rectangle", [200, 0], [260, 60])
    ed.selectElements([rect.id, other.id])
    return rect
  }

  test("a keyboard edit the host runs after an undo mid-drag stays its own step", () => {
    const ed = new EditorCore()
    const rect = flippablePair(ed)
    const depth = undoDepth(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 90 })
    ed.keyDown(key("z", { metaKey: true, code: "KeyZ" }))
    ed.runKeyCommand(() => ed.flip("horizontal"))
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.updateSelectedStyle({ opacity: 80 })
    ed.commitTransaction()
    expect(undoDepth(ed)).toBe(depth + 2)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(undoDepth(ed)).toBe(depth)
    expect(ed.inTransaction).toBe(false)
  })

  test("a keyboard edit the host runs mid-drag splits the drag around it", () => {
    const ed = new EditorCore()
    const rect = flippablePair(ed)
    const depth = undoDepth(ed)
    ed.beginTransaction()
    ed.updateSelectedStyle({ opacity: 90 })
    ed.runKeyCommand(() => ed.flip("horizontal"))
    expect(undoDepth(ed)).toBe(depth + 2)
    ed.updateSelectedStyle({ opacity: 80 })
    ed.commitTransaction()
    expect(undoDepth(ed)).toBe(depth + 3)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(90)
    expect(ed.inTransaction).toBe(false)
  })

  test("balanced host transactions still fold into one step", () => {
    const ed = new EditorCore()
    const rect = filledRect(ed)
    const depth = undoDepth(ed)
    ed.beginTransaction()
    for (const opacity of [90, 80, 70]) ed.updateSelectedStyle({ opacity })
    ed.commitTransaction()
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
  })
})

describe("Escape with the laser in a slide show", () => {
  const show = () => {
    const ed = new EditorCore()
    drawShape(ed, "frame", [0, 0], [400, 300])
    drawShape(ed, "frame", [500, 0], [900, 300])
    expect(ed.startPresentation()).toBe(true)
    return ed
  }

  test("the first Escape puts the laser down, the second ends the show", () => {
    const ed = show()
    ed.keyDown({ ...key("k"), code: "KeyK" })
    expect(ed.appState.activeTool).toBe("laser")
    ed.keyDown(key("Escape"))
    expect(ed.presentation).not.toBeNull()
    expect(ed.appState.activeTool).toBe("selection")
    ed.keyDown(key("Escape"))
    expect(ed.presentation).toBeNull()
  })

  test("ending a show with the laser in hand leaves the selection tool", () => {
    const ed = show()
    ed.keyDown({ ...key("k"), code: "KeyK" })
    ed.stopPresentation()
    expect(ed.presentation).toBeNull()
    expect(ed.appState.activeTool).toBe("selection")
    expect(ed.appState.viewMode).toBe(false)
  })

  test("a laser armed before the show is still armed after it", () => {
    const ed = new EditorCore()
    drawShape(ed, "frame", [0, 0], [400, 300])
    ed.setTool("laser")
    ed.startPresentation()
    ed.stopPresentation()
    expect(ed.appState.activeTool).toBe("laser")
  })
})

describe("the lasso can add to the selection", () => {
  test("arming the lasso keeps the selection, and Shift+lasso adds to it", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id])
    ed.keyDown({ ...key("q"), code: "KeyQ" })
    expect(ed.appState.selectedElementIds[a.id]).toBe(true)
    const loop: [number, number][] = [
      [280, -20],
      [420, -20],
      [420, 120],
      [280, 120],
      [280, -20],
    ]
    ed.pointerDown(ptr(loop[0]![0], loop[0]![1], { shiftKey: true }))
    for (const [x, y] of loop.slice(1)) ed.pointerMove(ptr(x, y, { shiftKey: true }))
    ed.pointerUp(ptr(280, -20, { shiftKey: true }))
    expect(Object.keys(ed.appState.selectedElementIds).sort()).toEqual([a.id, b.id].sort())
  })

  test("a plain lasso still replaces the selection", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id])
    ed.setTool("lasso")
    ed.pointerDown(ptr(280, -20))
    for (const [x, y] of [
      [420, -20],
      [420, 120],
      [280, 120],
      [280, -20],
    ] as const)
      ed.pointerMove(ptr(x, y))
    ed.pointerUp(ptr(280, -20))
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([b.id])
    click(ed, 1000, 1000)
  })
})
