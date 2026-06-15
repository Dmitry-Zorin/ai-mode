# AI Mode

A thin native macOS app that wraps [Google AI Mode](https://www.google.com/?udm=50) in a dedicated
window — summon it from anywhere with a global hotkey, with Google's browser chrome hidden so it
feels like a real app rather than a browser tab.

It's a minimal [Tauri](https://v2.tauri.app/) shell: no backend, no database, no frontend framework.
The window is a WKWebView pointed straight at Google, with a spoofed Chrome user agent and a small
injected stylesheet. The whole app is essentially one Rust file (`packages/desktop/src-tauri/src/lib.rs`)
plus an injected script (`inject.js`).

## Features

- **Global hotkey** — Option+Space shows/hides the window from any app.
- **Feels native** — closing the window hides it (the hotkey re-summons); the Dock icon re-opens it;
  window size/position are remembered.
- **Chrome hidden** — Google's top bar and footer are hidden via injected CSS.

## Development

### Prerequisites

- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
bun install
bun run dev:desktop     # run with hot reload
bun run build:desktop   # produce a .app / .dmg
```

### Quality

```bash
bun run check     # biome ci .
bun run format    # biome format --write .
```

## Customizing

- **URL / user agent / window** — edit the constants and `WebviewWindowBuilder` chain in
  `packages/desktop/src-tauri/src/lib.rs`.
- **Hotkey** — change the `Shortcut::new(...)` line in the same file.
- **What gets hidden** — tune the selector list in `packages/desktop/src-tauri/src/inject.js`
  (run dev, right-click → Inspect to find selectors).

## Notes

Google may require sign-in (handled inside the app — cookies persist) and can change its page
structure, in which case the hide-CSS selectors may need updating.
