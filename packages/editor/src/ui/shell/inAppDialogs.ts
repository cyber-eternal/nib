import type { Platform, PlatformDialogs, SaveChoice } from "@nib/platform"
import type { ShellDialogsApi } from "./ShellDialogs"

/** The platform's question dialogs answered by themed in-app dialogs instead of window.confirm. */
export const inAppDialogs = (api: ShellDialogsApi): PlatformDialogs => ({
  confirm: (message, opts = {}) =>
    api.confirm(message, {
      title: opts.title,
      okLabel: opts.okLabel,
      cancelLabel: opts.cancelLabel,
      destructive: opts.destructive,
    }),
  askSave: async (name): Promise<SaveChoice> => {
    const answer = await api.choose({
      title: `Save changes to “${name}”?`,
      message: "Your changes are lost if you don't save them.",
      choices: [
        { id: "cancel", label: "Cancel" },
        { id: "discard", label: "Don't save", variant: "danger" },
        { id: "save", label: "Save", variant: "primary" },
      ],
      defaultId: "save",
      cancelId: "cancel",
    })
    return answer === "save" || answer === "discard" ? answer : "cancel"
  },
  message: async (message, opts = {}) => {
    await api.choose({
      title: opts.title ?? (opts.kind === "error" ? "Something went wrong" : "Nib"),
      message,
      choices: [{ id: "ok", label: "OK", variant: "primary" }],
      defaultId: "ok",
      cancelId: "ok",
    })
  },
})

/**
 * The browser's dialogs are the unthemed, blocking window.confirm; route them through the app. The
 * desktop keeps its native sheets. A proxy keeps every other member (and its `this`) untouched.
 */
export const withInAppDialogs = (platform: Platform, api: ShellDialogsApi): Platform => {
  if (platform.name !== "browser") return platform
  const dialogs = inAppDialogs(api)
  return new Proxy(platform, {
    get: (target, key) => (key === "dialogs" ? dialogs : Reflect.get(target, key)),
  })
}
