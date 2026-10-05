---
name: Nib
description: A local-first hand-drawn whiteboard. One marker tray along the bottom edge of a full-bleed matte board.
colors:
  board: "#FBFBFA"
  tray: "#ECEDEF"
  tray-seam-hi: "#FFFFFF"
  tray-seam-lo: "#B1B2B3"
  surface: "#FDFDFD"
  surface-2: "#F2F2F2"
  seam: "#CFD0D3"
  ink: "#202124"
  ink-dim: "#696A6C"
  ink-faint: "#868688"
  course: "#2D68FA"
  course-ink: "#FFFFFF"
  course-fill: "#2D68FA"
  course-soft: "#E0E8FD"
  danger: "#C52929"
  danger-soft: "#F8E8E8"
  signal: "#F5572C"
  hover: "rgba(32, 33, 36, 0.06)"
  press: "rgba(32, 33, 36, 0.12)"
  scrim: "rgba(32, 33, 36, 0.24)"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    fontFeature: '"tnum"'
  control:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: '"tnum"'
  control-strong:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
    fontFeature: '"tnum"'
  button:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
    fontFeature: '"tnum"'
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: '"tnum"'
  label-heading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
  code:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  canvas-hand:
    fontFamily: '"Shantell Sans", "Comic Sans MS", cursive'
    fontSize: "20px"
    fontWeight: 400
  canvas-normal:
    fontFamily: '"Nunito", "Helvetica Neue", Arial, sans-serif'
    fontSize: "20px"
    fontWeight: 400
  canvas-code:
    fontFamily: '"Cascadia Code", "SF Mono", Menlo, monospace'
    fontSize: "20px"
    fontWeight: 400
rounded:
  s: "6px"
  m: "10px"
  l: "14px"
  round: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
components:
  tray:
    backgroundColor: "{colors.tray}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
    height: "56px"
    padding: "0 8px"
  tray-marker:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    size: "40px"
  tray-marker-hover:
    backgroundColor: "{colors.hover}"
  tray-marker-held:
    backgroundColor: "{colors.course-fill}"
    textColor: "{colors.course-ink}"
    rounded: "{rounded.m}"
    size: "40px"
  colour-cap:
    rounded: "{rounded.round}"
    size: "24px"
    width: "40px"
    height: "40px"
  button-primary:
    backgroundColor: "{colors.course-fill}"
    textColor: "{colors.course-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.s}"
    height: "32px"
    padding: "0 12px"
  button-primary-disabled:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-faint}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.s}"
    height: "32px"
    padding: "0 12px"
  button-quiet-hover:
    backgroundColor: "{colors.hover}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.s}"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.danger-soft}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    size: "40px"
  icon-button-small:
    rounded: "{rounded.s}"
    size: "28px"
  icon-button-pressed:
    backgroundColor: "{colors.course-fill}"
    textColor: "{colors.course-ink}"
  chrome-chip:
    backgroundColor: "{colors.board}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "4px"
  style-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "4px"
  popover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "8px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.s}"
    height: "32px"
    padding: "0 12px 0 8px"
  menu-item-danger:
    textColor: "{colors.danger}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
    width: "480px"
  side-sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
    width: "320px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.s}"
    height: "32px"
    padding: "0 8px"
  hint-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.control}"
    rounded: "{rounded.m}"
    padding: "4px 12px"
  pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    height: "32px"
    padding: "0 12px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.s}"
    padding: "4px 8px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.m}"
    padding: "8px 16px"
  toast-error:
    backgroundColor: "{colors.danger}"
  kbd:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.s}"
    padding: "0 4px"
  segmented:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.s}"
    padding: "2px"
  segment-checked:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "28px"
---

# Design System: Nib

## Overview

**Creative North Star: "The Marker Tray"**

The window is a matte board and the board is the product. Everything you draw with lies in one tray along the bottom edge, like the aluminium ledge under a classroom whiteboard: tools on the left as markers, the theme's five colour caps on the right. Picking a tool lifts its marker out of the tray in the theme's one reserved accent, the "course" ink. Style options rise above the tray only while there is something to style. Everything else is a small, quiet chip in a corner: the document label top-left, Search, Library, Theme and the one primary button (Export) top-right, undo and zoom as a ledge end bottom-left, help bottom-right.

