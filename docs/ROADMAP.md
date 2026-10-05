# Roadmap

Planned work and open ideas, in no particular order. Nothing here is scheduled
or promised. Issues and pull requests for any of it are welcome.

## Desktop

- [ ] Apple signing, notarisation and the update feed (see
      [apps/desktop/RELEASING.md](../apps/desktop/RELEASING.md)).

## Linux

- [ ] Test WebKitGTK differences on real desktops: canvas speed, pinch zoom,
      the NVIDIA DMA-BUF issue, GNOME and KDE dark mode.
- [ ] Flatpak and Snap packages. Today only the AppImage can update itself.

## Editor

- [ ] Translations (there is no message catalogue yet).
- [ ] More real pencil recordings (trackpad, Apple Pencil) in
      `packages/core/test/fixtures/pencil/user/` to tune shape recognition.
- [ ] The hex colour field can reopen one unit off on dark themes.
- [ ] Decide whether drawn colours must meet AA: the orange cap is about 2.4:1
      on Whiteboard and Sakura.

## Out of scope

- Real-time collaboration.
