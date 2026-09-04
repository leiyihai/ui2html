import { describe, expect, it } from "vitest";
import { applySelection, createSelectionIntent, flattenLayerIds } from "./selection";
import type { UINode } from "./types";

const orderedIds = ["a", "b", "c", "d", "e"];

describe("layer selection rules", () => {
  it("translates mouse modifiers into additive, range, and ordered selection intent", () => {
    expect(createSelectionIntent({ ctrlKey: true, shiftKey: true }, orderedIds)).toEqual({
      additive: true, range: true, orderedIds,
    });
  });

  it("keeps descendants in Shift order even when a folder is collapsed", () => {
    const node = (id: string, zIndex: number, children?: UINode[]): UINode => ({
      id, name: id, image: null, children, designRect: { x: 0, y: 0, width: 1, height: 1 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex,
      adaptation: { mode: "anchor" }, psd: { layerId: zIndex, originalX: 0, originalY: 0, originalWidth: 1, originalHeight: 1 },
    });
    expect(flattenLayerIds([node("root", 2, [node("child", 1)]), node("top", 3)])).toEqual(["top", "root", "child"]);
  });

  it("selects one node and establishes the Shift anchor", () => {
    expect(applySelection([], "b", null, { additive: false, range: false, orderedIds })).toEqual({
      ids: ["b"], primaryId: "b", anchorId: "b",
    });
  });

  it("adds and removes one node with Ctrl/Command", () => {
    const intent = { additive: true, range: false, orderedIds };
    expect(applySelection(["a"], "c", "a", intent).ids).toEqual(["a", "c"]);
    expect(applySelection(["a", "c"], "a", "a", intent)).toMatchObject({ ids: ["c"], primaryId: "c", anchorId: "a" });
  });

  it("selects a range with Shift without changing the anchor", () => {
    expect(applySelection(["b"], "e", "b", { additive: false, range: true, orderedIds })).toEqual({
      ids: ["b", "c", "d", "e"], primaryId: "e", anchorId: "b",
    });
  });

  it("removes a range with Ctrl/Command+Shift", () => {
    expect(applySelection(["a", "b", "c", "d", "e"], "d", "b", { additive: true, range: true, orderedIds })).toEqual({
      ids: ["a", "e"], primaryId: "e", anchorId: "b",
    });
  });
});
