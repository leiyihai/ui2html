import { describe, expect, it } from "vitest";
import { relativeLayoutValue, resolveLayoutValue, syncNodeLayoutPosition } from "./layoutValues";
import type { UINode } from "./types";

function node(): UINode {
  return {
    id: "node", name: "node", image: null,
    designRect: { x: 0, y: 0, width: 100, height: 50 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    layout: {
      x: relativeLayoutValue(0.25), y: relativeLayoutValue(0.5),
      width: { mode: "absolute", relative: 0, absolute: 100 },
      height: { mode: "absolute", relative: 0, absolute: 50 },
    },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
    adaptation: { mode: "anchor" },
    psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 100, originalHeight: 50 },
  };
}

describe("layout value expressions", () => {
  it("resolves relative and absolute parts against the parent size", () => {
    expect(resolveLayoutValue({ mode: "relative", relative: 0.25, absolute: 12 }, 800, 0)).toBe(212);
  });

  it("keeps a relative position mode when a node is moved", () => {
    const value = node();
    value.anchor.offsetX = 200;
    value.anchor.offsetY = 150;
    syncNodeLayoutPosition(value, 800, 600);
    expect(value.layout?.x).toMatchObject({ mode: "relative", relative: 0.25, absolute: 0 });
    expect(value.layout?.y).toMatchObject({ mode: "relative", relative: 0.25, absolute: 0 });
  });
});
