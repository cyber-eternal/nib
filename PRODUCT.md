# Product

Nib is an infinite, hand-drawn whiteboard that stores drawings as plain JSON
files you own. No account, no server, no telemetry.

## Who it is for

Nib is a general-purpose whiteboard for three audiences, weighted equally:

- **Engineers and architects** diagramming systems and flows: boxes, bound
  arrows, labels. Speed and keyboard reach matter most.
- **People thinking alone**: brainstorming, note-taking, doodling ideas. Low
  chrome, a calm canvas.
- **People teaching or presenting live** on screen: pen, laser pointer, big
  readable shapes.

A first-time user should draw, connect, label and export without reading help,
and a regular user should never need the mouse for common actions.

## Positioning

A local-first, Excalidraw-class editor that runs as a native desktop app and in
the browser from one codebase, with arrows that stay attached, a one-key
**Tidy up** that straightens connections, Mermaid paste-to-diagram, and a pencil
that corrects hand-drawn circles, boxes, triangles, diamonds, lines and arrows
into clean, editable shapes when you let go.

## Where it runs

- **Desktop:** a Tauri 2 app for macOS and Linux with native menus, file
  dialogs and `.nibd` / `.excalidraw` file associations.
- **Web:** the same editor as an installable, offline web app.
- **Files:** `.nibd` JSON; opens and exports `.excalidraw`; PNG and SVG export
  with an optional embedded scene.
- **Input:** mouse, trackpad (pinch and scroll), keyboard shortcuts, and pen
  pressure for freehand.

## Capabilities

- `packages/core` is DOM-free and unit-tested in Node; `packages/editor` is a
  thin React layer, and `EditorCore` is the only object the UI talks to.
- **Pencil:** on release a recognised stroke becomes a real shape (ellipse,
  rectangle, rounded rectangle, diamond, parallelogram, triangle, straightened
  polygon, line, arrow). Real-hand input (wavy or sloped edges, overshooting
  ends, open loops) still corrects; scribbles and handwriting stay freehand.
  Undo restores the raw stroke.
- **Parallelogram** (`G`) for flowchart inputs and outputs, stored as a closed
  polygon line.
- **Eleven themes**, Clay Dark by default, with Match system following the OS.
- Real-time collaboration is out of scope.

## Brand

- **Name:** Nib. Documents use `.nibd`, because `.nib` already belongs to
  Interface Builder.
- Hand-drawn (roughjs) look for canvas content only; the chrome uses the
  platform's UI face.
- Light and dark are both first-class. Dark themes remap the palette instead of
  inverting the canvas, so images keep their colours.
- The UI aims to be simple, intuitive and easy to use.

## Principles

1. The canvas is the product; chrome appears when needed and gets out of the way.
2. Every action is discoverable by sight and reachable by keyboard.
3. Correct by default: arrows attach, shapes snap, pencil strokes straighten,
   without asking.
4. Files belong to the user: plain JSON, lossless import and export, no lock-in.

## Accessibility

Toolbar and panels are keyboard-focusable with ARIA labels, motion respects
`prefers-reduced-motion`, and text meets WCAG AA contrast in every shipped
theme.

See [docs/FEATURES.md](docs/FEATURES.md) for the full feature guide,
[DESIGN.md](DESIGN.md) for the design system and
[docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.
