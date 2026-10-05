import { describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { normalizeElements } from "../../src/io/nibFile"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { DEFAULT_APP_STATE } from "../../src/model/types"
import { ShapeCache } from "../../src/render/shapes"
import { renderStaticScene } from "../../src/render/staticScene"
import { recordingCanvas } from "./mockCanvas"

// Spec §6: "Render errors per element are caught; element drawn as red dashed bbox; never blank canvas."
describe("render errors are isolated per element", () => {
  const sceneWithUnknownType = () =>
    new Scene(
      normalizeElements([
        { id: "a", type: "rectangle", x: 0, y: 0, width: 50, height: 50, index: "a0" },
        // Excalidraw files can carry iframe/magicframe elements; the loader keeps them
        { id: "b", type: "iframe", x: 100, y: 0, width: 50, height: 50, index: "a1" },
        { id: "c", type: "ellipse", x: 200, y: 0, width: 50, height: 50, index: "a2" },
      ]),
    )

  test("an unknown element type does not abort the frame", () => {
    const r = recordingCanvas()
    expect(() =>
      renderStaticScene(r.ctx, {
        scene: sceneWithUnknownType(),
        appState: DEFAULT_APP_STATE,
        width: 800,
        height: 600,
        dpr: 1,
        theme: "light",
        cache: new ShapeCache(),
      }),
    ).not.toThrow()
    // the ellipse after the bad element must still be painted
    const strokes = r.calls.filter((c) => c.op === "stroke")
    expect(strokes.length).toBeGreaterThanOrEqual(2)
  })

  test("save/restore stays balanced across frames even when an element fails", () => {
    const r = recordingCanvas({ throwOn: "drawImage" })
    const img = newElement("image", { x: 0, y: 0, width: 40, height: 40, fileId: "f", index: "a0" })
    const rect = newElement("rectangle", { x: 60, y: 0, width: 40, height: 40, index: "a1" })
    const scene = new Scene([img, rect])
    for (let i = 0; i < 3; i++) {
      try {
        renderStaticScene(r.ctx, {
          scene,
          appState: DEFAULT_APP_STATE,
          width: 800,
          height: 600,
          dpr: 2,
          theme: "light",
          cache: new ShapeCache(),
          resolveImage: () => ({ image: {}, width: 40, height: 40 }),
        })
      } catch {
        // asserted below
      }
    }
    // leaking save() compounds scale(dpr) every frame
    expect(r.depth()).toBe(0)
  })

  test("SVG export skips (or placeholders) an unknown element instead of throwing", () => {
    const els = normalizeElements([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 50, height: 50, index: "a0" },
      { id: "b", type: "magicframe", x: 100, y: 0, width: 50, height: 50, index: "a1" },
    ])
    expect(() =>
      exportToSvg({
        elements: els,
        appState: DEFAULT_APP_STATE,
        exportBackground: true,
        exportPadding: 10,
        scale: 1,
        theme: "light",
      }),
    ).not.toThrow()
  })
})
