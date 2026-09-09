import { describe, expect, it } from "vitest";
import { createManualNineSliceCandidate, scanNineSliceCandidates } from "./nineSlice";
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
});
