import type { RestoredSession, RestoredTab, SessionViewport } from "./index"

export const DEFAULT_RECOVERY_SLOT = "current"

const MIN_ZOOM = 0.1
const MAX_ZOOM = 30
const MAX_TABS = 256

/** Slots name files in the recovery folder, so they are plain names and nothing else (session.rs agrees). */
export const isRecoverySlot = (slot: unknown): slot is string =>
  typeof slot === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(slot)

let slotSeq = 0

/** A recovery slot no other tab, in this session or an earlier one, has used. */
export const newRecoverySlot = (now: number = Date.now()): string =>
  `t${now.toString(36)}${(slotSeq++).toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`

/** A document's recovery copy and its metadata, relative to the app data folder. */
export const recoveryFiles = (slot?: string): { file: string; meta: string } => {
  const name = isRecoverySlot(slot) ? slot : DEFAULT_RECOVERY_SLOT
  return { file: `recovery/${name}.nibd`, meta: `recovery/${name}.meta.json` }
}

const finite = (n: unknown, limit: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) < limit

export const sanitizeViewport = (v: unknown): SessionViewport | null => {
  if (!v || typeof v !== "object") return null
  const { scrollX, scrollY, zoom } = v as Record<string, unknown>
  if (!finite(scrollX, 1e9) || !finite(scrollY, 1e9) || !finite(zoom, 1e9)) return null
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null
  return { scrollX, scrollY, zoom }
}

/**
 * Reads a session handed over by the desktop shell or stored by the browser, keeping only well-formed tabs.
 * Null when there is nothing to restore.
 */
export const readRestoredSession = (raw: unknown): RestoredSession | null => {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const seen = new Set<string>()
  const tabs: RestoredTab[] = []
  for (const t of Array.isArray(r.tabs) ? r.tabs : []) {
    if (!t || typeof t !== "object") continue
    const { slot, open, viewport } = t as Record<string, unknown>
    if (!isRecoverySlot(slot) || seen.has(slot)) continue
    seen.add(slot)
    tabs.push({ slot, open: typeof open === "string" ? open : null, viewport: sanitizeViewport(viewport) })
    if (tabs.length >= MAX_TABS) break
  }
  const notices = Array.isArray(r.notices)
    ? r.notices.filter((n): n is string => typeof n === "string" && n.length > 0)
    : []
  if (tabs.length === 0 && notices.length === 0) return null
  const active =
    typeof r.active === "number" && Number.isInteger(r.active)
      ? Math.max(0, Math.min(r.active, tabs.length - 1))
      : 0
  return { tabs, active, notices }
}
