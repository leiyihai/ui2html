import { describe, expect, it } from "vitest";
import { LayoutEngine } from "./layoutEngine";
import type { LayoutContext, UINode } from "./types";

const context: LayoutContext = {
  designWidth: 640,
  designHeight: 360,
  viewportWidth: 640,
  viewportHeight: 360,
  safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
  scaleMode: "contain",
};

function node(id: string, name: string, children?: UINode[]): UINode {
  return {
    id,
    name,
    image: null,
    ...(children ? { children, ctrl: { type: "Layout" } } : { ctrl: { type: "StaticImage" } }),
    designRect: { x: 0, y: 0, width: 80, height: 40 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex: 1,
    adaptation: { mode: "anchor" },
    psd: { layerId: -1, originalX: 0, originalY: 0, originalWidth: 80, originalHeight: 40 },
  };
}

describe("list item preview layout", () => {
  it("repeats every descendant of a nested preview item", () => {
    const item = node("item", "列表项", [node("item-bg", "背景"), node("item-label", "文字")]);
    const nestedContainer = node("slot", "插槽", [item]);
    const list = node("list", "列表", [nestedContainer]);
    list.list = {
      type: "horizontal",
      spacing: 10,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      columns: 1,
      previewItemId: "item",
      previewItemCount: 3,
    };

    const result = new LayoutEngine().layoutScene({ designWidth: 640, designHeight: 360, nodes: [list] }, context);
    expect(result.nodes.filter((entry) => entry.node.id === "item-label")).toHaveLength(3);
    expect(result.nodes.filter((entry) => entry.node.id === "item-bg")).toHaveLength(3);
    expect(result.nodes.filter((entry) => entry.node.id === "item-label").map((entry) => entry.rect.x)).toEqual([0, 90, 180]);
  });
});
