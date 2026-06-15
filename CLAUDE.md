# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Mode is a thin native macOS app that is just a window pointing at Google AI Mode
(`https://www.google.com/?udm=50`), with a global hotkey to summon it, a spoofed Chrome user agent,
and injected CSS/JS to hide Google's browser chrome so it feels like a dedicated app. There is **no
backend, no database, and no frontend framework** — the whole app is one Rust file plus an injected
script.

The repo started as a copy of the Mason Gallery monorepo; everything else (the React component
library, the web/CLI targets, the entire Rust image/archive/thumbnail backend) has been removed.

## Key Idea: the window IS the webview

Tauri has no Electron-style `<webview>` tag — in Tauri the window is a WKWebView. So instead of a
React app, the main window is built in Rust (`WebviewWindowBuilder`) loading the Google URL directly
via `WebviewUrl::External`. User-agent spoofing (`.user_agent`) and chrome-hiding
(`.initialization_script`) are wired in there. The `static/index.html` page is only a bundler
placeholder for `frontendDist` and is never shown.

## Layout

A single-package workspace (the monorepo wrapper is kept, but only `packages/desktop` remains):

| Path | Purpose |
|------|---------|
| `packages/desktop/src-tauri/src/lib.rs` | The entire app: builds the window, spoofs UA, registers the global hotkey, wires close→hide / Dock-reopen→show |
| `packages/desktop/src-tauri/src/inject.js` | CSS/JS injected at document-start to hide Google's nav/footer (`include_str!` into `lib.rs`) |
| `packages/desktop/src-tauri/src/main.rs` | One-liner calling `ai_mode_lib::run()` |
| `packages/desktop/src-tauri/tauri.conf.json` | Window is NOT defined here (`app.windows: []`); built in Rust. `frontendDist: "../static"` |
| `packages/desktop/static/index.html` | Placeholder for the bundler; never displayed |

## Commands

```bash
bun install                # install dependencies (just @tauri-apps/cli + biome)

bun run dev:desktop        # tauri dev — opens the AI Mode window with hot reload of the Rust side
bun run build:desktop      # gen:icons + tauri build (.app / .dmg)

bun run check              # biome ci .
bun run format             # biome format --write .
```

Desktop builds require Rust and [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).
The app is macOS-focused (uses `macos-private-api` for vibrancy/transparency and the macOS overlay
title bar).

## Where to change behavior

- **Target URL, Chrome UA string, window size/chrome** → constants and the `WebviewWindowBuilder`
  chain in `lib.rs`.
- **Global hotkey** → `Shortcut::new(Some(Modifiers::ALT), Code::Space)` in `lib.rs` (currently
  Option+Space). Registered via `tauri-plugin-global-shortcut`; on macOS this uses Carbon
  `RegisterEventHotKey`, so it needs **no** Accessibility permission.
- **Which Google elements are hidden** → the CSS selector list in `inject.js`. These are best-effort
  and need tuning against the live DOM: run `bun run dev:desktop`, right-click → Inspect (the
  `devtools` Cargo feature is enabled), find the element, add its selector.
- **Window lifecycle** → closing the window hides it (so the hotkey can re-summon); clicking the
  Dock icon re-shows it (`RunEvent::Reopen`); a second launch focuses the existing instance
  (`tauri-plugin-single-instance`); size/position persist via `tauri-plugin-window-state`.

## Rust dependencies

Only four crates: `tauri` (features `macos-private-api`, `devtools`), `tauri-plugin-global-shortcut`,
`tauri-plugin-window-state`, `tauri-plugin-single-instance`.

## Code Style

- **Formatter/Linter (JS/JSON)**: Biome — 2-space indent, double quotes, semicolons. Note Biome's
  `files.includes` only covers `packages/*/src/**`, root `*.ts`, and root `*.json`, so `inject.js`
  (under `src-tauri/src`) and the Tauri config JSON are not linted.
- **Rust**: `cargo fmt` + `cargo clippy -- -D warnings` (both run in CI).

## Caveats

- Google may degrade or block the WKWebView, or require sign-in; the UA spoof mitigates this but
  doesn't guarantee a full experience. Sign-in happens inside the app (WKWebView persists cookies).
- The chrome-hiding selectors are fragile and tied to Google's current DOM.