The chrome is an operating tool, not a stage. It is dense where hands work (40px markers, 4px gaps), calm everywhere else, and set in the platform's own UI face so it reads as part of the Mac. The hand-drawn look belongs to what the user draws, never to the chrome. Depth is one soft shadow plus the ledge's two hairline seams. Colour is one neutral ramp per theme and one accent, and the accent marks state, never decoration. Eleven themes ship (Whiteboard, Blackboard, Graphite, Blueprint, Kraft, Legal Pad, Mint, Midnight, Sakura, High Contrast, Clay Dark). Each is four hand-set colours plus five caps; every other token is derived from those with contrast floors, so a new theme cannot ship below AA by accident.

This system rejects Excalidraw's scattered islands: no top toolbar, no left properties panel, no floating corner widgets beyond the four corner chips.

**Key Characteristics:**
- Full-bleed board; one bottom tray; chrome as quiet chips floating 12px from the window edges.
- One reserved accent (course ink) per theme, spent only on state.
- Where the accent is a fill under text or icons (primary button, held marker, pressed button) it is `course-fill`: the accent itself, or for themes with `whiteOnCourse` (Clay Dark, Midnight) the accent deepened just until white text reads at 4.5:1 (Clay Dark `#D97757` → `#B06046`). Strokes, rings and selection keep the bright `course`.
- Every seam is one device pixel; elevation is one shadow step.
- System UI type at 12/13/15px with tabular numerals; hand-drawn faces only on the canvas.
- 40px hit targets, 20px line icons at a 1.75 stroke, a 4px spacing module.
- Eleven themes from four inputs each, contrast-checked by derivation.

The only shipping raster is the app icon, `apps/desktop/src-tauri/app-icon.png` (1024×1024), rendered with macOS QuickLook from `apps/desktop/src-tauri/app-icon.svg` with a baked drop shadow. It shows a clay-orange hand stroke under its corrected ivory triangle on the Clay Dark charcoal, the pencil's correction in one mark. `tauri icon` expands it into `src-tauri/icons/` and the web manifest icons; regenerate from the SVG, never edit the PNGs.

## Colors

One neutral ramp and one accent per theme: the board, a slightly darker tray, ink, and the course ink, with everything else derived from those four.

The frontmatter records the Whiteboard theme, which is the stylesheet default (`theme/tokens.css`). At runtime `applyTheme()` (`theme/themes.ts`) overwrites every colour custom property on the root for the chosen theme, so components only ever read tokens.

