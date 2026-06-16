# AI Mode

A minimal [Electron](https://www.electronjs.org/) shell that wraps
[Google AI Mode](https://www.google.com/?udm=50) in a dedicated macOS window —
summon it from anywhere with a global hotkey, with Google's browser chrome
hidden so it feels like a real app rather than a browser tab.

There is no backend and no UI framework. The app is a `BrowserWindow` whose own
web contents render a thin **native draggable header** (traffic lights inset via
`titleBarStyle: "hidden"`), with Google AI Mode loaded into a `WebContentsView`
layered below it.

## Features

- **Open from anywhere** — `Option`+`Space` shows/hides the window globally.
- **Native header** — a draggable title bar with the real macOS traffic-light
  buttons; close hides the window (the hotkey re-summons), the Dock icon
  re-opens it, and window size/position are remembered.
- **New thread** — `⌘N` (or the `+` button) starts a fresh AI Mode thread.
- **Browser zoom** — `⌘=` / `⌘−` / `⌘0` (or the header controls) use real
  Chromium zoom; the level is remembered.
- **Chrome hidden** — Google's top bar and tab strip are hidden via injected
  CSS; sign-in works in-app (cookies persist via a dedicated session).

## Development

### Prerequisites

- [Bun](https://bun.sh/) (or npm)
- Node.js 18+

```bash
bun install        # install dependencies
bun run dev        # launch with hot reload
bun run build      # type-check + bundle to out/
bun run dist:mac   # build an unsigned .dmg (electron-builder)
```

### Quality

```bash
bun run check      # biome ci .
bun run format     # biome check --write .
bun run typecheck  # tsc on main/preload and renderer
```

## Where to change behavior

All of it lives in `src/main/index.ts` (constants at the top):

- **Target URL / user agent / window size** — `AI_MODE_URL`, `SAFARI_UA`, and
  the `BrowserWindow` options in `createWindow`.
- **Global hotkey** — the `globalShortcut.register("Alt+Space", ...)` call.
- **Keyboard shortcuts** (new thread, zoom) — the application menu in
  `buildMenu`.
- **Which Google elements are hidden** — the `HIDE_CSS` selector list. These
  are best-effort and tied to Google's current DOM; with `bun run dev`, open the
  web view's dev tools (View → Toggle Developer Tools) to re-tune.

The header bar lives in `src/renderer/` and talks to the main process through
the bridge in `src/preload/index.ts`.

## Notes

Google may change its page structure (so the hide-CSS selectors may need
updating) or require sign-in, which is handled inside the app.
