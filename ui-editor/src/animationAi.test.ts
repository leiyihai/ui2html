import { describe, expect, it } from "vitest";
import { buildAnimationManifest, generateLocalAnimationResult } from "./animationAi";
import type { UIScene, UINode } from "./types";

function node(id: string, x: number): UINode {
  return {
    id, name: id, image: null,
    designRect: { x, y: 0, width: 100, height: 40 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: x, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: x,
    adaptation: { mode: "anchor" },
    psd: { layerId: x, originalX: x, originalY: 0, originalWidth: 100, originalHeight: 40 },
  };
}

describe("AI animation pipeline", () => {
  it("builds a scene manifest without canvas or PSD dependencies", () => {
    const scene: UIScene = { designWidth: 800, designHeight: 600, nodes: [node("a", 10)] };
    const manifest = buildAnimationManifest(scene);
    expect(manifest.nodes[0]).toMatchObject({ id: "a", type: "StaticImage", rect: { x: 10 } });
    expect(manifest.effectLibrary.length).toBeGreaterThan(3);
  });

  it("produces a reviewable sequence result from the local fallback", () => {
    const scene: UIScene = { designWidth: 800, designHeight: 600, nodes: [node("a", 10), node("b", 120)] };
    const result = generateLocalAnimationResult(scene, "请让节点依次滑入", []);
    expect(result.provider).toBe("local");
    expect(result.suggestions).toHaveLength(2);
    expect(result.flow?.steps).toHaveLength(2);
    expect(result.suggestions[0].clip.source).toBe("ai");
  });
});

