import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Button, Dialog } from "../primitives"
import {
  type ChoiceRequest,
  type ConfirmOptions,
  type Pending,
  type PromptRequest,
  RequestQueue,
  type ShellRequest,
  cancelAnswer,
  confirmRequest,
} from "./choiceQueue"
import "./shell.css"

export interface ShellDialogsApi {
  /** Resolves the chosen id, or the cancel answer. */
  choose(request: Omit<ChoiceRequest, "kind">): Promise<string | null>
  /** Resolves the entered text, or null when cancelled. */
  prompt(request: Omit<PromptRequest, "kind">): Promise<string | null>
  confirm(message: string, opts?: ConfirmOptions): Promise<boolean>
}

const Ctx = createContext<ShellDialogsApi | null>(null)

/** In-app, themed replacements for window.confirm and window.prompt; one question at a time. */
export const ShellDialogsProvider = ({ children }: { children?: ReactNode }) => {
  const queue = useMemo(() => new RequestQueue(), [])
  const current = useSyncExternalStore(
    (cb) => queue.subscribe(cb),
    () => queue.current,
    () => null,
  )
  const api = useMemo<ShellDialogsApi>(
    () => ({
      choose: (r) => queue.ask({ ...r, kind: "choice" }),
      prompt: (r) => queue.ask({ ...r, kind: "prompt" }),
      confirm: async (message, opts) => (await queue.ask(confirmRequest(message, opts))) === "ok",
    }),
    [queue],
  )
  return (
    <Ctx.Provider value={api}>
      {children}
      {current ? <RequestView key={current.id} pending={current} queue={queue} /> : null}
    </Ctx.Provider>
  )
}

export const useShellDialogs = (): ShellDialogsApi => {
  const api = useContext(Ctx)
  if (!api) throw new Error("useShellDialogs needs a <ShellDialogsProvider> above it")
  return api
}

const RequestView = ({ pending, queue }: { pending: Pending<ShellRequest>; queue: RequestQueue }) => {
  const answer = (value: string | null) => queue.answer(pending.id, value)
  const r = pending.request
  return r.kind === "choice" ? (
    <ChoiceView request={r} onAnswer={answer} />
  ) : (
    <PromptView request={r} onAnswer={answer} />
  )
}

const ChoiceView = ({
  request,
  onAnswer,
}: { request: ChoiceRequest; onAnswer: (value: string | null) => void }) => {
  const defaultRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open
      size="s"
      role={request.destructive ? "alertdialog" : "dialog"}
      title={request.title}
      description={request.message}
      onClose={() => onAnswer(cancelAnswer(request))}
      initialFocus={defaultRef}
      closeLabel={
        request.cancelId ? (request.choices.find((c) => c.id === request.cancelId)?.label ?? "Cancel") : null
      }
      footer={request.choices.map((c) => (
        <Button
          key={c.id}
          ref={c.id === request.defaultId ? defaultRef : undefined}
          variant={c.variant ?? "quiet"}
          onClick={() => onAnswer(c.id)}
        >
          {c.label}
        </Button>
      ))}
    />
  )
}

const PromptView = ({
  request,
  onAnswer,
}: { request: PromptRequest; onAnswer: (value: string | null) => void }) => {
  const [value, setValue] = useState(request.initial ?? "")
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  const errorId = useId()

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const problem = request.validate?.(value) ?? null
    setError(problem)
    if (!problem) onAnswer(value)
  }

  return (
    <Dialog
      open
      size="s"
      title={request.title}
      onClose={() => onAnswer(null)}
      initialFocus={inputRef}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button onClick={() => onAnswer(null)}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {request.okLabel ?? "OK"}
          </Button>
        </>
      }
    >
      <form
        className="shell-prompt"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="shell-prompt-label" htmlFor={fieldId}>
          {request.label}
        </label>
        <input
          ref={inputRef}
          id={fieldId}
          className="shell-field"
          type="text"
          value={value}
          placeholder={request.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
        />
        {error ? (
          <p id={errorId} className="shell-prompt-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
