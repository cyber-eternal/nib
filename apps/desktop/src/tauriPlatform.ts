import {
  type ClipboardPayload,
  type FileFilter,
  type Platform,
  type PlatformDialogs,
  type PlatformRecentFiles,
  type PlatformSession,
  type PlatformUpdater,
  type PrefsSnapshot,
  type UpdateInfo,
  clipboardItemData,
  createFileWatcher,
  createMirroredPrefs,
  filtersFor,
  isSceneFile,
  readRestoredSession,
  toExternalUrl,
  withExtension,
} from "@nib/platform"
import { getVersion } from "@tauri-apps/api/app"
import { Channel, invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { appDataDir } from "@tauri-apps/api/path"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  readImage as readClipboardImage,
  readText as readClipboardText,
  writeHtml as writeClipboardHtml,
  writeImage as writeClipboardImage,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager"
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { exists, readTextFile, stat, writeFile } from "@tauri-apps/plugin-fs"
import { openUrl } from "@tauri-apps/plugin-opener"
import { installAppMenu, updateRecentMenu } from "./menu"
import { type CloseGuard, createCloseGuard, createOpenFileHub, memo } from "./shell"

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

interface GuardRequest {
  id: number
  /** terminate: Dock > Quit, log out or shut down, which macOS holds until it gets an answer. */
  kind: "close" | "quit" | "terminate"
}

/** Set by the shell's initialization script (lib.rs create_main_window) before any page script runs. */
interface Boot {
  prefs?: PrefsSnapshot
  updater?: boolean
  /** The tabs to bring back, planned by the shell from its session file (lib.rs restore_session). */
  session?: unknown
}

const boot = (): Boot =>
  (typeof window !== "undefined" ? (window as { __NIB_BOOT__?: Boot }).__NIB_BOOT__ : undefined) ?? {}

// the close button's edited dot already says "unsaved", so a bullet in the title would say it twice
const hasNativeEditedDot = (): boolean =>
  typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent ?? "")

const isForbidden = (e: unknown): boolean => /forbidden path/i.test(String(e))

const abortError = (): Error => {
  const err = new Error("The document was not saved.")
  err.name = "AbortError"
  return err
}

/** The shell writes beside the file and renames over it, so a full disk or a crash never truncates it. */
const writeDocumentFile = (path: string, contents: string): Promise<void> =>
  invoke<void>("document_write", { path, contents })

const extensionMissing = (path: string, filters: FileFilter[]): string | null => {
  const fixed = withExtension(path, filters)
  return fixed === path ? null : fixed.slice(fixed.lastIndexOf(".") + 1)
}

/** NSSavePanel appends the extension itself; this only covers a name typed with a foreign one. */
const pickSavePath = async (defaultPath: string, filters: FileFilter[]): Promise<string | null> => {
  const picked = await saveDialog({ defaultPath, filters })
  if (typeof picked !== "string") return null
  const ext = extensionMissing(picked, filters)
  return ext ? invoke<string>("allow_with_extension", { path: picked, ext }) : picked
}

const encodePng = async (rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not read the clipboard image.")
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Could not read the clipboard image.")
  return new Uint8Array(await blob.arrayBuffer())
}

/** The plugin writes one flavour at a time, so the fallback keeps the one Nib itself pastes back. */
const writeSingleFlavour = async (items: ClipboardPayload): Promise<void> => {
  const plain = items.json ?? items.text
  if (items.html !== undefined) return writeClipboardHtml(items.html, plain)
  if (plain !== undefined) return writeClipboardText(plain)
  if (items.png) return writeClipboardImage(await items.png)
  if (items.svg !== undefined) return writeClipboardText(items.svg)
}

