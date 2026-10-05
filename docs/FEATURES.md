# Nib in detail

Everything the [README](../README.md) leaves out: the full interface, how
themes and the pencil behave, file formats, releasing, the architecture, and
known limits.

## The interface

The board fills the window. Everything you draw with sits in one tray along the
bottom edge, like the ledge under a whiteboard:

- **The marker tray** (bottom centre): Select and Hand; Rectangle, Diamond,
  Parallelogram, Ellipse, Arrow, Line, Pen, Pencil, Text and Eraser; a More drawer; then the
  theme's five colour caps and a custom cap. The tool in hand lifts out of the
  tray in the theme's accent colour. Hovering or focusing a marker shows its name
  and key.
- **The More drawer** opens upward: Image, Frame, Embed, Laser pointer, Lasso,
  Mermaid, and Keep tool active (the old tool lock; a small lock badge shows on
  the held marker while it is on).
- **The style bar** rises above the tray only when there is something to style:
  a selection, or a drawing tool (it then sets the defaults for the next shape).
  It shows only the groups that apply: stroke colour, fill, stroke, edges, closed
  shape, arrow, text, opacity, arrange, and a More menu.
- **Top left:** the main menu, the document name (click to rename) and an
  "Edited" dot while there are unsaved changes.
- **Top right:** Find on canvas, Library, Theme, and Export.
- **Bottom left:** undo, redo and zoom (−, percentage, +, fit). **Bottom right:**
  help, with a "Back to content" pill when your drawing is off-screen.

An empty board shows one hint above the tray. A few contextual hints (such as
"Press Enter to add a label") appear at most three times each. Below 760px wide
the tools scroll, the caps collapse to the current colour, and the top-right
icons fold into one menu.

## Themes

Eleven themes, each with its own board, tray, ink, accent and five marker caps:
Whiteboard, Blackboard, Graphite, Blueprint, Kraft, Legal Pad, Mint, Midnight,
Sakura, High Contrast (2px seams, 3px focus ring) and Clay Dark (warm charcoal
board, ivory ink, clay-orange accent). Pick one from the Theme
button, the main menu, Preferences or the command palette. **Match system**
follows macOS light and dark with Whiteboard and Clay Dark. A fresh install
opens on Clay Dark.
`⇧⌥D` flips between light and dark.

Dark themes remap drawing colours instead of inverting the canvas, so images
keep their colours. On tinted and dark boards, strokes are drawn at least 3:1
and text at least 4.5:1 against whatever is underneath them; near-white boards
show colours exactly as picked. Stored colours never change, so a drawing looks
right when it is opened in another theme or exported.

The UI's colours, type, spacing and components are recorded in
[DESIGN.md](../DESIGN.md).

## The pencil

The Pencil (`P`) draws like the pen, then tidies the stroke when you let go. A
recognised stroke becomes a real, editable shape in the current style: an
ellipse (a circle when it is nearly round), a rectangle (a square when nearly
square; a tilted one keeps its angle; a rounded one gets round corners), a
diamond, a parallelogram, a triangle, a straightened polygon (trapezoid,
pentagon, hexagon), a straight line, or an arrow (a line with a hooked or forked
end). It forgives real-hand strokes: wavy or sloped edges, ends that overshoot a
corner, and a loop left open by up to about a third of its size. Scribbles,
spirals, zigzags and handwriting stay freehand; so does a stroke finished with
`Alt` held.

- A short flash of the corrected outline shows what happened (none with
  reduced motion), and the first few corrections say "Snapped to a circle ·
  ⌘Z keeps your stroke".
- One undo brings back your raw stroke; a second removes it.
- Corrected arrows and lines attach to nearby shapes like drawn ones.
- Click the held Pen or Pencil again for the **Correct shapes** switch, or set
  Preferences › Pen corrects shapes, to make the Pen (`7`) arm the pencil.

## What it does

