import type { EditorCore } from "@nib/core"
import { useEffect, useState } from "react"
import { useCoreSelector } from "../../hooks/useEditor"
import { selectionAnnouncement } from "./announce"

// a marquee changes the selection every frame; only the settled selection is worth saying
const SETTLE_MS = 400

/** A polite live region that names the selection once it settles. */
export function SelectionAnnouncer({ core }: { core: EditorCore }) {
  const key = useCoreSelector(core, (c) => Object.keys(c.appState.selectedElementIds).join(","))
  const [message, setMessage] = useState("")

  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection key is what changes
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMessage(selectionAnnouncement(core.selectedElements(), (id) => core.scene.get(id)))
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [core, key])

  return (
    <p className="sc-visually-hidden" role="status" aria-live="polite">
      {message}
    </p>
  )
}
