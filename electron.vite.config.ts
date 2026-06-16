import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Three build targets: the main process, the header preload, and the renderer
// (the draggable header bar). Google AI Mode itself is loaded into a
// WebContentsView from the main process and needs no preload — chrome-hiding,
// focus and "new thread" are driven from main via insertCSS/executeJavaScript.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