const createDialogs = (): PlatformDialogs => ({
  async confirm(text, opts) {
    const ok = opts?.okLabel ?? "OK"
    const result = await message(text, {
      title: opts?.title ?? "Nib",
      kind: opts?.destructive ? "warning" : "info",
      buttons: { ok, cancel: opts?.cancelLabel ?? "Cancel" },
    })
    return result === ok || result === "Ok"
  },
  async askSave(documentName) {
    const result = await message("Your changes will be lost if you don't save them.", {
      title: `Do you want to save the changes made to "${documentName}"?`,
      kind: "warning",
      buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
    })
    if (result === "Save" || result === "Yes") return "save"
    if (result === "Don't Save" || result === "No") return "discard"
    return "cancel"
  },
  async askSaveAll(documentNames) {
    const list = documentNames.map((n) => `“${n}”`).join(", ")
    const result = await message(`${list}\n\nYour changes will be lost if you don't save them.`, {
      title: `Do you want to save the changes to ${documentNames.length} drawings?`,
      kind: "warning",
      buttons: { yes: "Save All", no: "Don't Save", cancel: "Cancel" },
    })
    if (result === "Save All" || result === "Yes") return "save"
    if (result === "Don't Save" || result === "No") return "discard"
    return "cancel"
  },
  async message(text, opts) {
    await message(text, { title: opts?.title ?? "Nib", kind: opts?.kind ?? "info" })
  },
})

interface Updater extends PlatformUpdater {
  /** Resolves false when the user kept the window open, so the update waits for the next launch. */
  installAndRelaunch(onProgress?: (downloaded: number, total: number | null) => void): Promise<boolean>
}

const createUpdater = (guard: CloseGuard): Updater => {
  const installAndRelaunch: Updater["installAndRelaunch"] = async (onProgress) => {
    const progress = new Channel<{ downloaded: number; total?: number | null }>()
    progress.onmessage = ({ downloaded, total }) => onProgress?.(downloaded, total ?? null)
    await invoke("updater_install", { onProgress: progress })
    if (!(await guard.run())) return false
    await invoke("relaunch_app")
    return true
  }
  return {
    check: () => invoke<UpdateInfo | null>("updater_check"),
    async install(onProgress) {
      await installAndRelaunch(onProgress)
    },
    installAndRelaunch,
  }
}

/** How long after launch the silent update check waits, so it never competes with opening a document. */
const UPDATE_CHECK_DELAY_MS = 15_000

