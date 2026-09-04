import { describe, expect, it } from "vitest";
import type { UINode } from "./types";
import { defaultFolderCtrlType, markControlType } from "./controlType";

function node(overrides: Partial<UINode> = {}): UINode {
  return {
    id: "node-1",
    name: "panel",
    image: null,
    children: [],
    designRect: { x: 0, y: 0, width: 100, height: 80 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex: 0,
    adaptation: { mode: "anchor" },
    psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 100, originalHeight: 80 },
    ...overrides,
  };
}

describe("control type marking", () => {
  it("imports PSD folders as Layout nodes by default", () => {
    expect(defaultFolderCtrlType()).toBe("Layout");
  });

  it("marks a node with the selected type without changing its image or layout data", () => {
    const image = {} as HTMLCanvasElement;
    const source = node({ image });
    const marked = markControlType(source, "Button");

    expect(marked.ctrl).toEqual({ type: "Button" });
    expect(marked.image).toBe(source.image);
    expect(marked.designRect).toEqual(source.designRect);
    expect(marked.anchor).toEqual(source.anchor);
  });

  it("creates the matching list configuration when a list type is selected", () => {
    const marked = markControlType(node(), "GridView");

    expect(marked.ctrl).toEqual({ type: "GridView" });
    expect(marked.list).toEqual({
      type: "grid",
      spacing: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      columns: 3,
    });
  });

  it("removes stale list configuration when a list node is changed to a non-list type", () => {
    const marked = markControlType(node({ list: {
      type: "grid", spacing: 8,
      padding: { left: 1, right: 2, top: 3, bottom: 4 }, columns: 4,
    }}), "StaticImage");

    expect(marked.ctrl).toEqual({ type: "StaticImage" });
    expect(marked.list).toBeUndefined();
  });

  it("moves an image into a child node when converting it to Layout", () => {
    const image = {} as HTMLCanvasElement;
    const marked = markControlType(node({ image, name: "Panel" }), "Layout");

    expect(marked.image).toBeNull();
    expect(marked.ctrl).toEqual({ type: "Layout" });
    expect(marked.children).toHaveLength(1);
    expect(marked.children?.[0]).toMatchObject({
      name: "Panel Image", image, ctrl: { type: "StaticImage" },
    });
  });

  it("allows a grouped node to become a control and keeps its children", () => {
    const child = node({ id: "child", image: {} as HTMLCanvasElement });
    const source = node({ children: [child], ctrl: { type: "Layout" } });

    const marked = markControlType(source, "RadioButton");
    expect(marked.ctrl).toEqual({ type: "RadioButton" });
    expect(marked.children).toEqual([child]);
  });

  it("clears interaction template references when leaving interactive types", () => {
    const source = node({ ctrl: { type: "Button", templateId: "press" } });
    expect(markControlType(source, "StaticImage").ctrl).toEqual({ type: "StaticImage" });
    expect(markControlType(source, "CheckBox").ctrl).toEqual({ type: "CheckBox", templateId: "press" });
  });
});
