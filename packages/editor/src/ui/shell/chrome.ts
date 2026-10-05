import type { ContextMenuKind } from "../ContextMenu"

export type ChromeMode = "full" | "view" | "zen" | "present"

export interface ChromeInput {
  zenMode: boolean
  viewMode: boolean
  presenting: boolean
}

/** A slide show hides everything; zen hides chrome until an edge is approached; view mode drops the tools. */
export const chromeMode = ({ zenMode, viewMode, presenting }: ChromeInput): ChromeMode =>
  presenting ? "present" : zenMode ? "zen" : viewMode ? "view" : "full"

/** Which chrome regions are mounted in each mode (zen keeps them mounted but faded). */
export const chromeParts = (mode: ChromeMode) => ({
  top: mode !== "present",
  tray: mode === "full" || mode === "zen",
  styleBar: mode === "full" || mode === "zen",
  ledge: mode !== "present",
  corner: mode !== "present",
  stack: mode !== "present",
  presentation: mode === "present",
  /** Library, Search, Stats and the context menu: a slide is fitted to the whole window. */
  panels: mode !== "present",
})

const CONTEXT_MENU_LABELS: Readonly<Record<ContextMenuKind, string>> = {
  element: "Shape actions",
  canvas: "Canvas actions",
  locked: "Locked shape actions",
  view: "View mode actions",
}

/** The context menu's accessible name, distinct from the top-right "Board actions" toolbar. */
export const contextMenuLabel = (kind: ContextMenuKind): string => CONTEXT_MENU_LABELS[kind]

/** Pointer distance from the window's top and bottom edges that brings zen-hidden chrome back. */
export const ZEN_EDGE_TOP = 72
export const ZEN_EDGE_BOTTOM = 136

export type Reveal = "none" | "top" | "bottom"

export const zenReveal = (y: number, height: number): Reveal =>
  y <= ZEN_EDGE_TOP ? "top" : y >= height - ZEN_EDGE_BOTTOM ? "bottom" : "none"
