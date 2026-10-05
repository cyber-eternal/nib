# Releasing Nib

One codebase gives three builds: the macOS app (Tauri), the Linux app (Tauri: .deb, .rpm and AppImage) and the
web build (a static site that works offline).

## macOS app

```sh
bun install
cd apps/desktop
bun run release:mac      # tauri build --target universal-apple-darwin
```

`--target universal-apple-darwin` makes one binary for both Apple silicon and Intel. It needs both Rust
targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`. The bundles end up in
`src-tauri/target/universal-apple-darwin/release/bundle/` (`macos/Nib.app` and `dmg/`). A plain
`bun run tauri build` builds only for the machine you're on.

The app always uses the hardened runtime (`bundle.macOS.hardenedRuntime`) with
`src-tauri/Entitlements.plist`. That file is empty on purpose. WKWebView runs JavaScript in WebKit's own
processes, so the app needs no JIT or unsigned-memory exceptions, and it is not sandboxed.

The version comes from `apps/desktop/package.json`. tauri.conf.json points at that file, and both the About
box and `platform.appVersion()` read it at runtime through `getVersion()`. To release, bump the version
there, then tag the commit `v<version>`.

### Signing and notarisation (needs your Apple Developer account)

Without credentials, a build is ad-hoc signed (`signingIdentity: "-"`). It runs on the machine that built
it, but Gatekeeper warns about it everywhere else. To ship a build that opens without warnings:

1. In Xcode or on developer.apple.com, create a **Developer ID Application** certificate. Export it from
   Keychain Access as a `.p12` file with a password.
2. Make an **app-specific password** for your Apple ID at appleid.apple.com.
3. Add these GitHub Actions secrets to the repository:

   | Secret | Value |
   | --- | --- |
   | `APPLE_CERTIFICATE` | `base64 -i certificate.p12 \| pbcopy` |
   | `APPLE_CERTIFICATE_PASSWORD` | the .p12 export password |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID1234)` |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your 10-character team ID |

Pushing a `v*` tag (or running the workflow by hand, which uses `v` + the version in `package.json`) runs
`.github/workflows/release.yml`. It creates a draft GitHub release, builds the universal app, signs it when
the certificate secrets are present, notarises it when the Apple ID secrets are present too, and attaches
the `.dmg`. The workflow never sends a half-configured identity to the bundler. Once the macOS and Linux
builds have all uploaded, it publishes the release and marks it latest.

Every package is uploaded twice: under the versioned name the bundler gives it (which `latest.json`
refers to) and under a stable name, so
`https://github.com/cyber-eternal/nib/releases/latest/download/<name>` always serves the newest build:
`Nib-macOS-universal.dmg`, `Nib-linux-x86_64.AppImage`, `Nib-linux-arm64.AppImage`,
`Nib-linux-amd64.deb`, `Nib-linux-arm64.deb`, `Nib-linux-x86_64.rpm` and `Nib-linux-aarch64.rpm`.

To sign locally instead, export the same variables in your shell before running `bun run release:mac`.

### Auto-update (needs a signing key pair you generate)

The updater (tauri-plugin-updater) is compiled in but stays switched off unless a build has both a public
key and an update feed. The default config has neither, so local builds never check for updates. To ship
updates:

1. Generate the key pair once: `bunx tauri signer generate -w ~/.tauri/nib.key`. Keep the private key
   and its password safe. Losing them means existing installs can never update again.
2. Add the secrets `TAURI_SIGNING_PRIVATE_KEY` (the contents of `~/.tauri/nib.key`) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Add the repository **variable** (not a secret) `UPDATER_PUBKEY` with the contents of
   `~/.tauri/nib.key.pub`.

With those set, the release workflow builds with `bundle.createUpdaterArtifacts` and an updater config that
points at `https://github.com/cyber-eternal/nib/releases/latest/download/latest.json`. It also uploads
`latest.json` with the release, which the workflow publishes so that `releases/latest` points at it.
Installed apps then check about 15 seconds after launch, and from **Nib › Check for Updates…**. They ask
before installing, and they relaunch only once the unsaved-changes prompt allows it.

## Linux app

On a Linux machine with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux)
(`libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `patchelf`, …):

```sh
bun install
bun run desktop:build    # tauri build, which reads src-tauri/tauri.linux.conf.json on Linux
```

On a Mac, build in Docker instead. The script mounts the repo but gives the container its own
`node_modules`, `dist`, `gen` and Cargo target folder (named Docker volumes), so the Mac's build is never
touched; only the finished packages are copied back into the repo:

```sh
apps/desktop/linux/build.sh          # the Docker host's architecture: aarch64 on Apple silicon
apps/desktop/linux/build.sh amd64    # x86_64 under emulation, much slower
apps/desktop/linux/smoke.sh          # installs the .deb in a clean container and runs it under Xvfb
```

The bundles land in `src-tauri/target-linux/release/bundle/` (`target-linux-amd64/` for the emulated
build): `deb/Nib_<version>_arm64.deb`, `rpm/Nib-<version>-1.aarch64.rpm` and
`appimage/Nib_<version>_aarch64.AppImage`. The binary is `nib`. The emulated x86_64 build makes the .deb and .rpm, but
linuxdeploy fails under emulation, so the x86_64 AppImage comes from CI.

`tauri.linux.conf.json` is merged over `tauri.conf.json` on Linux only. It sets the targets, the
Graphics category, the binary name, and two files in `apps/desktop/linux/`:

- `nib.desktop`, the desktop entry template. Tauri's default has no `%F`, so a file manager could not
  hand Nib the file you opened.
- `nib-mime.xml`, installed to `/usr/share/mime/packages/`. The bundler only names the MIME types in the
  desktop entry, so without this `.nibd` and `.excalidraw` files would not be recognised.
  dpkg and rpm triggers run `update-mime-database` after install.

Launching Nib with a drawing while it is already running hands the file to the open window
(tauri-plugin-single-instance, over D-Bus) and brings it forward.

The release workflow's `linux` job builds on `ubuntu-22.04` (x86_64) and `ubuntu-22.04-arm` (arm64) and
adds the packages to the same release before it is published. It uses 22.04 because an AppImage runs only on systems with
at least the glibc it was built against.

Known limits:

- Only the AppImage updates itself. The updater can't replace files a package manager owns, so in a
  .deb or .rpm install the shell switches it off (no Check for Updates, no launch-time check), and those
  installs update by installing the newer package. With the update secrets set, the workflow signs the
  AppImage and adds it to `latest.json`.
- The AppImage registers its file types only once something like AppImageLauncher integrates it.
- Builds are not GPG-signed and there is no apt or dnf repository.
- On some NVIDIA and Wayland setups WebKitGTK shows a blank window. Start Nib with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` there.

## Web build

```sh
cd apps/desktop
bun run build            # vite build, giving dist/
```

Run outside the Tauri CLI, `vite build` produces the web build. It adds a Content-Security-Policy meta tag,
a web app manifest, icons and `sw.js`, a service worker that caches the app for offline use. Desktop
builds get none of these. Asset paths are relative, so `dist/` can be served from any path. To deploy:

- Serve over HTTPS. Service workers and the File System Access API need a secure context.
- Serve `sw.js` with `Cache-Control: no-cache` or a short max-age, so browsers notice new releases. Files
  in `assets/` are content-hashed and can be cached forever.
- A new release takes over once every open Nib tab has been closed.

In Chromium browsers, Save writes back to the file the user opened or picked (File System Access API).
Other browsers download a copy. The installed web app also registers for `.nibd` and `.excalidraw`
files.
