import { describe, expect, it } from "vitest";
import type { UINode } from "./types";
import { moveLayerOrder } from "./layerOrder";

function node(id: string, zIndex: number, children?: UINode[]): UINode {
  return {
    id, name: id, image: {} as HTMLCanvasElement, children,
    designRect: { x: 0, y: 0, width: 10, height: 10 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex,
    adaptation: { mode: "anchor" },
    psd: { layerId: zIndex, originalX: 0, originalY: 0, originalWidth: 10, originalHeight: 10 },
  };
}

describe("layer order shortcuts", () => {
  it("moves a sibling into the adjacent Layout when moving downward", () => {
    const exp = node("EXP", 4);
    const experience = node("experience", 3, [node("value", 2), node("bar", 1)]);
    experience.ctrl = { type: "Layout" };

    const result = moveLayerOrder([exp, experience], ["EXP"], "down");

    expect(result.changed).toBe(true);
    expect(result.newParentId).toBe("experience");
    expect(result.nodes.map((n) => n.id)).toEqual(["experience"]);
    expect(result.nodes[0].children?.map((n) => n.id)).toEqual(["EXP", "value", "bar"]);
  });

  it("moves a sibling into an empty adjacent Layout", () => {
    const layout = node("empty-layout", 2, []);
    layout.ctrl = { type: "Layout" };

    const result = moveLayerOrder([node("label", 3), layout], ["label"], "down");

    expect(result.newParentId).toBe("empty-layout");
    expect(result.nodes[0].children?.map((n) => n.id)).toEqual(["label"]);
  });

  it("moves a lower sibling into the bottom of an adjacent Layout when moving upward", () => {
    const layout = node("layout", 3, [node("first", 2)]);
    layout.ctrl = { type: "Layout" };

    const result = moveLayerOrder([layout, node("label", 1)], ["label"], "up");

    expect(result.newParentId).toBe("layout");
    expect(result.nodes[0].children?.map((n) => n.id)).toEqual(["first", "label"]);
  });

  it("moves a child upward and then out of its folder at the boundary", () => {
    const folder = node("folder", 4, [node("a", 3), node("b", 2), node("c", 1)]);
    const first = moveLayerOrder([folder], ["c"], "up");
    expect(first.nodes[0].children?.map((n) => n.id)).toEqual(["a", "c", "b"]);
    expect(first.nodes[0].children?.map((n) => n.zIndex)).toEqual([3, 2, 1]);
    expect(first.nodes[0].zIndex).toBe(4);
    const second = moveLayerOrder(first.nodes, ["c"], "up");
    expect(second.nodes[0].children?.map((n) => n.id)).toEqual(["c", "a", "b"]);
    const third = moveLayerOrder(second.nodes, ["c"], "up");
    expect(third.nodes.map((n) => n.id)).toEqual(["c", "folder"]);
  });

  it("moves selected siblings as one block", () => {
    const folder = node("folder", 4, [node("a", 3), node("b", 2), node("c", 1)]);
    const result = moveLayerOrder([folder], ["b", "c"], "up");
    expect(result.nodes[0].children?.map((n) => n.id)).toEqual(["b", "c", "a"]);
  });

  it("moves downward and can leave the folder at the lower boundary", () => {
    const folder = node("folder", 4, [node("a", 3), node("b", 2), node("c", 1)]);
    const first = moveLayerOrder([folder], ["a"], "down");
    expect(first.nodes[0].children?.map((n) => n.id)).toEqual(["b", "a", "c"]);
    const second = moveLayerOrder(first.nodes, ["a"], "down");
    expect(second.nodes[0].children?.map((n) => n.id)).toEqual(["b", "c", "a"]);
    const third = moveLayerOrder(second.nodes, ["a"], "down");
    expect(third.nodes.map((n) => n.id)).toEqual(["folder", "a"]);
  });

  it("does not move a root node beyond the root boundary", () => {
    const result = moveLayerOrder([node("a", 2), node("b", 1)], ["a"], "up");
    expect(result.changed).toBe(false);
  });
});