**Drawing.** Rectangles, diamonds, ellipses, arrows, lines, freehand (pressure
sensitive), text, images, frames and embedded web pages, all with the sketchy
roughjs look. Styles: stroke colour and fill colour (theme caps, 13 hues with
shades, recent colours, a hex field, and an eyedropper on `I`), four fill
styles (hachure, cross-hatch, solid, zigzag), three stroke widths, solid,
dashed or dotted strokes, three sloppiness levels, sharp or round corners, and
opacity. Copy and paste styles with `⌥⌘C` and `⌥⌘V`.

**Arrows.** Drag from one shape to another, or click one shape and then the
other. The arrow attaches to both, meets their borders, and follows them when
they move, resize or rotate. The shape under the pointer is outlined while the
arrow tool is armed. Straight, curved or elbow; elbow arrows route around other
shapes. Twelve arrowheads for either end. Arrows carry their own labels.

**Tidy up** (`⌥T`) straightens connectors: loose ends attach to the shape they
point at, arrows between aligned shapes become straight runs, the rest get a
single clean bend around obstacles, and near-horizontal or near-vertical lines
are squared up. It works on the selection (including arrows bound to selected
shapes) or on the whole board.

**Flowcharts from the keyboard.** `⌘` + arrow adds a connected shape in that
direction; `⌥` + arrow moves to a connected shape.

**Text.** Free text anywhere, or a label bound to a shape or an arrow (`Enter`
on a selected shape). Labels wrap and grow their container. Five families
(hand-drawn, normal, code, serif, mono), four sizes plus custom, horizontal and
vertical alignment.

**Editing.** Select by click, marquee or lasso (`Q`). Move, resize, rotate (with
optional 15° snapping), flip, group, align six ways, distribute, reorder, lock, duplicate
(also by `⌥`-dragging), nudge, and edit the points of any line (`⌘Enter`).
Object snapping with guides and gap markers, and an optional grid you can snap
to. The Stats panel (`⌥/`) shows and edits exact position, size and angle. A
right-click (or `⇧F10`) opens a context menu for the selection or the board.
Undo and redo cover every change to the drawing, a canvas reset included.

**Frames and presenting.** Frames (`F`) clip their contents, carry a name you
edit in place, and move, copy and delete with what is inside them. View ›
Present frames plays them as slides in order, with the laser pointer (`K`) on
hand; arrow keys, Space and Page Up/Down step through, Escape ends the show.

**Images and embeds.** Drop, paste or pick images; large ones are scaled down
on import. Crop by double-clicking, flip, and reset. Embeds (`W`) show YouTube,
Vimeo, Figma, Loom, GitHub Gist, CodePen, CodeSandbox, StackBlitz, Excalidraw
and Spotify pages in sandboxed frames; other links stay as links.

**Diagrams from text.** Paste or type Mermaid flowcharts, sequence diagrams and
class diagrams; they become ordinary shapes and bound arrows you can keep
editing. Subgraphs become frames.

**Paste.** Nib and Excalidraw clipboard data, images, SVG (an SVG exported
with its scene reopens as shapes), links (embeddable ones become embeds),
Mermaid text (opens the Mermaid dialog), tab-separated tables (a grouped grid
of cells) and plain text. Copying writes the drawing, a PNG, an SVG and plain
text at once. Copy as PNG is `⇧⌥C`; Copy as SVG is in the context menu.

**Links.** `⌘K` links a shape to a web page or to another element; "Copy link
to element" makes `#element=` links that jump across the board.

**Library.** Save shapes for reuse, name them, drag them onto the board, and
import or export `.excalidrawlib` files. The library is shared by every drawing,
and in the browser by every open tab.

**Getting around.** Command palette (`⌘/`), Find on canvas (`⌘F`, text and
frame names, every match highlighted), the shortcut sheet (`?`, searchable),
Preferences (`⌘,`), zen mode, view mode, and an infinite canvas with pan and
pinch zoom.

