export interface Choice {
  id: string
  label: string
  variant?: "primary" | "quiet" | "danger"
}

export interface ChoiceRequest {
  kind: "choice"
  title: string
  message?: string
  /** In reading order; the footer shows them as given, so put the default last. */
  choices: readonly Choice[]
  /** Focused when the dialog opens. */
  defaultId?: string
  /** What Escape, the backdrop and the close button answer; null when absent. */
  cancelId?: string
  destructive?: boolean
}

export interface PromptRequest {
  kind: "prompt"
  title: string
  label: string
  initial?: string
  placeholder?: string
  okLabel?: string
  /** An error to show under the field, or null when the value is acceptable. */
  validate?: (value: string) => string | null
}

export type ShellRequest = ChoiceRequest | PromptRequest

export interface Pending<R extends ShellRequest = ShellRequest> {
  id: number
  request: R
  resolve: (answer: string | null) => void
}

/** One dialog at a time: later questions wait their turn instead of stacking modals. */
export class RequestQueue {
  private items: Pending[] = []
  private listeners = new Set<() => void>()
  private seq = 0

  get current(): Pending | null {
    return this.items[0] ?? null
  }

  get size(): number {
    return this.items.length
  }

  ask(request: ShellRequest): Promise<string | null> {
    return new Promise((resolve) => {
      this.items = [...this.items, { id: ++this.seq, request, resolve }]
      this.emit()
    })
  }

  answer(id: number, value: string | null): void {
    const item = this.items.find((p) => p.id === id)
    if (!item) return
    this.items = this.items.filter((p) => p.id !== id)
    item.resolve(value)
    this.emit()
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const l of [...this.listeners]) l()
  }
}

/** The cancel answer for a request: the choice marked cancelId, else null. */
export const cancelAnswer = (request: ShellRequest): string | null =>
  request.kind === "choice" ? (request.cancelId ?? null) : null

export interface DropChoiceInput {
  name: string
  canvasEmpty: boolean
}

/** Insert / Open / Cancel for a dropped or pasted drawing; Insert is the default on a non-empty board. */
export const dropChoiceRequest = ({ name, canvasEmpty }: DropChoiceInput): ChoiceRequest => {
  const insert: Choice = { id: "insert", label: "Insert here", variant: canvasEmpty ? "quiet" : "primary" }
  const open: Choice = { id: "open", label: "Open", variant: canvasEmpty ? "primary" : "quiet" }
  return {
    kind: "choice",
    title: `Add “${name}”`,
    message: canvasEmpty
      ? "Open it as the document, or insert its shapes into this board."
      : "Insert its shapes into this board, or open it in a tab of its own.",
    choices: [{ id: "cancel", label: "Cancel" }, ...(canvasEmpty ? [insert, open] : [open, insert])],
    defaultId: canvasEmpty ? "open" : "insert",
    cancelId: "cancel",
  }
}

export interface ConfirmOptions {
  title?: string
  okLabel?: string
  /** The answer that leaves things as they are, such as "Keep Mine" for a file changed on disk. */
  cancelLabel?: string
  destructive?: boolean
}

/** A yes/no question; a destructive one defaults to the safe answer. */
export const confirmRequest = (message: string, opts: ConfirmOptions = {}): ChoiceRequest => ({
  kind: "choice",
  title: opts.title ?? "Are you sure?",
  message,
  choices: [
    { id: "cancel", label: opts.cancelLabel ?? "Cancel" },
    { id: "ok", label: opts.okLabel ?? "OK", variant: opts.destructive ? "danger" : "primary" },
  ],
  defaultId: opts.destructive ? "cancel" : "ok",
  cancelId: "cancel",
  destructive: opts.destructive,
})
