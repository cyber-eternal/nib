import { describe, expect, test } from "vitest"
import type { MenuCommand, Platform, SaveChoice } from "../src/index"

// The document controller and the UI depend on this exact shape, so it is checked at compile time.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const typeIs = <T extends true>(): T => true as T

describe("the Platform interface", () => {
  test("dialogs, prefs and the close and open-file subscriptions", () => {
    typeIs<
      Equal<
        Parameters<Platform["dialogs"]["confirm"]>,
        [
          message: string,
          opts?: { title?: string; okLabel?: string; cancelLabel?: string; destructive?: boolean },
        ]
      >
    >()
    typeIs<Equal<ReturnType<Platform["dialogs"]["confirm"]>, Promise<boolean>>>()
    typeIs<Equal<SaveChoice, "save" | "discard" | "cancel">>()
    typeIs<Equal<ReturnType<Platform["dialogs"]["askSave"]>, Promise<"save" | "discard" | "cancel">>>()
    typeIs<
      Equal<
        Parameters<Platform["dialogs"]["message"]>,
        [message: string, opts?: { title?: string; kind?: "info" | "warning" | "error" }]
      >
    >()
    typeIs<Equal<ReturnType<Platform["prefs"]["get"]>, string | null>>()
    typeIs<Equal<Parameters<Platform["prefs"]["set"]>, [key: string, value: string | null]>>()
    typeIs<Equal<ReturnType<Platform["window"]["onCloseRequested"]>, () => void>>()
    typeIs<Equal<Parameters<Platform["window"]["onCloseRequested"]>[0], () => Promise<boolean>>>()
    typeIs<Equal<NonNullable<Platform["onOpenFile"]>, (cb: (path: string) => void) => () => void>>()
    expect(true).toBe(true)
  })

  test("clipboard, recent files, version and menu commands", () => {
    type Clip = Platform["clipboard"]
    typeIs<
      Equal<
        Parameters<NonNullable<Clip["write"]>>[0],
        { text?: string; html?: string; svg?: string; json?: string; png?: Promise<Uint8Array> }
      >
    >()
    typeIs<Equal<Parameters<NonNullable<Clip["writeImage"]>>[0], Uint8Array | Promise<Uint8Array>>>()
    typeIs<Equal<ReturnType<NonNullable<Clip["readImage"]>>, Promise<Uint8Array | null>>>()
    typeIs<
      Equal<
        NonNullable<Platform["recentFiles"]>,
        { list(): Promise<string[]>; add(path: string): Promise<void>; clear(): Promise<void> }
      >
    >()
    typeIs<Equal<NonNullable<Platform["appVersion"]>, () => Promise<string>>>()
    const clear: MenuCommand = "file.clearRecent"
    typeIs<Equal<Extract<MenuCommand, `file.openRecent${string}`>, never>>()
    expect(clear).toBe("file.clearRecent")
  })
})
