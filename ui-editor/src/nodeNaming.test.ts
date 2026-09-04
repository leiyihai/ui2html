import { describe, expect, it } from "vitest";
import type { CtrlType, UINode } from "./types";
import { autoControlName, controlNamePrefix } from "./nodeNaming";

function sibling(id: string, name: string): UINode {
  return {
    id, name, image: null, children: [],
    designRect: { x: 0, y: 0, width: 10, height: 10 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
    adaptation: { mode: "anchor" },
    psd: { layerId: 0, originalX: 0, originalY: 0, originalWidth: 10, originalHeight: 10 },
  };
}

describe("automatic control naming", () => {
  it.each([
    ["Button", "btn_"], ["CheckBox", "chk_"], ["RadioButton", "radio_"],
    ["Edit", "edit_"], ["StaticImage", "img_"], ["StaticText", "txt_"],
    ["ProgressBar", "pbar_"], ["Slider", "slider_"], ["List", "vlist_"],
    ["ListHorizontal", "hlist_"], ["GridView", "grid_"], ["empty", "node_"],
  ] as [CtrlType, string][])('maps %s to %s', (type, prefix) => {
    expect(controlNamePrefix(type)).toBe(prefix);
  });

  it("uses the prefix first and then the smallest available same-parent number", () => {
    const siblings = [sibling("a", "btn_"), sibling("b", "btn_2_"), sibling("c", "btn_3_")];
    expect(autoControlName("Button", siblings)).toBe("btn_1_");
    expect(autoControlName("Button", [sibling("a", "btn_")])).toBe("btn_1_");
    expect(autoControlName("Button", [])).toBe("btn_");
  });

  it("allows duplicates when the caller supplies siblings from another parent", () => {
    expect(autoControlName("Button", [])).toBe("btn_");
  });

  it("falls back to node_ for an unknown type", () => {
    expect(controlNamePrefix("future-control" as CtrlType)).toBe("node_");
  });
});
