// The header bar's only job: forward button clicks to Rust (which acts on the
// Google webview) and display the current zoom level. Zoom is owned by Rust, so
// the % is whatever the backend last broadcast -- it stays correct whether the
// change came from a button here or a menu accelerator (Cmd +/−/0).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function renderZoom(zoom: number): void {
  el("zoom-level").textContent = `${Math.round(zoom * 100)}%`;
}

el("zoom-in").addEventListener("click", () => invoke("zoom_in"));
el("zoom-out").addEventListener("click", () => invoke("zoom_out"));
el("zoom-level").addEventListener("click", () => invoke("zoom_reset"));
el("go-back").addEventListener("click", () => invoke("go_back"));
el("go-forward").addEventListener("click", () => invoke("go_forward"));
el("send-template").addEventListener("click", () => invoke("send_template"));

invoke<number>("get_zoom").then(renderZoom);
listen<number>("zoom", (event) => renderZoom(event.payload));
