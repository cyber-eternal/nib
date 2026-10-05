import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const tauriDir = fileURLToPath(new URL("../../../apps/desktop/src-tauri/", import.meta.url))
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const read = (rel: string) => readFileSync(tauriDir + rel, "utf8")

type Permission = string | { identifier: string; allow?: Record<string, string>[] }
const capability = JSON.parse(read("capabilities/default.json")) as { permissions: Permission[] }
const ids = capability.permissions.map((p) => (typeof p === "string" ? p : p.identifier))
const conf = JSON.parse(read("tauri.conf.json"))

describe("desktop CSP", () => {
  it("frames embeds from exactly the sites core rewrites embed links to", async () => {
    const { EMBED_FRAME_ORIGINS } = await import("@nib/core")
    const csp = conf.app.security.csp as string
    const frameSrc = csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .find(([name]) => name === "frame-src")
    expect(frameSrc?.slice(1)).toEqual([...EMBED_FRAME_ORIGINS])
  })
})

describe("desktop capability lint", () => {
  it("lets the close handler destroy the window", () => {
    expect(ids).toContain("core:window:allow-destroy")
    expect(ids).not.toContain("core:window:allow-close")
  })

  it("grants the dialog message command used for prompts", () => {
    expect(ids).toContain("dialog:allow-message")
    // plugin-dialog 2.7 removed the confirm command; its window.confirm shim always rejects
    expect(ids).not.toContain("dialog:allow-confirm")
  })

  it("scopes the opener to web and mail links", () => {
    const opener = capability.permissions.find(
      (p): p is Exclude<Permission, string> =>
        typeof p !== "string" && p.identifier === "opener:allow-open-url",
    )
    expect(opener?.allow?.map((e) => e.url).sort()).toEqual(["http://*", "https://*", "mailto:*"])
    expect(ids).not.toContain("opener:allow-open-path")
    expect(ids).not.toContain("opener:default")
  })

  it("grants clipboard images", () => {
    expect(ids).toContain("clipboard-manager:allow-write-image")
    expect(ids).toContain("clipboard-manager:allow-read-image")
  })

  it("has no static fs scope beyond what the user picks", () => {
    expect(ids).not.toContain("fs:scope")
    // stat is for noticing outside edits to the open document; like the rest it only
    // reaches paths granted at runtime. Documents are written by the shell's document_write instead of
    // write-text-file, which truncates the file before writing it
    expect(ids.filter((id) => id.startsWith("fs:")).sort()).toEqual([
      "fs:allow-exists",
      "fs:allow-read-text-file",
      "fs:allow-stat",
      "fs:allow-write-file",
    ])
    expect(JSON.stringify(capability)).not.toMatch(/\$HOME|\/Volumes|\/tmp/)
  })
})

describe("desktop bundle config", () => {
  it("does not use the macOS private API", () => {
    expect(conf.app.macOSPrivateApi).toBe(false)
    expect(read("Cargo.toml")).not.toMatch(/macos-private-api/)
  })

  it("declares a UTI and MIME types for the documents", () => {
    const [nibd, excalidraw] = conf.bundle.fileAssociations
    expect(nibd).toMatchObject({
      ext: ["nibd"],
      name: "Nib drawing",
      role: "Editor",
      rank: "Owner",
      mimeType: "application/vnd.nib+json",
      exportedType: { identifier: "app.nib.desktop.nibd", conformsTo: ["public.json", "public.data"] },
    })
    expect(excalidraw.ext).toEqual(["excalidraw"])
    expect(excalidraw.mimeType).toBeTruthy()
    expect(conf.bundle.fileAssociations).toHaveLength(2)
    // .nib is Interface Builder's
    expect(conf.bundle.fileAssociations.flatMap((a: { ext: string[] }) => a.ext)).not.toContain("nib")
  })

  it("is named Nib throughout, identifier included", () => {
    expect(conf.productName).toBe("Nib")
    expect(conf.app.windows[0].title).toBe("Nib")
    expect(conf.identifier).toBe("app.nib.desktop")
  })
})

