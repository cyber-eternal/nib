import { type Unsubscribe, once } from "@nib/platform"

export interface CloseGuard {
  add(handler: () => Promise<boolean>): Unsubscribe
  /** Resolves true when every handler allows closing. Overlapping requests share one run. */
  run(): Promise<boolean>
}

export const createCloseGuard = (log: (error: unknown) => void = console.error): CloseGuard => {
  const handlers = new Set<() => Promise<boolean>>()
  let inFlight: Promise<boolean> | null = null
  let failedLastTime = false

  const evaluate = async (): Promise<boolean> => {
    try {
      for (const handler of [...handlers]) {
        if (!(await handler())) {
          failedLastTime = false
          return false
        }
      }
      failedLastTime = false
      return true
    } catch (error) {
      log(error)
      // a failing prompt keeps the window open once, but must not trap it on every later attempt
      const allow = failedLastTime
      failedLastTime = true
      return allow
    }
  }

  return {
    add(handler) {
      handlers.add(handler)
      return once(() => handlers.delete(handler))
    },
    run() {
      inFlight ??= evaluate().finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}

const memo = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
  let value: Promise<T> | null = null
  return () => {
    value ??= fn().catch((e) => {
      value = null
      throw e
    })
    return value
  }
}

export { memo }
export { createOpenFileHub, type OpenFileHub, once } from "@nib/platform"
