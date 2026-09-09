import { describe, expect, it } from "vitest";
import { findSceneBackgroundNode } from "./sceneBackground";
import type { UINode } from "./types";

function imageNode(id: string, zIndex: number, width: number, height: number): UINode {
  return {
    id, name: id, image: { width, height } as HTMLCanvasElement,
    designRect: { x: 0, y: 0, width, height },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex,
    adaptation: { mode: "anchor" },
    psd: { layerId: zIndex, originalX: 0, originalY: 0, originalWidth: width, originalHeight: height },
  };
}

describe("scene background detection", () => {
  it("selects the lowest root-level image that covers most of the canvas", () => {
    const background = imageNode("background", 1, 1280, 720);
    const panel = imageNode("panel", 2, 1000, 500);
    expect(findSceneBackgroundNode({ designWidth: 1280, designHeight: 720, nodes: [panel, background] })).toBe(background);
  });

  it("does not recurse into a control folder and mistake its panel image for the scene background", () => {
    const panel = imageNode("panel", 1, 1280, 720);
    const folder: UINode = {
      ...imageNode("layout_panel", 2, 1000, 500), image: null,
      children: [panel], ctrl: { type: "Layout" },
    };
    expect(findSceneBackgroundNode({ designWidth: 1280, designHeight: 720, nodes: [folder] })).toBeNull();
  });
});
