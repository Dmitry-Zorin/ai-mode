import { contextBridge, ipcRenderer } from "electron";

// Bridge exposed to the header renderer only. The header drives the same
// actions the menu accelerators do (new thread, zoom) and reflects the current
// zoom level. Google AI Mode runs in a separate WebContentsView and never sees
// this API.
const api = {
  newThread: (): void => ipcRenderer.send("aimode:new-thread"),
  zoomIn: (): void => ipcRenderer.send("aimode:zoom-in"),
  zoomOut: (): void => ipcRenderer.send("aimode:zoom-out"),
  zoomReset: (): void => ipcRenderer.send("aimode:zoom-reset"),
  getZoom: (): Promise<number> => ipcRenderer.invoke("aimode:get-zoom"),
  onZoom: (callback: (zoom: number) => void): (() => void) => {
    const listener = (_event: unknown, zoom: number): void => callback(zoom);
    ipcRenderer.on("aimode:zoom", listener);
    return () => ipcRenderer.removeListener("aimode:zoom", listener);
  },
};

contextBridge.exposeInMainWorld("aimode", api);
