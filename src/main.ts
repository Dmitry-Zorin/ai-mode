// The header bar's only job: forward button clicks to Rust (which acts on the
// Google webview) and display the current zoom level. Zoom is owned by Rust, so
// the % is whatever the backend last broadcast -- it stays correct whether the
// change came from a button here or a menu accelerator (Cmd +/−/0).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

function renderZoom(zoom: number): void {
  const pct = `${Math.round(zoom * 100)}%`;
  const zoomLevel = el("zoom-level");
  zoomLevel.textContent = pct;
  // Convey both the live value and the reset action to assistive tech -- a
  // static aria-label would otherwise hide the percentage the button shows.
  zoomLevel.setAttribute("aria-label", `Zoom ${pct}, activate to reset`);
}

// Every header button carries data-invoke="<rust_command>" (see index.html);
// one delegated listener forwards the click, so adding a button needs no wiring
// here.
el("bar").addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>(
    "[data-invoke]",
  );
  if (button?.dataset.invoke) invoke(button.dataset.invoke);
});

invoke<number>("get_zoom").then(renderZoom);
listen<number>("zoom", (event) => renderZoom(event.payload));