**Keeping your work.** A recovery copy is written about 1.5 seconds after you
pause, and at least every 5 seconds while you keep drawing, so a crash or a
force quit costs nothing: the drawing comes back at the next launch. Each tab
has its own copy. Unsaved changes, text still being typed included, are
protected by the tab close, window close and quit prompts. If another app changes the open file, Nib asks whether to reload or
keep yours. On macOS saves are atomic and keep Finder tags, comments, creation
date and Date Added.

**Accessibility.** Every control is reachable by keyboard with visible focus
and ARIA labels; the tray and style bar are toolbars with arrow-key navigation;
selection changes are announced; motion respects the system setting (or
Preferences › Reduce motion); and High Contrast is a full theme.

## Tabs and session restore

One window holds every open drawing, each in a tab, like a code editor:

- **The tab strip** sits top left, in the pill the document name used to fill,
  after the main menu button. It shows even with one tab, so the name you click
  to rename (double-click, or `F2` on a focused tab) and the edited dot are
  always in the same place, and it hides with the rest of the chrome in zen mode
  and slide shows. Each tab has its own drawing, undo history, file, edited
  state, recovery copy, selection and scroll and zoom, all kept in memory while
  another tab is in front, so switching is instant.
- **A tab** shows the file name (new ones are Untitled, Untitled 2, …) with the
  full path as its tooltip. An edited tab shows the accent dot, which turns into
  the close button under the pointer; the tab in front is underlined in the
  accent. Middle-click closes a tab, drag reorders, and a long row scrolls
  sideways with the tab in front kept in view. Right-click (or the context-menu
  key, or `⇧F10`) offers Close, Close Others, Close to the Right, Close Saved,
  and on desktop Reveal in Finder (Show in File Manager on Linux) and Copy Path.
- **New Tab** `⌘N` or `⌘T`; **Close Tab** `⌘W`; **Reopen Closed Tab** `⇧⌘T`;
  **next and previous tab** `⌃Tab` / `⌃⇧Tab` or `⌃PgDn` / `⌃PgUp`, and on the
  Mac menu `⇧⌘]` / `⇧⌘[`; **go to tab 1–8** `⌘1`…`⌘8`, `⌘9` the last. Off macOS
  `⌘` is Ctrl. In the browser some of these belong to the browser itself, so use
  the tab strip or the main menu there.
- **Opening:** Open… takes several files at once; Open Recent, Finder, Open With,
  the file manager and dropped `.nibd` or `.excalidraw` files each open in a tab.
  A file that is already open brings its tab forward, and an untouched empty
  Untitled tab is reused for the first file. Import from Excalidraw opens in a
  new tab too.
- **Closing** a tab asks Save / Don't Save / Cancel for that drawing. Closing the
  last tab leaves an empty Untitled, as an editor always holds one document.
  Reopen Closed Tab brings back the last twenty closed tabs in their place, with
  their view and recovery slot; work you chose Don't Save for stays discarded.