describe("distribution", () => {
  it("builds with the hardened runtime and a checked-in entitlements file", () => {
    expect(conf.bundle.macOS.hardenedRuntime).toBe(true)
    const entitlements = read(conf.bundle.macOS.entitlements)
    expect(entitlements).toMatch(/<plist version="1.0">/)
    expect(entitlements).not.toMatch(/com\.apple\.security\.cs\.disable-library-validation/)
  })

  it("reads the version from package.json, which About and appVersion() show", () => {
    expect(conf.version).toBe("../package.json")
  })

  it("ships the updater switched off until a release supplies a key and a feed", () => {
    expect(conf.plugins?.updater).toBeUndefined()
    expect(conf.bundle.createUpdaterArtifacts).toBe(false)
    expect(read("Cargo.toml")).toMatch(/tauri-plugin-updater/)
    expect(read("src/lib.rs")).toMatch(/if updater \{\s*builder = builder\.plugin\(tauri_plugin_updater/)
    // the webview reaches the updater only through the shell's own commands
    expect(ids.some((id) => id.startsWith("updater:"))).toBe(false)
  })

  it("releases a universal binary through tauri-action, signing only with real secrets", () => {
    const workflow = readFileSync(`${repo}.github/workflows/release.yml`, "utf8")
    expect(workflow).toMatch(/tauri-apps\/tauri-action@[0-9a-f]{40} # v0\./)
    expect(workflow).toMatch(/--target universal-apple-darwin/)
    expect(workflow).toMatch(/targets: aarch64-apple-darwin,x86_64-apple-darwin/)
    for (const secret of ["APPLE_CERTIFICATE", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_TEAM_ID"]) {
      expect(workflow).toContain(`secrets.${secret}`)
    }
    const pkg = JSON.parse(readFileSync(`${repo}apps/desktop/package.json`, "utf8"))
    expect(pkg.scripts["release:mac"]).toBe("tauri build --target universal-apple-darwin")
  })
})

describe("document window", () => {
  it("lets the shell create the window, so its saved frame is restored before it shows", () => {
    const [main] = conf.app.windows
    expect(main.label).toBe("main")
    expect(main.create).toBe(false)
    expect(main.visible).toBe(false)
    expect(read("Cargo.toml")).toMatch(/tauri-plugin-window-state/)
  })

  it("shows the window once its page has loaded, so a dark board never opens on a light flash", () => {
    const lib = read("src/lib.rs")
    const create = lib.slice(lib.indexOf("fn create_main_window"), lib.indexOf("fn reveal_main_window"))
    expect(create).not.toMatch(/\.show\(\)/)
    expect(lib).toMatch(/PageLoadEvent::Finished => reveal_main_window/)
  })

  it("saves documents through a scope-checked shell command", () => {
    const lib = read("src/lib.rs")
    expect(lib).toMatch(/fn document_write[\s\S]*?fs_scope\(\)\.is_allowed/)
    expect(lib).toMatch(/generate_handler!\[[\s\S]*document_write,/)
  })
})

describe("Linux bundle config", () => {
  const linux = JSON.parse(read("tauri.linux.conf.json"))
  const desktopEntry = read("../linux/nib.desktop")
  const mime = read("../linux/nib-mime.xml")

  it("builds deb, rpm and AppImage on Linux and leaves the macOS targets alone", () => {
    expect(linux.bundle.targets).toEqual(["deb", "rpm", "appimage"])
    expect(conf.bundle.targets).toEqual(["app", "dmg"])
    expect(linux.bundle.category).toBe("GraphicsAndDesign")
  })

  it("passes opened files to the app and defines a MIME type for every document extension", () => {
    expect(desktopEntry).toMatch(/^Exec=\{\{exec\}\} %F$/m)
    expect(desktopEntry).toMatch(/^MimeType=\{\{mime_type\}\};$/m)
    for (const assoc of conf.bundle.fileAssociations as { ext: string[]; mimeType: string }[]) {
      expect(mime).toContain(`<mime-type type="${assoc.mimeType}">`)
      expect(mime).toContain(`<glob pattern="*.${assoc.ext[0]}"/>`)
    }
    for (const pkg of ["deb", "rpm", "appimage"]) {
      expect(linux.bundle.linux[pkg].files["/usr/share/mime/packages/nib.xml"]).toBe("../linux/nib-mime.xml")
    }
    expect(linux.bundle.linux.deb.desktopTemplate).toBe("../linux/nib.desktop")
    expect(linux.bundle.linux.rpm.desktopTemplate).toBe("../linux/nib.desktop")
  })
})
