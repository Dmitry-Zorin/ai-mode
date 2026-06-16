import { join } from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
  WebContentsView,
} from "electron";
import { type AppState, loadState, saveState } from "./store";

// --- Configuration ----------------------------------------------------------

/** Google AI Mode, loaded into the embedded web view. */
const AI_MODE_URL = "https://www.google.com/?udm=50";

/**
 * Present as desktop Safari/WebKit. AI Mode (udm=50) and Google sign-in are
 * picky about embedded-browser fingerprints; this UA is the one verified to
 * work for the previous build, and it keeps sign-in flowing inside the app.
 */
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

/** Height of the native draggable header bar, in CSS px. Must match header.css. */
const HEADER_HEIGHT = 40;

/** Persistent session so Google cookies / sign-in survive relaunches. */
const PARTITION = "persist:aimode";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/**
 * Hide Google's browser chrome so the window feels like a dedicated app.
 * Injected via webContents.insertCSS, which bypasses the page's CSP and stays
 * applied as Google rehydrates the DOM (CSS rules match new nodes live, so no
 * MutationObserver is needed). Selectors verified against the live AI Mode DOM:
 *   - header:not(#gb)   the top-left Google logo header (keep #gb account bar)
 *   - [role=navigation] the "AI Mode / All / Images / ..." vertical tab strip
 *   - .sfbg             a leftover top spacer
 */
const HIDE_CSS = `
  header:not(#gb), [role="navigation"], .sfbg { display: none !important; }
  main { scroll-padding-top: 96px !important; }
  [data-xid='aim-mars-turn-root']:first-of-type { scroll-margin-top: 96px !important; }
`;

/** Focus the single visible composer textarea and drop the caret at the end. */
const FOCUS_COMPOSER_JS = `(() => {
  for (const ta of document.querySelectorAll("textarea")) {
    if (ta.offsetParent !== null) {
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
      return true;
    }
  }
  return false;
})();`;

/** Click AI Mode's own "New thread" button; fall back to a fresh page load. */
const NEW_THREAD_JS = `(() => {
  const sel = 'button[aria-label], button[title], [role="button"][aria-label], [role="button"][title]';
  for (const node of document.querySelectorAll(sel)) {
    if (node.offsetParent === null) continue;
    const label = (node.getAttribute("aria-label") || node.getAttribute("title") || "").trim().toLowerCase();
    if (label === "new thread") { node.click(); return true; }
  }
  location.assign(${JSON.stringify(AI_MODE_URL)});
  return false;
})();`;

// --- State -------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let googleView: WebContentsView | null = null;
let state: AppState;
let isQuitting = false;

// --- Window ------------------------------------------------------------------

function isOnScreen(b: AppState["bounds"]): boolean {
  const { x, y, width, height } = b;
  if (x === undefined || y === undefined) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      x < a.x + a.width &&
      x + width > a.x &&
      y < a.y + a.height &&
      y + height > a.y
    );
  });
}

function createWindow(): void {
  const { bounds } = state;
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(isOnScreen(bounds) ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 420,
    minHeight: 480,
    title: "AI Mode",
    backgroundColor: "#131314",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 12 },
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
    },
  });

  // The header bar is the window's own web contents (only the top HEADER_HEIGHT
  // is visible; the rest is covered by the Google view below).
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Google AI Mode lives in a WebContentsView layered below the header.
  googleView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
    },
  });
  mainWindow.contentView.addChildView(googleView);

  const wc = googleView.webContents;
  wc.setUserAgent(SAFARI_UA);
  wc.loadURL(AI_MODE_URL, { userAgent: SAFARI_UA });

  wc.on("dom-ready", () => {
    wc.insertCSS(HIDE_CSS);
    applyZoom();
    focusComposer();
  });

  // External (non-Google) links — e.g. source citations — open in the system
  // browser; Google URLs (incl. sign-in) stay inside the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (isGoogle(url)) {
      wc.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  layout();
  mainWindow.on("resize", () => {
    layout();
    rememberBounds();
  });
  mainWindow.on("move", rememberBounds);

  // Closing the window hides it so the global hotkey can re-summon it; the app
  // keeps running in the background. A real quit (Cmd+Q) sets isQuitting first.
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("focus", focusComposer);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
}

function layout(): void {
  if (!mainWindow || !googleView) return;
  const { width, height } = mainWindow.getContentBounds();
  googleView.setBounds({
    x: 0,
    y: HEADER_HEIGHT,
    width,
    height: Math.max(0, height - HEADER_HEIGHT),
  });
}

function rememberBounds(): void {
  if (!mainWindow) return;
  state.bounds = mainWindow.getBounds();
  saveState(state);
}

// --- Actions -----------------------------------------------------------------

function applyZoom(): void {
  googleView?.webContents.setZoomFactor(state.zoom);
}

function setZoom(next: number): void {
  const clamped = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round(next * 100) / 100),
  );
  if (clamped === state.zoom) return;
  state.zoom = clamped;
  applyZoom();
  saveState(state);
  mainWindow?.webContents.send("aimode:zoom", state.zoom);
}

function zoomIn(): void {
  setZoom(state.zoom + ZOOM_STEP);
}

function zoomOut(): void {
  setZoom(state.zoom - ZOOM_STEP);
}

function zoomReset(): void {
  setZoom(1);
}

function newThread(): void {
  googleView?.webContents.executeJavaScript(NEW_THREAD_JS).catch(() => {});
}

function focusComposer(): void {
  const wc = googleView?.webContents;
  if (!wc) return;
  wc.focus();
  wc.executeJavaScript(FOCUS_COMPOSER_JS).catch(() => {});
}

function isGoogle(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("google.com");
  } catch {
    return false;
  }
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  app.focus({ steal: true });
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// --- Menu (accelerators) -----------------------------------------------------

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Thread", accelerator: "CmdOrCtrl+N", click: newThread },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: zoomIn },
        // Also catch Cmd+Shift+= (the "+" key) for zoom in.
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          visible: false,
          click: zoomIn,
        },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: zoomOut },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: zoomReset },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => googleView?.webContents.reload(),
        },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
          click: () => googleView?.webContents.toggleDevTools(),
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- App lifecycle -----------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    state = loadState();
    // AI Mode's UI is dark; force a dark page render so the header matches.
    nativeTheme.themeSource = "dark";

    ipcMain.on("aimode:new-thread", newThread);
    ipcMain.on("aimode:zoom-in", zoomIn);
    ipcMain.on("aimode:zoom-out", zoomOut);
    ipcMain.on("aimode:zoom-reset", zoomReset);
    ipcMain.handle("aimode:get-zoom", () => state.zoom);

    buildMenu();
    createWindow();

    // Open AI Mode from anywhere.
    globalShortcut.register("Alt+Space", toggleWindow);

    // Dock click re-shows the hidden window (macOS).
    app.on("activate", showWindow);
  });

  // Keep running when the window is closed (it only hides) so the hotkey works.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
