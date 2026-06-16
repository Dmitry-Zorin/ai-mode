import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

// Tiny JSON-on-disk store for the things that should survive a relaunch: the
// window's bounds and the current zoom factor. Kept dependency-free on purpose
// (the whole app is meant to stay thin).

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface AppState {
  bounds: WindowBounds;
  zoom: number;
}

const DEFAULTS: AppState = {
  bounds: { width: 980, height: 760 },
  zoom: 1,
};

function file(): string {
  return join(app.getPath("userData"), "state.json");
}

export function loadState(): AppState {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<AppState>;
    return {
      bounds: { ...DEFAULTS.bounds, ...raw.bounds },
      zoom: typeof raw.zoom === "number" ? raw.zoom : DEFAULTS.zoom,
    };
  } catch {
    return { bounds: { ...DEFAULTS.bounds }, zoom: DEFAULTS.zoom };
  }
}

let writeTimer: NodeJS.Timeout | null = null;

// Debounced so dragging/resizing doesn't hammer the disk.
export function saveState(state: AppState): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      writeFileSync(file(), JSON.stringify(state, null, 2));
    } catch {
      // Best effort; losing window state is harmless.
    }
  }, 300);
}
