// The header bar's only job is to forward button clicks to the main process
// (which acts on the Google web view) and to display the current zoom level.

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function renderZoom(zoom: number): void {
  el("zoom-level").textContent = `${Math.round(zoom * 100)}%`;
}

el("new-thread").addEventListener("click", () => window.aimode.newThread());
el("zoom-in").addEventListener("click", () => window.aimode.zoomIn());
el("zoom-out").addEventListener("click", () => window.aimode.zoomOut());
el("zoom-level").addEventListener("click", () => window.aimode.zoomReset());

window.aimode.getZoom().then(renderZoom);
window.aimode.onZoom(renderZoom);
