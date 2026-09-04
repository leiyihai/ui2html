import { describe, expect, it } from "vitest";
import { prepareSceneAssets, sanitizeAssetBase } from "./projectAssets";
import type { UINode } from "./types";

function imageNode(id: string, name: string, png: string): UINode {
  const image = { toDataURL: () => png } as HTMLCanvasElement;
  return {
    id,
    name,
    image,
    designRect: { x: 0, y: 0, width: 10, height: 10 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex: 0,
    adaptation: { mode: "anchor" },
    psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 10, originalHeight: 10 },
  };
}

describe("project assets", () => {
  it("cleans invalid Windows filename characters", () => {
    expect(sanitizeAssetBase('按钮<>:"/\\|?*.png')).toBe("按钮_________");
    expect(sanitizeAssetBase("... ")).toBe("image");
  });

  it("deduplicates exact image content and keeps different content separate", () => {
    const first = imageNode("a", "按钮", "data:image/png;base64,AAA");
    const duplicate = imageNode("b", "按钮副本", "data:image/png;base64,AAA");
    const conflict = imageNode("c", "按钮", "data:image/png;base64,BBB");

    const prepared = prepareSceneAssets({ designWidth: 100, designHeight: 100, nodes: [first, duplicate, conflict] });

    expect(prepared.scene.nodes.map((node) => node.assetPath)).toEqual(["按钮.png", "按钮.png", "按钮_2.png"]);
    expect(Object.keys(prepared.assets)).toEqual(["按钮.png", "按钮_2.png"]);
  });
});
