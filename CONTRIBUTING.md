# Contributing to Nib

Thanks for your interest in Nib. Bug reports, ideas and pull requests are all
welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs:** search the [issues](https://github.com/cyber-eternal/nib/issues)
  first, then open one with the bug report template.
- **Features:** open a feature request before writing a large change, so we can
  agree on the approach. [docs/ROADMAP.md](docs/ROADMAP.md) lists what is
  already planned. Real-time collaboration is out of scope.
- **Security issues:** do not open a public issue; see [SECURITY.md](SECURITY.md).

## Development setup

You need [Bun](https://bun.sh). The desktop app also needs Rust (stable) and
the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/): Xcode
command line tools on macOS, WebKitGTK on Linux.

```bash
git clone https://github.com/cyber-eternal/nib.git
cd nib
bun install
bun run dev        # browser build with live reload at http://127.0.0.1:1420
bun run desktop    # the desktop app against the same dev server
```

## Project layout

```
packages/core       model, geometry, rendering, tools, history, file formats; no DOM
packages/editor     React UI: shell, marker tray, style bar, panels, dialogs, export, themes
packages/platform   the interface the editor needs from its host, plus the browser host
apps/desktop        Tauri 2 shell (Rust), native menus, Linux packaging, the web build's PWA
```

Keep logic in `packages/core` where you can: it has no DOM and is tested in
Node. The UI only talks to `EditorCore`, and anything host-specific (files,
dialogs, menus, storage) goes through the `Platform` interface.

Open drawings are tabs: each one is an `EditorCore` and a `DocumentController`,
owned by the `TabsController` (`packages/editor/src/document/tabs.ts`), which the
UI shows one at a time. The desktop shell (`apps/desktop/src-tauri/src`) keeps
what must survive the page: `session.rs` plans which tabs reopen at launch and
writes the session the page reports. Keep that logic in pure functions with
tests, and keep shell-owned files (the session, recent list, prefs mirror) out
of reach of the `appdata_*` commands.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
bun run lint        # Biome lint and format check (bun run lint:fix applies fixes)
bun run typecheck   # tsc --noEmit for every package
bun run test        # Vitest for core, platform and editor

cd apps/desktop/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib
```

CI also runs the web build (`bun run --cwd apps/desktop build`).

Tests live in `packages/*/test/`, grouped by area (for example
`packages/core/test/editor/` or `packages/editor/test/ui/`). Add or update a
test with every behaviour change and bug fix, and name it after the behaviour
it checks.

## Code style

- Biome formats and lints TypeScript; `rustfmt` and `clippy` cover Rust.
- Comments explain **why**, not what. Write one only when the reason is not
  visible in the code: a workaround, a non-obvious constraint, a deliberate
  trade-off. Keep it to a line or two.
- Prefer small, focused changes. Don't reformat or rename code you are not
  otherwise touching.
- UI changes follow [DESIGN.md](DESIGN.md): use the theme tokens, keep every
  control reachable by keyboard, and check light and dark themes.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.
Scopes are usually a package or area, for example `fix(core): keep bound text
centred after a flip` or `feat(editor): add a recent colours row`.

## Pull request checklist

- [ ] The change is focused, and the PR description says what changed and why.
- [ ] `bun run lint`, `bun run typecheck` and `bun run test` pass.
- [ ] `cargo fmt --check`, `cargo clippy` and `cargo test` pass if Rust changed.
- [ ] Tests cover the new behaviour or the fixed bug.
- [ ] UI changes were checked in a light and a dark theme, by keyboard, and
      include a screenshot.
- [ ] Docs (README, docs/FEATURES.md, DESIGN.md) are updated if behaviour changed.
- [ ] Commits follow Conventional Commits.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
