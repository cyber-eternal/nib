import { generateKeyBetween } from "fractional-indexing"
import { randomId, randomInteger } from "../math/random"
import { DEFAULT_LINE_HEIGHT, type ElementBase, type ElementType, type NibElement } from "./types"

type Init = Partial<ElementBase> & Record<string, unknown>

const baseDefaults = (init: Init): ElementBase => ({
  id: (init.id as string) ?? randomId(),
  x: init.x ?? 0,
  y: init.y ?? 0,
  width: init.width ?? 0,
  height: init.height ?? 0,
  angle: init.angle ?? 0,
  strokeColor: init.strokeColor ?? "#1e1e1e",
  backgroundColor: init.backgroundColor ?? "transparent",
  fillStyle: init.fillStyle ?? "solid",
  strokeWidth: init.strokeWidth ?? 2,
  strokeStyle: init.strokeStyle ?? "solid",
  roughness: init.roughness ?? 1,
  opacity: init.opacity ?? 100,
  roundness: init.roundness ?? null,
  seed: init.seed ?? randomInteger(),
  version: init.version ?? 1,
  versionNonce: init.versionNonce ?? randomInteger(),
  isDeleted: init.isDeleted ?? false,
  groupIds: init.groupIds ?? [],
  frameId: init.frameId ?? null,
  boundElements: init.boundElements ?? null,
  link: init.link ?? null,
  locked: init.locked ?? false,
  index: init.index ?? generateKeyBetween(null, null),
  updated: init.updated ?? Date.now(),
})

const typeDefaults: Record<ElementType, (init: Init) => Record<string, unknown>> = {
  rectangle: () => ({}),
  diamond: () => ({}),
  ellipse: () => ({}),
  embeddable: () => ({}),
  frame: (i) => ({ name: (i.name as string) ?? null }),
  text: (i) => ({
    text: (i.text as string) ?? "",
    originalText: (i.originalText as string) ?? (i.text as string) ?? "",
    fontSize: (i.fontSize as number) ?? 20,
    fontFamily: (i.fontFamily as string) ?? "hand",
    textAlign: (i.textAlign as string) ?? "left",
    verticalAlign: (i.verticalAlign as string) ?? "top",
    containerId: (i.containerId as string) ?? null,
    lineHeight: (i.lineHeight as number) ?? DEFAULT_LINE_HEIGHT,
    autoResize: (i.autoResize as boolean) ?? true,
  }),
  line: (i) => ({
    points: (i.points as unknown[]) ?? [
      [0, 0],
      [0, 0],
    ],
    lastCommittedPoint: (i.lastCommittedPoint as unknown) ?? null,
    polygon: (i.polygon as boolean) ?? false,
  }),
  arrow: (i) => ({
    points: (i.points as unknown[]) ?? [
      [0, 0],
      [0, 0],
    ],
    lastCommittedPoint: (i.lastCommittedPoint as unknown) ?? null,
    startBinding: (i.startBinding as unknown) ?? null,
    endBinding: (i.endBinding as unknown) ?? null,
    startArrowhead: (i.startArrowhead as unknown) ?? null,
    endArrowhead: i.endArrowhead === undefined ? "arrow" : i.endArrowhead,
    elbowed: (i.elbowed as boolean) ?? false,
  }),
  freedraw: (i) => ({
    points: (i.points as unknown[]) ?? [],
    pressures: (i.pressures as unknown[]) ?? [],
    simulatePressure: (i.simulatePressure as boolean) ?? true,
    lastCommittedPoint: (i.lastCommittedPoint as unknown) ?? null,
  }),
  image: (i) => ({
    fileId: (i.fileId as string) ?? null,
    status: (i.status as string) ?? "pending",
    scale: (i.scale as unknown) ?? [1, 1],
    crop: (i.crop as unknown) ?? null,
  }),
}

export const newElement = <T extends ElementType>(
  type: T,
  init: Init = {},
): Extract<NibElement, { type: T }> =>
  ({
    ...baseDefaults(init),
    ...typeDefaults[type](init),
    type,
  }) as Extract<NibElement, { type: T }>

/**
 * The only sanctioned way to change an element. Returns a new object with a
 * bumped version so renderers, history and reconciliation can all diff cheaply.
 */
export const mutateElement = <T extends NibElement>(el: T, patch: Partial<Omit<T, "id" | "type">>): T => {
  let changed = false
  for (const key in patch) {
    if ((patch as Record<string, unknown>)[key] !== (el as unknown as Record<string, unknown>)[key]) {
      changed = true
      break
    }
  }
  if (!changed) return el
  return {
    ...el,
    ...patch,
    version: el.version + 1,
    versionNonce: randomInteger(),
    updated: Date.now(),
  }
}

/** Copy of `el` with a fresh identity, for duplicate and paste. */
export const duplicateElement = <T extends NibElement>(
  el: T,
  overrides: Partial<Omit<T, "type">> = {},
): T => ({
  ...el,
  ...overrides,
  id: (overrides as { id?: string }).id ?? randomId(),
  seed: randomInteger(),
  version: 1,
  versionNonce: randomInteger(),
  updated: Date.now(),
})