export const createTauriPlatform = (): Platform => {
  const appWindow = getCurrentWindow()
  const guard = createCloseGuard()
  const openFiles = createOpenFileHub()
  const dialogs = createDialogs()
  const dataDir = memo(async () => (await appDataDir()).replace(/\/+$/, ""))
  const isAppData = async (path: string) => path.startsWith(`${await dataDir()}/`)
  const nativeEditedDot = hasNativeEditedDot()
  const settings = boot()
  const updater = settings.updater ? createUpdater(guard) : undefined

  const watcher = createFileWatcher(async (path) => {
    try {
      const info = await stat(path)
      return `${info.mtime ? new Date(info.mtime).getTime() : 0}:${info.size}`
    } catch (e) {
      if (!(await exists(path).catch(() => true))) return null
      throw e
    }
  })
  let watchingFocus = false
  const checkOnFocus = () => {
    if (watchingFocus) return
    watchingFocus = true
    void appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void watcher.check()
      })
      .catch(() => {
        watchingFocus = false
      })
  }

  let offering = false
  const offerUpdate = async (interactive: boolean): Promise<void> => {
    if (!updater || offering) return
    offering = true
    try {
      const info = await updater.check()
      if (!info) {
        if (interactive) {
          const version = await getVersion().catch(() => null)
          const text = version ? `Nib ${version} is the newest version.` : "This is the newest Nib."
          await dialogs.message(text, { title: "You're up to date" })
        }
        return
      }
      const notes = info.notes?.trim() ? `\n\n${info.notes.trim()}` : ""
      const install = await dialogs.confirm(
        `Nib ${info.version} is available. You have ${info.currentVersion}.${notes}`,
        {
          title: "A new version of Nib is available",
          okLabel: "Install and Relaunch",
          cancelLabel: "Later",
        },
      )
      if (install && !(await updater.installAndRelaunch())) {
        await dialogs.message("Nib will use the new version the next time it opens.", {
          title: "The update is installed",
        })
      }
    } catch (e) {
      if (interactive) {
        await dialogs.message(String(e), { title: "Nib couldn't check for updates", kind: "error" })
      } else {
        console.warn("The update check failed", e)
      }
    } finally {
      offering = false
    }
  }
  if (updater) setTimeout(() => void offerUpdate(false), UPDATE_CHECK_DELAY_MS)

  const refreshRecentMenu = () =>
    invoke<string[]>("recent_list")
      .then(updateRecentMenu)
      .catch(() => {})

  const recentFiles: PlatformRecentFiles = {
    list: () => invoke<string[]>("recent_list"),
    async add(path) {
      await updateRecentMenu(await invoke<string[]>("recent_add", { path }))
    },
    async clear() {
      await invoke("recent_clear")
      await updateRecentMenu([])
    },
  }

  const remember = (path: string) => {
    if (isSceneFile(path)) void recentFiles.add(path).catch(() => {})
  }

  const readPicked = async (path: string) => {
    const contents = await readTextFile(path)
    await watcher.track(path)
    remember(path)
    return { path, name: path.split("/").pop() ?? path, contents }
  }

  let restorable = readRestoredSession(settings.session)
  const session: PlatformSession = {
    async restore() {
      const restored = restorable
      restorable = null
      return restored
    },
    save: (tabs, active) => invoke("session_report", { tabs, active }),
  }

  const openRecent = async (path: string) => {
    try {
      await invoke("open_recent", { path })
      openFiles.push(path)
    } catch (e) {
      void refreshRecentMenu()
      await dialogs.message(String(e), { title: "The document could not be opened", kind: "error" })
    }
  }

  void listen<GuardRequest>("nib://guard", async ({ payload }) => {
    await invoke("guard_ack", { id: payload.id }).catch(() => {})
    const allowed = await guard.run()
    if (payload.kind === "terminate") {
      await invoke("terminate_reply", { allowed }).catch((e) => console.error("Could not answer macOS", e))
      return
    }
    if (!allowed) return
    try {
      if (payload.kind === "quit") await invoke("exit_app")
      else await appWindow.destroy()
    } catch (e) {
      console.error("Could not close the window", e)
    }
  })
    .then(() => invoke("guard_ready"))
    .catch((e) => console.error("The close guard is not active", e))

  void listen<string>("open-file", ({ payload }) => {
    openFiles.push(payload)
    void refreshRecentMenu()
  })
    .then(() => invoke<string[]>("take_pending_opens"))
    .then((paths) => {
      for (const path of paths) openFiles.push(path)
      if (paths.length > 0) void refreshRecentMenu()
    })
    .catch((e) => console.error("Files opened from Finder will not reach the editor", e))

  return {
    name: "tauri",
    capabilities: { reopenByPath: true, saveInPlace: true },

    fs: {
      async openDocument(filters) {
        const path = await openDialog({ multiple: false, directory: false, filters })
        if (typeof path !== "string") return null
        return readPicked(path)
      },

      async openDocuments(filters) {
        const picked = await openDialog({ multiple: true, directory: false, filters })
        const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : []
        return Promise.all(paths.map(readPicked))
      },

      async saveDocument(contents, path, suggestedName, filters) {
        const formats = filtersFor(suggestedName, filters)
        if (path) {
          try {
            await watcher.verify(path)
            await watcher.writing(path, () => writeDocumentFile(path, contents))
            remember(path)
            return path
          } catch (e) {
            // a path restored from a previous session has lost its grant; asking again re-grants it
            if (!isForbidden(e)) throw e
          }
        }
        const target = await pickSavePath(path ?? suggestedName, formats)
        // null would read as "saved in place" to a caller that passed a path
        if (!target && path) throw abortError()
        if (!target) return null
        await watcher.writing(target, () => writeDocumentFile(target, contents))
        remember(target)
        return target
      },

      async renameDocument(path, name) {
        let target: string
        try {
          target = await watcher.moving(path, () => invoke<string>("document_rename", { path, name }))
        } catch (e) {
          // a path restored from a previous session has lost its grant, and only a save dialog gives it back
          if (isForbidden(e)) throw new Error("Nib no longer has access to it. Save it, then rename it.")
          throw e instanceof Error ? e : new Error(String(e))
        }
        void refreshRecentMenu()
        return target
      },

      async saveBinary(data, suggestedName, filters) {
        const target = await pickSavePath(suggestedName, filtersFor(suggestedName, filters))
        if (!target) throw abortError()
        await writeFile(target, data)
        return target
      },

      async readText(path) {
        if (await isAppData(path)) return invoke<string>("appdata_read", { path })
        const contents = await readTextFile(path)
        await watcher.track(path)
        return contents
      },

      async writeText(path, contents) {
        if (await isAppData(path)) await invoke("appdata_write", { path, contents })
        else await watcher.writing(path, () => writeDocumentFile(path, contents))
      },

      async exists(path) {
        return (await isAppData(path)) ? invoke<boolean>("appdata_exists", { path }) : exists(path)
      },

      async remove(path) {
        if (!(await isAppData(path))) throw new Error("Nib only deletes files in its own data folder.")
        await invoke("appdata_remove", { path })
      },

      appDataDir: () => dataDir(),
      sharedDataDir: () => dataDir(),

      watch(path, onChange, opts) {
        checkOnFocus()
        return watcher.watch(path, onChange, opts)
      },

      stamp: (path) => watcher.stamp(path),
    },

    menu: {
      async install(onCommand) {
        const [version, recent] = await Promise.all([
          getVersion().catch(() => undefined),
          recentFiles.list().catch(() => []),
        ])
        await installAppMenu(onCommand, {
          version,
          recent,
          openRecent: (path) => void openRecent(path),
          clearRecent: () => void recentFiles.clear().catch(() => {}),
          checkForUpdates: updater ? () => void offerUpdate(true) : undefined,
        })
      },
    },

    window: {
      async setTitle(title) {
        await appWindow.setTitle(nativeEditedDot ? title.replace(/^•\s*/, "") : title)
      },
      async setDocumentEdited(edited) {
        await invoke("set_document_edited", { edited })
      },
      onCloseRequested(handler) {
        return guard.add(handler)
      },
      async setRepresentedFile(path) {
        await invoke("set_represented_file", { path: path && isSceneFile(path) ? path : null })
      },
    },

    clipboard: {
      writeText: (text) => writeClipboardText(text),
      readText: () => readClipboardText(),
      write(items) {
        let native: Promise<void> | null = null
        try {
          if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
            native = navigator.clipboard.write([new ClipboardItem(clipboardItemData(items))])
          }
        } catch {
          native = null
        }
        return (native ?? Promise.reject()).catch(() => writeSingleFlavour(items))
      },
      async writeImage(png) {
        await writeClipboardImage(await png)
      },
      async readImage() {
        let image: Awaited<ReturnType<typeof readClipboardImage>>
        try {
          image = await readClipboardImage()
        } catch {
          return null
        }
        try {
          const { width, height } = await image.size()
          return await encodePng(await image.rgba(), width, height)
        } finally {
          void image.close()
        }
      },
    },

    dialogs,
    prefs: createMirroredPrefs({
      boot: settings.prefs,
      mirror: (key, value, rev) => invoke("prefs_set", { key, value, rev }),
    }),

    async openExternal(url) {
      const href = toExternalUrl(url)
      if (!href) throw new Error("Only web and email links can be opened.")
      await openUrl(href)
    },

    onOpenFile(cb) {
      return openFiles.subscribe(cb)
    },

    recentFiles,
    appVersion: () => getVersion(),
    updater: updater && { check: updater.check, install: updater.install },
    session,
    revealPath: (path) => invoke("reveal_document", { path }),
  }
}
