import { describe, expect, it } from "vitest";
import type { CtrlType, UINode } from "./types";
import { autoControlName, controlNamePrefix, controlTypeName, quickControlName, renameControlForType, typeConversionNames } from "./nodeNaming";

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
    ["Layout", "lyt_"], ["Button", "btn_"], ["CheckBox", "chk_"], ["RadioButton", "rdo_"],
    ["Edit", "edt_"], ["StaticImage", "img_"], ["StaticText", "txt_"],
    ["ProgressBar", "pbr_"], ["Slider", "sld_"], ["List", "vls_"],
    ["ListHorizontal", "hls_"], ["GridView", "grd_"], ["empty", "nod_"],
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
    expect(controlNamePrefix("future-control" as CtrlType)).toBe("nod_");
  });

  it("changes only the type prefix and preserves the AI semantic suffix", () => {
    const source = sibling("source", "layout_inventory_panel");
    source.ctrl = { type: "Layout" };
    source.naming = { source: "ai", confidence: 0.92, suffix: "inventory_panel" };

    expect(renameControlForType(source, "List", [])).toBe("vls_inventory_panel");
    expect(renameControlForType(source, "ListHorizontal", [])).toBe("hls_inventory_panel");
    expect(renameControlForType(source, "GridView", [])).toBe("grd_inventory_panel");
  });

  it("keeps a preserved suffix unique among siblings", () => {
    const source = sibling("source", "layout_inventory_panel");
    source.naming = { source: "ai", confidence: 0.92, suffix: "inventory_panel" };

    expect(renameControlForType(source, "GridView", [sibling("other", "grd_inventory_panel")]))
      .toBe("grd_inventory_panel_2");
  });

  it("derives the suffix from an existing prefixed name when analysis metadata is absent", () => {
    const source = sibling("source", "btn_confirm_purchase");
    source.ctrl = { type: "Button" };

    expect(renameControlForType(source, "Slider", [])).toBe("sld_confirm_purchase");
  });

  it("replaces old or unknown prefixes instead of preserving them", () => {
    expect(renameControlForType(sibling("source", "radio_tab"), "RadioButton", [])).toBe("rdo_tab");
    expect(renameControlForType(sibling("source", "wrong_confirm_purchase"), "Button", [])).toBe("btn_confirm_purchase");
  });

  it("creates a Chinese整理名称 for the one-step T action", () => {
    expect(controlTypeName("ProgressBar")).toBe("进度条");
    expect(quickControlName(sibling("source", "经验"), "ProgressBar", [])).toBe("进度条");
    expect(quickControlName(sibling("source", "旧名"), "Button", [sibling("other", "按钮")])).toBe("按钮_2");
  });

  it("creates a Chinese PSD name and an empty English prefix for a newly grouped node", () => {
    const source = sibling("group", "布局");
    source.originalName = "布局";
    source.ctrl = { type: "Layout" };

    expect(typeConversionNames(source, "Slider", [source])).toEqual({
      originalName: "滑动条",
      projectName: "sld_",
    });
  });

  it("keeps an existing AI suffix while changing the engineering type prefix", () => {
    const source = sibling("volume", "layout_volume");
    source.originalName = "音量";
    source.ctrl = { type: "Layout" };
    source.naming = { source: "ai", confidence: 0.92, suffix: "volume" };

    expect(typeConversionNames(source, "Slider", [source])).toEqual({
      originalName: "滑动条",
      projectName: "sld_volume",
    });
  });
});
