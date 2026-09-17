import { describe, expect, it } from "vitest";
import { createManualNineSliceCandidate, generateNineSliceImage, parseBulkMargins, rankNineSliceEntries, retainKnownNineSliceSelection, scanNineSliceCandidates } from "./nineSlice";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NineSliceImageCard } from "./components/SlicePanel";
import type { UIScene, UINode } from "./types";

function image(width: number, height: number, key = "solid"): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 80; data[i + 1] = 120; data[i + 2] = 160; data[i + 3] = 255; }
  return {
    width, height,
    toDataURL: () => `data:image/png;base64,${key}-${width}x${height}`,
    getContext: () => ({ getImageData: () => ({ data, width, height }) }),
  } as unknown as HTMLCanvasElement;
}

function cropPixels(data: Uint8ClampedArray, sourceWidth: number, left: number, top: number, width: number, height: number): Uint8ClampedArray {
  const cropped = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceOffset = ((top + y) * sourceWidth + left + x) * 4;
      const targetOffset = (y * width + x) * 4;
      cropped.set(data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return cropped;
}

function node(id: string, name: string, canvas: HTMLCanvasElement): UINode {
  return {
    id, name, image: canvas,
    designRect: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
    adaptation: { mode: "anchor" },
    psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: canvas.width, originalHeight: canvas.height },
  };
}

describe("nine-slice candidate scanning", () => {
  it("keeps a meaningful center area for a non-solid gradient", () => {
    const width = 100;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const value = 100 + Math.round(x / width * 20);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
    const sourceContext = { getImageData: (left: number, top: number, cropWidth: number, cropHeight: number) => ({ data: cropPixels(data, width, left, top, cropWidth, cropHeight), width: cropWidth, height: cropHeight }) };
    const outputContext = { drawImage: () => undefined };
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => outputContext }) } as unknown as Document;
    try {
      const generated = generateNineSliceImage({ width, height, getContext: () => sourceContext } as unknown as HTMLCanvasElement, { left: 10, top: 8, right: 10, bottom: 8 });
      expect(generated?.width).toBeGreaterThan(1 + 10 + 10);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it("keeps a short vertical gradient transition from collapsing into a line", () => {
    const width = 296;
    const height = 404;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const value = y < 50 ? 16 : 26 + Math.round((y - 50) / (height - 50) * 40);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value + 2;
      data[offset + 2] = value + 5;
      data[offset + 3] = 255;
    }
    const sourceContext = { getImageData: (left: number, top: number, cropWidth: number, cropHeight: number) => ({ data: cropPixels(data, width, left, top, cropWidth, cropHeight), width: cropWidth, height: cropHeight }) };
    const outputContext = { drawImage: () => undefined };
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => outputContext }) } as unknown as Document;
    try {
      const generated = generateNineSliceImage({ width, height, getContext: () => sourceContext } as unknown as HTMLCanvasElement, { left: 44, top: 44, right: 44, bottom: 44 });
      expect(generated?.width).toBe(140);
      expect(generated?.height).toBeGreaterThanOrEqual(240);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it("retains a selected processed image when returning from results", () => {
    const processed = node("processed", "panel_done", image(40, 20));
    expect(retainKnownNineSliceSelection(["processed"], [{ node: processed, image: processed.image!, assetKey: "processed", signature: "processed" }])).toEqual(["processed"]);
  });

  it("uses the candidate card presentation for handled images", () => {
    const panel = node("panel", "img_panel_background", image(80, 40, "panel"));
    const entry = { node: panel, image: panel.image!, assetKey: "panel", signature: "panel" };
    const markup = renderToStaticMarkup(createElement(NineSliceImageCard, { entry, handledStatus: "已跳过" }));
    expect(markup).toContain("slice-candidate-image");
    expect(markup).toContain("<img");
    expect(markup).toContain("已跳过");
  });

  it("parses bulk margins in top-bottom-left-right order", () => {
    expect(parseBulkMargins("2,3,4,1", 100, 80)).toEqual({ left: 4, top: 2, right: 1, bottom: 3 });
    expect(parseBulkMargins("4", 100, 80)).toEqual({ left: 4, top: 4, right: 4, bottom: 4 });
    expect(parseBulkMargins("2， 3，4，1", 100, 80)).toEqual({ left: 4, top: 2, right: 1, bottom: 3 });
    expect(parseBulkMargins("2,3", 100, 80)).toBeNull();
    expect(parseBulkMargins("60,30,20,20", 100, 80)).toBeNull();
  });
  it("groups same visual content at different sizes and selects the largest source", () => {
    const small = node("small", "panel_small", image(40, 20));
    const large = node("large", "panel_large", image(80, 40));
    const scene: UIScene = { designWidth: 100, designHeight: 100, nodes: [small, large] };
    const candidates = scanNineSliceCandidates(scene);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].memberNodeIds).toEqual(["large", "small"]);
    expect(candidates[0].sourceNodeId).toBe("large");
    expect(candidates[0].status).toBe("suggested");
  });

  it("allows manual grouping even when the images are not visually identical", () => {
    const first = node("a", "icon_a", image(32, 32, "a"));
    const second = node("b", "icon_b", image(64, 64, "b"));
    const candidate = createManualNineSliceCandidate([
      { node: first, image: first.image!, assetKey: "a", signature: "a" },
      { node: second, image: second.image!, assetKey: "b", signature: "b" },
    ]);
    expect(candidate.memberNodeIds).toEqual(["a", "b"]);
    expect(candidate.sourceNodeId).toBe("b");
    expect(candidate.confidence).toBe(1);
  });

  it("orders candidate thumbnails by stretch confidence and then name relevance", () => {
    const panel = node("panel", "img_panel_background", image(80, 40, "panel"));
    const icon = node("icon", "img_icon_star", image(256, 256, "icon"));
    const entries = [
      { node: icon, image: icon.image!, assetKey: "icon", signature: "icon" },
      { node: panel, image: panel.image!, assetKey: "panel", signature: "panel" },
    ];
    const candidates = [{
      id: "panel", memberNodeIds: ["panel"], sourceNodeId: "panel", sourceAssetKey: "panel",
      suggestedMargins: { left: 8, top: 8, right: 8, bottom: 8 }, confidence: 0.82,
      reason: "panel", status: "suggested" as const, signature: "panel",
    }];

    expect(rankNineSliceEntries(entries, candidates).map((entry) => entry.node.id)).toEqual(["panel", "icon"]);
  });
});
