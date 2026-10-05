import type { Point } from "./vector"

/** [minX, minY, maxX, maxY] */
export type Bounds = readonly [number, number, number, number]

export const EMPTY_BOUNDS: Bounds = [
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
]

export const boundsWidth = (b: Bounds): number => b[2] - b[0]
export const boundsHeight = (b: Bounds): number => b[3] - b[1]
export const boundsCenter = (b: Bounds): Point => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

export const unionBounds = (a: Bounds, b: Bounds): Bounds => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
]

export const boundsContainPoint = (b: Bounds, p: Point): boolean =>
  p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]

export const boundsContainBounds = (outer: Bounds, inner: Bounds): boolean =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]

export const boundsIntersect = (a: Bounds, b: Bounds): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

export const boundsFromPoints = (pts: readonly Point[]): Bounds => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    if (p[0] < minX) minX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] > maxY) maxY = p[1]
  }
  return [minX, minY, maxX, maxY]
}

export const expandBounds = (b: Bounds, by: number): Bounds => [b[0] - by, b[1] - by, b[2] + by, b[3] + by]

export const normalizeRect = (a: Point, b: Point): Bounds => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
]
