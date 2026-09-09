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

  it("stores a confirmed nine-slice source under the project 9 folder", () => {
    const panel = imageNode("panel", "panel_background", "data:image/png;base64,PANEL");
    const prepared = prepareSceneAssets({
      designWidth: 100, designHeight: 100, nodes: [panel],
      nineSliceGroups: [{
        id: "slice-panel", memberNodeIds: ["panel"], sourceNodeId: "panel", sourceAssetKey: "panel-key",
        margins: { left: 4, top: 4, right: 4, bottom: 4 },
      }],
    });
    expect(prepared.scene.nineSliceGroups?.[0].sourceAssetPath).toBe("9/panel_background.png");
    expect(prepared.scene.nodes[0].nineSliceGroupId).toBe("slice-panel");
    expect(prepared.scene.nodes[0].sliceImage).toBe(panel.image);
    expect(Object.keys(prepared.assets)).toEqual(["panel_background.png", "9/panel_background.png"]);
  });
});
