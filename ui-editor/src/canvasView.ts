export const CANVAS_ZOOM_MIN = 0.25;
export const CANVAS_ZOOM_MAX = 4;

export type CanvasPoint = { x: number; y: number };
export type CanvasRect = { x: number; y: number; width: number; height: number };
export type CanvasHitCandidate = { visible: boolean; node: { zIndex: number }; rect: CanvasRect };

export function defaultPreviewView(): { zoom: number; pan: CanvasPoint } {
  return { zoom: 1, pan: { x: 0, y: 0 } };
}

export function previewCanvasSizeForWrap(
  wrapWidth: number,
  wrapHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  showDeviceShell: boolean,
): { width: number; height: number; scale: number } {
  const deviceShellAllowance = showDeviceShell ? 56 : 0;
  const scale = Math.min(
    Math.max(1, wrapWidth - deviceShellAllowance) / viewportWidth,
    Math.max(1, wrapHeight - deviceShellAllowance) / viewportHeight,
  ) * 0.9;
  return {
    width: viewportWidth * scale,
    height: viewportHeight * scale,
    scale,
  };
}

/** Find the topmost visible node under a logical canvas point. */
export function findCanvasHit<T extends CanvasHitCandidate>(nodes: readonly T[], point: CanvasPoint): T | null {
  return [...nodes]
    .sort((a, b) => b.node.zIndex - a.node.zIndex)
    .find((candidate) => candidate.visible
      && point.x >= candidate.rect.x && point.x <= candidate.rect.x + candidate.rect.width
      && point.y >= candidate.rect.y && point.y <= candidate.rect.y + candidate.rect.height) ?? null;
}

export function clampCanvasZoom(value: number): number {
  return Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, value));
}

/**
 * Keep the point under the cursor stationary while the canvas is zoomed.
 * `pan` is measured in CSS pixels from the canvas' untransformed center.
 */
export function panForZoomAtPoint(
  pan: { x: number; y: number },
  currentZoom: number,
  nextZoom: number,
  point: { x: number; y: number },
  center: { x: number; y: number },
): { x: number; y: number } {
  const safeZoom = Math.max(0.0001, currentZoom);
  const localX = (point.x - center.x - pan.x) / safeZoom;
  const localY = (point.y - center.y - pan.y) / safeZoom;
  return {
    x: point.x - center.x - localX * nextZoom,
    y: point.y - center.y - localY * nextZoom,
  };
}