### Primary
- **Course Blue** (#2D68FA, Whiteboard): the reserved accent. It marks the selection outline and handles, the held marker and its slot bar, keyboard focus rings and focused field borders, the ring on the current cap and current theme, the "Edited" dot, a drop target, the text caret, links, and the one primary button (Export). The canvas derives selection fill (8% light, 14% dark), the binding highlight (55%) and the pencil's correction flash from it. Each theme sets its own course (Blackboard chalk yellow, Kraft oxblood, Midnight coral and so on; table below).
- **Course Ink** (#FFFFFF on Whiteboard): text and icons on a course fill. Derived: white when white contrasts better with the course, otherwise the theme's dark ink (light themes) or board (dark themes).
- **Course Soft** (#E0E8FD): the text-selection highlight, and the pressed "Keep tool active" tile. A tint, never a fill for content.

### Secondary
- **Signal Orange** (#F5572C, Whiteboard): course's partner for things that must never read as selection: snap guides and search-hit highlights (35%). Derived by rotating the course hue 150° and holding 3.2:1 on board and surface.

### Neutral
- **Matte Board** (#FBFBFA): the canvas ground, and the fill of the document label and top-action chips so they read over drawings.
- **Ledge Grey** (#ECEDEF): the tray, the ledge end, the help corner and the slide-show bar.
- **Ledge Highlight / Ledge Shadow** (#FFFFFF / #B1B2B3): the 1-device-pixel inset seams along the top and bottom of every ledge surface. Light trays use pure white above and a seam at least 1.8:1 darker below; dark trays use a highlight at least 1.45:1 lighter and a shadow 1.25:1 darker.
- **Paper Surface** (#FDFDFD) and **Paper Surface 2** (#F2F2F2): popovers, menus, dialogs, sheets, the style bar, toasts' text; surface-2 for segmented tracks, kbd chips and disabled primaries. Light themes lift surface toward white; dark themes raise it toward the ink.
- **Seam** (#CFD0D3): every hairline border and divider.
- **Ink** (#202124): text and icons. At least 13:1 on the Whiteboard board.
- **Ink Dim** (#696A6C): secondary text, menu headings, hints, placeholders. Derived to hold 4.6:1 on board, tray, surface and surface-2 (7:1 in High Contrast).
- **Ink Faint** (#868688): non-text only: input borders, idle switch tracks, disabled glyphs, scrollbar thumbs. Holds 3:1 on board, tray and surface. Never used for text a user must read.
- **Danger Red** (#C52929) and **Danger Soft** (#F8E8E8): destructive actions and their hover; error toasts. Derived to hold 4.6:1 on every ground.
- **Hover / Press washes** (ink at 6% / 12% light, 8% / 14% dark): the only hover and pressed backgrounds, so they read the same on board, tray and surface.
- **Scrim** (ink at 24% light, black at 55% dark): behind modal dialogs.

### The eleven themes

Each theme supplies exactly these inputs (`theme/themes.ts`). Caps are display colours for the board; dark themes store them as their light originals.

| Theme | Mode | Board | Tray | Ink | Course | Caps (names) |
| --- | --- | --- | --- | --- | --- | --- |
| Whiteboard | light | #FBFBFA | #ECEDEF | #202124 | #2D68FA | #1E1E1E #1971C2 #E03131 #2F9E44 #F08C00 (Black, Blue, Red, Green, Orange) |
| Blackboard | dark | #1F2D27 | #2A3A33 | #EDEFE6 | #F4D35E | #F1F3EE #F5A742 #F7A8B8 #9AD1F5 #B5E48C (White, Amber, Pink, Blue, Green) |
| Graphite | dark | #16171A | #222428 | #E6E7EA | #7AA2FF | #E6E7EA #74C0FC #FF8787 #69DB7C #FFD43B (White, Blue, Red, Green, Yellow) |
| Blueprint | dark | #0F3460 | #163F72 | #E8F1FF | #FFD166 | #FFFFFF #8BE9FD #FFA94D #FF9AC1 #B9F18C (White, Cyan, Orange, Pink, Green) |
| Kraft | light | #D8C29D | #CBB289 | #2B2118 | #9E2F14 | #1E1E1E #A8123E #1F3A5F #2E5E3A #7C5300 (Black, Crimson, Navy, Green, Ochre) |
| Legal Pad | light | #FFF4B8 | #F2E49A | #2A2A2A | #C81E3A | #1F2A44 #1E1E1E #7F1D1D #2F7D32 #6A1B9A (Navy, Black, Dark red, Green, Purple) |
| Mint | light | #EEF6F1 | #DCEBE2 | #1C2B24 | #0F7A55 | #1C2B24 #2F9E44 #1971C2 #E03131 #F08C00 (Black, Green, Blue, Red, Orange) |
| Midnight | dark | #0E1424 | #18213A | #E7EBF5 | #FF7A59 | #E7EBF5 #FF6B8B #7AA2FF #69DB7C #FFD43B (White, Rose, Blue, Green, Yellow) |
| Sakura | light | #FFF5F7 | #F6E1E7 | #2E1F24 | #B0124F | #2E1F24 #E64980 #1971C2 #2F9E44 #F08C00 (Black, Pink, Blue, Green, Orange) |
| High Contrast | light | #FFFFFF | #FFFFFF | #000000 | #0040E0 | #000000 #003A70 #C00000 #006B00 #8A4B00 (Black, Navy, Red, Green, Brown) |
| Clay Dark | dark | #262624 | #30302E | #FAF9F5 | #D97757 | #FAF9F5 #6A9BCC #D4A27F #9AAE76 #C46686 (Ivory, Sky, Kraft, Olive, Fig) |

Clay Dark is the first-launch default. Match system pairs Whiteboard (light) with Clay Dark (dark).

### Named Rules

**The Course Ink Rule.** The course ink marks state and nothing else: selection and handles, the held marker, focus, the current cap or theme, binding targets, the Edited dot, the caret, links and the single primary button. It is never a decoration, an illustration colour, a heading colour or a hover wash.

**The Four Inputs Rule.** A theme is board, tray, ink, course and five caps. Every other UI colour comes out of `deriveTokens()` with its contrast floor (ink-dim 4.6:1 on all four grounds, ink-faint 3:1 for non-text, danger 4.6:1, signal 3.2:1). A new colour need is met by deriving from these, never by hand-picking a hex in a component.

**The No-Course Cap Rule.** No marker cap equals its theme's course ink; each sits at least ΔE 15 away in the same hue family. A stroke in the course colour would look selected and hide the binding highlight. Cap names are unique within a theme and are the same in the tray and the colour panel.

**The Drawn Colour Floor Rule.** Element colours are stored as authored for white paper. Near-white boards (Whiteboard, Sakura, High Contrast) draw them exactly. Tinted and dark boards display them with a floor of 3:1 for strokes and 4.5:1 for text, measured against what actually sits under the element (the topmost solid fill, else the board). Dark boards remap luminance, keeping hue and saturation. Fills are never floored, and an ink lighter than a light board is left as authored.

## Typography

**UI Font:** the system UI stack (`-apple-system`, SF Pro Text on macOS, then Segoe UI and `system-ui`)
**Code Font:** `ui-monospace` / SF Mono (Mermaid source and inline code chips only)
**Canvas Fonts:** Shantell Sans (hand-drawn, the default), Nunito (normal), Cascadia Code (code), plus Georgia (serif) and SF Mono (mono) from the system. The three bundled faces are OFL, loaded from `@fontsource` with unicode-range subsets.

**Character:** One family for all chrome, at small sizes, so the controls feel native and get out of the way; personality lives in the drawing, in the hand-drawn canvas face.

### Hierarchy
- **Title** (600, 15px, 1.35): dialog titles and the theme deck's heading. The largest chrome text.
- **Control** (400, 13px, 1.35): the default for every control, menu item, field, toast and hint.
- **Control Strong** (600, 13px): the document name, the pen-options switch label.
- **Button** (500, 13px): text buttons, including the primary Export.
- **Label** (400, 12px, 1.35): tooltips, kbd chips, slider readouts, drawer tile names, the "Edited" word, deck card names, secondary notes.
- **Label Heading** (600, 12px, ink-dim): small section headers in menus (File, View, Insert, Theme, Help).
- **Code** (400, 12px mono; 13px with 1.5 leading in the Mermaid source field).
- **Canvas text** (20px Medium by default; presets 16, 20, 28, 36): user content only.

### Named Rules

**The Tabular Rule.** All numbers in the chrome are tabular (`font-variant-numeric: tabular-nums` is set on the root): zoom %, coordinates, sizes, angles, counts, slide numbers.

**The Chrome Is Not Hand-Drawn Rule.** The canvas faces never appear in chrome, except as a sample inside the font picker. The system UI stack never appears in drawn content.

## Layout

The board fills the window edge to edge. Chrome floats above it at a 12px gap from every window edge (`--chrome-gap`), on a 4px spacing module (4, 8, 12, 16, 20, 24, 32).

- **Top-left:** the document label chip (menu button, name, Edited dot), at most half the window wide.
- **Top-right:** one chip holding the Search, Library and Theme icon buttons, then Export 4px further on. Below 760px the three icons collapse into one ⋯ menu; Export stays.
- **Bottom-centre:** the tray, 56px tall, 12px from the bottom, centred by auto margins between insets (not a −50% transform, so seams land on whole pixels).
- **Bottom-left / bottom-right:** the ledge end (undo, redo, −, zoom %, +, fit) and the help button, both short ledge pieces (48px tall, centred on the tray's 56px line) with the tray's fill and seams.
- **Above the tray:** the style bar, 8px above it and centred on the same insets as the tray. Above that, the bottom stack (the empty-board hint, contextual hints, the crop and eyedropper bars), then toasts. Each rises with the style bar when it shows.
- **Side sheets** (Library, Find on canvas) dock right, from just below the top actions to just above the bottom stack, 320px wide or the window width minus the gaps.

The tray measures itself (`trayFit`) and publishes `data-tray-layout`: **centre** (wide windows, the tray on the true centre line), **side** (centred between the ledge end and help) or **stacked** (the ledge end and help rise 56px above the tray so the full tray keeps its caps and More). Caps collapse to the current one only when the tray alone cannot fit the window. Below 760px the drawing tools scroll horizontally with snap and 32px edge fades, while More and the current cap stay pinned at the end, and the style bar scrolls the same way. The theme deck shows 5 columns, 3 below 480px.

Dialogs are 480px wide (352px small, 768px large) and at most the window height minus 64px. The main menu is 352px wide.

### Named Rules

**The One Ledge Rule.** Every drawing tool lives in the tray. Nothing else floats near it except the ledge end (left), help (right) and the contextual style bar (above). A new tool goes in the tray or its More drawer, never in a new island.

**The Measured Fit Rule.** Layout changes for the tray are decided by measuring the real widths, not by fixed breakpoints, and caps are the last thing to collapse.

## Elevation & Depth

One elevation step. Anything that floats above the board (tray, ledge end, help, style bar, popovers, menus, dialogs, sheets, toasts, tooltips, pills, the held marker) carries the same single soft shadow. Ledge surfaces add two inset hairlines: a highlight along the top edge and a shadow along the bottom, which is what makes the tray read as an aluminium ledge rather than a floating pill. Chips that sit on the board (document label, top actions, hint) have a hairline seam and no shadow. Nothing is blurred or translucent apart from the hover and press washes and the dialog scrim.

Stacking: canvas 0, chrome 10, style bar 20, popovers and dialogs 100, toasts 900 (dropping to 99 while any popover, menu or dialog is open), tooltips 1000.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 4px 16px -2px rgba(32, 33, 36, 0.16)` on light themes, using the theme's ink; `0 6px 20px -2px rgba(0, 0, 0, 0.5)` on dark): every floating surface and the held marker.
- **Ledge seams** (`box-shadow: inset 0 var(--seam-w) 0 var(--tray-seam-hi), inset 0 calc(var(--seam-w) * -1) 0 var(--tray-seam-lo), var(--shadow-1)`): the tray, the ledge end, the help corner and the slide-show bar.
- **Selection ring** (`box-shadow: 0 0 0 2px <ground>, 0 0 0 4px var(--course)`): the current colour cap, swatch or theme card; the inner gap takes the colour of the ground it sits on (tray or surface).

### Named Rules

**The One Step Rule.** There is one shadow. No second, deeper elevation; no glass, no backdrop blur, no hard offset shadow.

**The Hairline Rule.** Every seam, border and divider is one device pixel (`--seam-w`: 1px, 0.5px at 2× density). High Contrast is the only exception: 2px seams and a 3px focus ring.

## Shapes

Gently rounded rectangles in four tiers, and full circles for anything that is a colour or a status.

- **Small** (6px): text buttons, menu items, inputs, selects, kbd chips, tooltips, segmented tracks, the 28px icon buttons, the theme deck's mini boards.
- **Medium** (10px): markers, 40px icon buttons, popovers, menus, the style bar, the chrome chips, the hint chip, toasts, drawer tiles.
- **Large** (14px): the tray, the ledge end, the help corner, dialogs and side sheets: the largest surfaces get the softest corners.
- **Round** (999px): colour caps and swatches, the Edited dot, pills (Back to content, mode pills), switch tracks and thumbs, the slider thumb.

Icons are one authored SVG set on a 24-unit grid drawn at 20px, round caps and joins, a 2.1-unit stroke that lands at 1.75px. Inside 16px slots (menus, pills) the same icons scale down.

## Components

### Marker Tray (signature)
Character: a ledge of markers you pick up and put down.
- **Structure:** Select and Hand | Rectangle, Diamond, Ellipse, Arrow, Line, Pen, Pencil, Text, Eraser | More | five theme caps and a custom cap. Groups are split by 1-device-pixel seams inset 12px top and bottom; markers sit 4px apart inside 8px side padding.
- **Marker:** 40×40, radius medium, transparent, ink icon at 20px. Hover takes the hover wash; press the press wash; disabled draws the icon in ink-faint.
- **Held marker ("lift the marker"):** course fill, course-ink icon, the float shadow, raised 6px over 160ms on the exponential ease-out, with a 16×2px course bar appearing in the empty slot beneath. Hover and press darken the fill with an inset wash. Under reduced motion there is no translation, only the fill. Its focus ring is drawn inside the fill in course-ink.
- **Badges:** a 12px caret top-right on the held Pen or Pencil says a second click opens its options; a 12px lock top-left says "Keep tool active" is on.
- **Colour caps:** 40px targets with a 24px round chip. The current stroke colour's cap carries the selection ring (2px tray-coloured gap, 2px course). The custom cap is a dashed ink-faint circle that fills with the current colour when it is not one of the five.
- **Labels:** hover or focus shows "Name" plus its key in a tooltip; neighbours stay quiet. The tray is one `role="toolbar"` with roving focus and arrow keys.

### More drawer
Opens upward from More as a 4-column grid of 72×64px tiles: icon, 12px name, key legend top-right. Image, Frame, Embed, Laser / Lasso, Mermaid, Keep tool active. A held drawer tool takes the course fill; Keep tool active takes course-soft.

### Style bar
Character: options that rise only when there is something to style.
- A surface bar with a seam border, medium radius and the float shadow, 4px padding, 40px icon buttons in clusters split by 24px seams. Shown for a non-empty selection or a drawing tool (defaults for the next element); hidden otherwise.
- Previews: stroke colour as a round chip, fill as a small rounded square, transparent as a checkerboard, mixed values as a short ink-dim dash.
- Each button opens a popover upward in a layer above everything (never clipped). Destructive Delete sits last in its More menu after a gap, in danger red.

### Buttons
- **Shape:** small radius (6px), 32px tall, 12px side padding, 13px at weight 500.
- **Primary:** course fill, course-ink text. Only one per screen region: Export in the top-right, the confirming action in a dialog footer.
- **Hover / Press:** an inset ink wash over the fill (6% / 12%), no colour shift. Disabled primary falls back to surface-2 with ink-faint text.
- **Quiet:** transparent with ink text; the hover and press washes are its only states.
- **Danger:** danger-red text, danger-soft background on hover.
- **Icon buttons:** 40px with a medium radius, or 28px with a small radius in dense rows. A pressed toggle takes the course fill.
- **Focus:** a 2px course outline 2px outside (3px in High Contrast); inside a filled control it moves inward and switches to course-ink.

### Chips
- **Chrome chips** (document label, top actions): board fill, hairline seam, medium radius, 4px padding, no shadow, so they hold their own over a drawing without looking lifted.
- **Hint chip:** surface fill, hairline seam, medium radius, ink-dim 13px text, never takes a pointer; it fades out while the selection it describes sits under it.
- **Kbd chips:** surface-2, hairline seam, small radius, 12px ink-dim; outlined in currentColor inside a tooltip.
- **Pills** (Back to content, zen and view-mode exits): surface, seam, full round, float shadow, 32px tall.

### Cards / Containers
- **Popovers and menus:** surface, hairline seam, medium radius, float shadow, 8px padding (4px for menus). They rise 4px into place over 150ms.
- **Dialogs:** surface, seam, large radius, float shadow over the scrim; 15px title head, 20px side padding, a seam above the footer.
- **Side sheets:** surface, seam, large radius, float shadow; slide 8px in from the right over 200ms.
- **Theme deck cards:** a miniature board in the theme's own colours (8:5) with an ink circle, a course-ink rectangle and a tiny tray with its five caps, then the name in 12px. The current card's mini board carries the selection ring and its name goes bold.

### Inputs / Fields
- **Style:** surface fill, 1-device-pixel ink-faint border, small radius, 32px tall (24px in compact rows), 8px padding, 13px tabular text, ink-dim placeholder.
- **Hover:** border darkens to ink-dim. **Focus:** border and outline in course. **Invalid:** danger border and outline, with the error text reserved below so the field never moves. **Disabled:** surface-2 fill, ink-faint text.
- **Segmented controls:** a surface-2 track with 2px padding; the checked segment is a surface tile with a hairline ring. Tracks hug their options.
- **Switches:** a 32×20 rounded track outlined in ink-faint; on, the track fills with ink and the thumb turns surface.

### Menus
- Items 32px tall (24px in the long main menu), small radius, a 20px icon column, label, then the shortcut legend. Hover and keyboard focus share the hover wash.
- Small 12px ink-dim headers divide sections. Destructive items (Reset canvas, Delete, Clear library) sit in their own section after a 16px gap and a seam, in danger red, and confirm before acting.

### Toasts and tooltips
- **Toasts:** ink fill with surface text (inverted), medium radius, float shadow, 8px × 16px padding, bottom-centre above the stack, 3s. Error toasts fill with danger. A toast with an action (Undo) has an outlined button and is the only clickable one.
- **Tooltips:** ink fill, surface text, 12px, small radius, 4px × 8px; one at a time.

## Do's and Don'ts

### Do:
- **Do** read every colour from the theme tokens (`var(--board)`, `var(--ink)`, `var(--course)` and so on); `applyTheme()` swaps them for all eleven themes.
- **Do** spend course ink only on state: selection, the held marker, focus, the current cap or theme, binding targets, the Edited dot, the caret, links and the one primary button.
- **Do** keep every seam one device pixel (`--seam-w`) and every focus ring 2px course with a 2px offset (3px in High Contrast).
- **Do** give anything that floats the one float shadow, and give ledge surfaces the inset highlight and shadow seams as well.
- **Do** size targets at 40px (28px in dense rows), draw icons at 20px with the 1.75 stroke, and space on the 4px module.
- **Do** set every number in tabular figures.
- **Do** put destructive actions last in their menu, after a 16px gap, in danger red, behind a confirmation.
- **Do** keep motion to state changes of 150–250ms on the exponential ease-out, and drop translation entirely under reduced motion.
- **Do** check a new theme with `deriveTokens()` and the theme tests: ink at least 4.5:1 on board and tray, course at least 3:1 on the board, caps unique by name and never equal to the course. On tinted and dark boards the display floor holds caps at 3:1; near-white boards keep the authored palette (Whiteboard's Orange cap draws at 2.4:1, as in Excalidraw).

### Don't:
- **Don't** add a second accent, or use course ink for decoration, illustration, headings or hover.
- **Don't** add a chrome island: no top toolbar, no side properties panel, no extra floating corner widgets. Tools go in the tray or its More drawer.
- **Don't** use signal orange for selection, or course ink for snap guides and search hits.
- **Don't** use glass, backdrop blur, decorative gradients, gradient text or hard offset shadows. (The 32px edge-fade masks on scrolling rows and the checkerboard for transparency are the system's own devices.)
- **Don't** use emoji or unicode characters as icons; key legends inside kbd chips are the only text glyphs in controls.
- **Don't** set chrome in a hand-drawn face, or canvas content in the UI stack.
- **Don't** use ink-faint for text anyone has to read.
- **Don't** edit the icon PNGs by hand: change `app-icon.svg`, re-render it to `app-icon.png` and run `bunx tauri icon src-tauri/app-icon.png` from `apps/desktop`.