- **Quitting** or closing the window with unsaved tabs asks once, listing them:
  Save All, Don't Save or Cancel (with one unsaved tab it is the usual
  question). Save All asks for a name for each untitled drawing; cancelling any
  save keeps Nib open. The window title is the tab in front ("Plan.nibd —
  Nib"), the macOS close button shows the edited dot while any tab is unsaved,
  and the proxy icon is the tab in front's file.

**Session restore.** Nib remembers the open tabs, their order, the tab in front
and each tab's scroll and zoom, as they change and again when you quit, so a
crash restores the same tabs as a quit. The window keeps its size and position.
At the next launch the tabs come back: saved drawings from their files, unsaved
ones from their recovery copies, still marked as edited. A file that was moved
or deleted since is skipped with a one-line note, and drawings opened from
Finder at launch open as tabs after the restored ones. Preferences › Reopen tabs
on launch (on by default) turns this off; unsaved work from a crash comes back
either way. The theme is global and always kept. On desktop the session file is
in the app data folder and only the Rust shell reads and writes it; the editor
reports its tabs and cannot reach the file. In the browser the tabs are kept
with their recovery copies in IndexedDB, so a reopened browser tab brings back
the tabs of the last one closed, each from its recovery copy.

## Files and formats

| What | Format |
| --- | --- |
| Drawings | `.nibd`, plain JSON (scene, app state, embedded image files) |
| Excalidraw | opens `.excalidraw`; Menu › Import / Export › Export to Excalidraw writes one |
| Images | PNG (1×, 2×, 3×) and SVG; whole canvas, selection, one frame, or every frame as its own file; background on or off; light or dark; optional embedded scene (so the image reopens as a drawing) and, for SVG, embedded fonts |
| Library | `.excalidrawlib` (versions 1 and 2) import and export |

The macOS app registers `.nibd` as its own document type (and also opens
`.excalidraw`), keeps Open Recent and the
Dock's recent documents, shows the edited dot and the proxy icon, and restores
the window's size and position. In the browser, Chromium's File System Access
API saves back to the file you opened; other browsers download a copy.
Renaming a saved drawing renames its file on macOS; the browser cannot rename
files, so its next Save writes a copy under the new name.

## Release

### macOS

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
bun run desktop:release
```

That runs `tauri build --target universal-apple-darwin` and leaves `Nib.app`
and the `.dmg` in
`apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/`. The app
uses the hardened runtime and needs macOS 11 or later. The version comes from
`apps/desktop/package.json`; pushing a `v<version>` tag runs
`.github/workflows/release.yml`, which builds the universal app and the Linux
packages and publishes a GitHub release.

What needs your Apple credentials (details in
[apps/desktop/RELEASING.md](../apps/desktop/RELEASING.md)):

- **Signing:** a Developer ID Application certificate, as the
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY`
  secrets. Without them the build is ad-hoc signed: it runs on the Mac that
  built it, and Gatekeeper warns everywhere else (right-click › Open, or allow it
  in System Settings › Privacy & Security).
- **Notarisation:** `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and
  `APPLE_TEAM_ID`.
- **Auto-update** needs no Apple account but does need a key pair you generate
  (`bunx tauri signer generate`), the `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets and an `UPDATER_PUBKEY`
  variable. Until then the updater is compiled in but switched off.

### Linux

```bash
bun run desktop:build             # on Linux, with the Tauri prerequisites installed
apps/desktop/linux/build.sh       # on a Mac: builds in Docker (aarch64 on Apple silicon)
apps/desktop/linux/build.sh amd64 # x86_64 under emulation
apps/desktop/linux/smoke.sh       # installs the .deb in a clean container and runs it under Xvfb
```

The packages land in `apps/desktop/src-tauri/target-linux/release/bundle/`
(`deb/`, `rpm/`, `appimage/`). They install a `nib` command, a desktop entry in
Graphics, and MIME types for `.nibd` and `.excalidraw`, so file
managers open drawings in Nib. Opening a drawing while Nib runs opens it in a new
tab of the open window. The menus follow Linux conventions: Quit (Ctrl+Q) ends File,
Preferences (Ctrl+,) ends Edit, About is in Help. The release workflow builds
x86_64 and arm64 on Ubuntu 22.04.

Known limits: only the AppImage updates itself (.deb and .rpm update through the
package manager), the AppImage needs something like AppImageLauncher to register
its file types, and WebKitGTK can show a blank window on some NVIDIA and Wayland
setups, which `WEBKIT_DISABLE_DMABUF_RENDERER=1` fixes. See
[apps/desktop/RELEASING.md](../apps/desktop/RELEASING.md#linux-app).

### Web

```bash
bun run --cwd apps/desktop build    # writes apps/desktop/dist/
```

Outside the Tauri CLI, `vite build` produces the web build: a
Content-Security-Policy, a web app manifest, icons and a service worker that
caches the app for offline use. Asset paths are relative, so `dist/` can be
served from any path. Serve it over HTTPS, and serve `sw.js` with
`Cache-Control: no-cache` so browsers pick up new releases. Installed, it
registers for `.nibd` and `.excalidraw` files.

## How it is put together

```
packages/core       model, geometry, rendering, tools, history, file formats; no DOM
packages/editor     React UI: App, ui/shell, ui/tray, ui/style, ui/primitives, panels,
                    dialogs, canvas host, document controller, export, theme
packages/platform   the interface the editor needs from its host, plus the browser host
apps/desktop        Tauri 2 shell (Rust), the Tauri platform, native menus, the web
                    build's PWA plugin
```

`packages/core` decides what the drawing is and never touches the DOM. It takes
an injected canvas context and text measurer, which is why it is unit-tested in
Node and reused by the SVG exporter. `EditorCore` is the only object the UI
talks to; core reports problems through a host callback, and the UI subscribes
to it through narrow selectors.

Elements are immutable and versioned; every edit is a reversible diff, which
drives undo, redo, dirty tracking and the recovery copy. History is capped by
size as well as count. Z-order uses fractional indices, so reordering rewrites
one field per element.

Files, dialogs, menus, preferences, the session, storage and reading the system
clipboard go through `Platform`. Each tab is an `EditorCore` with its own
`DocumentController`; a `TabsController` owns them, routes opened files to
tabs, merges their window state (title, edited dot, proxy icon), guards closing
the window over every tab and reports the session, which the desktop shell
writes to a file of its own. The browser
implementation (IndexedDB, File System Access, downloads) and the Tauri one
(scope-checked Rust commands, atomic writes) are interchangeable, so a Windows
or Linux build is a matter of another platform and bundle config, not a
rewrite.

## What is not here

- **Real-time collaboration.** Out of scope by decision; there is no sync
  server and no shared editing.
- **Translations.** All strings are inline English; there is no message
  catalogue.
- **Windows builds.** Nothing in the editor is platform specific, but only the
  macOS, Linux and web builds are set up.
- **One window.** Drawings open as tabs in a single window; a tab can't be
  dragged out into a window of its own. Switching tabs rebuilds the board's
  panels, so an open dialog, sheet or popover closes when another tab comes
  forward (the drawing, selection and view stay).
- **Signed releases.** Signing, notarisation and the update feed wait on the
  credentials listed above.
- **Mermaid coverage.** Flowcharts, sequence and class diagrams only. Sequence
  `rect` highlights, `box` groups and activation bars are reported as warnings
  and not drawn.
- **Pencil tuning on real hardware.** Recognition is tested on a large
  synthetic corpus plus two real mouse strokes; more recordings from a
  trackpad and Apple Pencil would tighten it further.
- **Arrow binding details.** Newly drawn arrows attach to a shape's outline,
  not to a fixed point inside it, and a hand-moved elbow segment is re-routed
  the next time a bound shape moves.
- **Grid and snapping.** One grid size both shows and snaps (there is no
  separate "Snap to grid"), and the Preferences grid and snapping settings
  apply to the current drawing, not to new ones. There is no autosave setting.
- **Two theme pickers.** The Theme button shows miniature boards; Preferences
  uses simpler cards.
- **Contrast of the default palette on white.** Near-white boards keep the
  authored palette, so the Orange cap draws at about 2.4:1 on Whiteboard (as in
  Excalidraw).
- **Hex field rounding on some dark themes.** A colour typed into the hex field
  can reopen one unit off (for example `2f9e44` as `2f9e45` on Graphite),
  because the stored colour is the 8-bit inverse of what the theme shows.
- **No end-to-end harness.** Native behaviour (menus, the quit guard, Finder
  opens, updates) is covered by unit tests with fakes and Rust tests, and was
  checked by hand in the browser build; there is no automated test against a
  built `.app`.
