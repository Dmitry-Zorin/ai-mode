# AI Mode

A minimal [Tauri](https://tauri.app/) shell that wraps
[Google AI Mode](https://www.google.com/?udm=50) in a dedicated macOS window —
summon it from anywhere with a global hotkey, with Google's browser chrome
hidden so it feels like a real app rather than a browser tab.

It runs on **WKWebView** (the system WebKit), so the Safari user-agent it
presents is self-consistent — the reason for choosing Tauri over a Chromium
shell: a coherent fingerprint is the best shot at passing Google's
"this browser may not be secure" sign-in gate.

## Architecture

One native window hosts **two tiled child webviews** (Tauri's multi-webview, the
same idea as Electron's `WebContentsView`):

- a thin **header bar** on top — a tiny Vite/TS app that hosts the drag region,
  the back/forward buttons and the zoom controls (`src/`, `index.html`);
- **Google AI Mode** filling the rest, loaded directly from the web.

The traffic lights float over the header via the overlay title-bar style. The
Google page never gets Tauri IPC (Tauri does not inject it into remote pages);
all shortcuts run through **native menu accelerators** in Rust, so they work
regardless of which webview has focus. The header talks to Rust through a few
commands; Rust owns the zoom factor and broadcasts it back for the `%` display.

## Features

- **Open from anywhere** — `Option`+`Space` shows/hides the window globally.
- **Draggable header with native buttons** — the real macOS traffic lights;
  closing (red light) hides the window (the hotkey re-summons), the Dock icon
  re-opens it, and window size/position are remembered.
- **New thread** — `⌘N` starts a fresh AI Mode thread (clicks AI Mode's own
  control; no reload).
- **Browser-like zoom** — `⌘=` / `⌘−` / `⌘0` (or the header controls) use real
  WKWebView page zoom; the level is remembered across launches.
- **Chrome hidden** — Google's top bar and tab strip are hidden via injected
  CSS; sign-in works in-app and cookies persist. Citations open in the system
  browser; everything Google stays inside the app.

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/) (stable) + the macOS toolchain
- [Bun](https://bun.sh/) (or npm)

```bash
bun install             # install JS dependencies
bun run dev:desktop     # launch the app with hot reload
bun run install:desktop # update the installed app: build, replace /Applications/AI Mode.app, relaunch
bun run dist:mac        # build a .dmg for distribution only (does NOT touch /Applications)
```

Closing the window only hides it (so the hotkey can re-summon it); use `⌘Q` to
actually quit.

### Quality

```bash
bun run check      # biome ci . && tsc --noEmit  (lint + typecheck)
bun run format     # biome check --write .        (lint fixes + format)
```

## Where to change behavior

- **Target URL / user agent / window size / shortcuts / menu** —
  `src-tauri/src/lib.rs` (constants at the top, plus `build_menu` and `setup`).
- **Global hotkey** — the `Shortcut::new(Some(Modifiers::ALT), Code::Space)`
  registration in `setup`.
- **Which Google elements are hidden / composer focus / the sign-in passkey
  hack** — `src-tauri/src/inject.js`. These selectors are best-effort and tied
  to Google's current DOM; the `devtools` Cargo feature is on, so right-click →
  Inspect on the Google view to re-tune.
- **Header UI** — `index.html`, `src/header.css`, `src/main.ts`.

## Notes

Google may change its page structure (so the hide-CSS selectors and the
new-thread hook may need updating) or tighten sign-in. The app uses a current
Safari UA on a real WebKit engine to stay on the right side of that gate.
