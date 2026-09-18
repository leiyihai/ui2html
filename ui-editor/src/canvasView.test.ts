import { describe, expect, it } from "vitest";
import { clampCanvasZoom, defaultPreviewView, findCanvasHit, panForZoomAtPoint, previewCanvasSizeForWrap } from "./canvasView";

describe("canvas view transform", () => {
  it("clamps editor zoom to a usable range", () => {
    expect(clampCanvasZoom(0.01)).toBe(0.25);
    expect(clampCanvasZoom(2)).toBe(2);
    expect(clampCanvasZoom(8)).toBe(4);
  });

  it("keeps the cursor point fixed when zooming", () => {
    const pan = panForZoomAtPoint({ x: 10, y: -5 }, 1, 2, { x: 210, y: 95 }, { x: 100, y: 100 });
    const local = { x: (210 - 100 - 10) / 1, y: (95 - 100 + 5) / 1 };
    expect({ x: 100 + pan.x + local.x * 2, y: 100 + pan.y + local.y * 2 }).toEqual({ x: 210, y: 95 });
  });

  it("resets preview mode changes to a centered full-view state", () => {
    expect(defaultPreviewView()).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });

  it("fits the preview canvas to the active mode's available area", () => {
    const wide = previewCanvasSizeForWrap(1900, 840, 1280, 720, false);
    const edit = previewCanvasSizeForWrap(1160, 840, 1280, 720, false);

    expect(edit.width).toBeLessThan(wide.width);
    expect(edit.width).toBeLessThanOrEqual(1160);
    expect(edit.height).toBeLessThanOrEqual(840);
  });

  it("treats an empty canvas area as a miss", () => {
    const nodes = [{ id: "panel", visible: true, node: { zIndex: 1 }, rect: { x: 100, y: 100, width: 40, height: 40 } }];
    expect(findCanvasHit(nodes, { x: 10, y: 10 })).toBeNull();
  });

  it("returns the topmost visible node under the pointer", () => {
    const nodes = [
      { id: "back", visible: true, node: { zIndex: 1 }, rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "hidden", visible: false, node: { zIndex: 3 }, rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "front", visible: true, node: { zIndex: 2 }, rect: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(findCanvasHit(nodes, { x: 50, y: 50 })?.id).toBe("front");
  });
});
