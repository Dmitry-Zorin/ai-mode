export interface AiModeApi {
  newThread(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  getZoom(): Promise<number>;
  /** Subscribe to zoom changes; returns an unsubscribe function. */
  onZoom(callback: (zoom: number) => void): () => void;
}

declare global {
  interface Window {
    aimode: AiModeApi;
  }
}
