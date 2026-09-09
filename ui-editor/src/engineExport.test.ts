import { describe, expect, it } from "vitest";
import { buildEngineJson } from "./engineExport";
import type { CtrlType, ImageBinding, UINode } from "./types";

function base(id: string, name: string, type: CtrlType, x = 0, y = 0, width = 100, height = 50): UINode {
  return {
    id, name, image: null, ctrl: { type },
    designRect: { x, y, width, height },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: x, offsetY: y, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
    adaptation: { mode: "anchor" }, psd: { layerId: 0, originalX: x, originalY: y, originalWidth: width, originalHeight: height },
  };
}

function binding(name: string, assetPath: string): ImageBinding {
  const source = { ...base(`source-${name}`, name, "StaticImage", 0, 0, 16, 16), image: {} as HTMLCanvasElement, assetPath };
  return { id: source.id, name, image: source.image!, sourceNode: source, sourceParentId: null, sourceIndex: 0 };
}

describe("self-developed engine JSON export", () => {
  it("exports a root window, absolute Area and typed image slots", () => {
    const root = base("root", "root", "Layout", 0, 0, 1280, 720);
    const button = base("button", "btn_confirm", "Button", 12, 24, 120, 48);
    button.resources = { NormalImage: binding("normal", "normal.png"), PushedImage: binding("pressed", "pressed.png") };
    root.children = [button];
    const result = buildEngineJson({ designWidth: 1280, designHeight: 720, nodes: [root] });

    expect(result.errors).toEqual([]);
    const json = JSON.parse(result.json);
    expect(json.Dialog.Window.Type).toBe("Layout");
    expect(json.Dialog.Window.Window[0].Property).toEqual([
      { Name: "Area", Value: "{{0,12},{0,24},{0,120},{0,48}}" },
      { Name: "HorizontalAlignment", Value: "Left" },
      { Name: "VerticalAlignment", Value: "Top" },
      { Name: "NormalImage", Value: "normal.png" },
      { Name: "PushedImage", Value: "pressed.png" },
    ]);
  });

  it("exports text and progress properties", () => {
    const text = base("text", "title", "StaticText", 10, 20, 100, 30);
    text.text = { content: "标题", fontSize: 24, color: "#fff", mode: "auto", minFontSize: 12 };
    const progress = base("progress", "pbar", "ProgressBar", 20, 60, 200, 20);
    progress.progress = { value: 0.75, direction: "horizontal", reverse: false };
    progress.resources = { ProgressImage: binding("fill", "fill.png") };
    const result = buildEngineJson({ designWidth: 320, designHeight: 180, nodes: [text, progress] });
    const windows = JSON.parse(result.json).Dialog.Window.Window;
    expect(windows[0].Property).toContainEqual({ Name: "Text", Value: "标题" });
    expect(windows[0].Property).toContainEqual({ Name: "TextColor", Value: "#fff" });
    expect(windows[1].Property).toContainEqual({ Name: "Progress", Value: "0.75" });
    expect(windows[1].Property).toContainEqual({ Name: "ProgressImage", Value: "fill.png" });
  });

  it("converts visual positions into offsets relative to engine alignment", () => {
    const root = base("root", "root", "Layout", 0, 0, 1000, 600);
    const centered = base("centered", "centered", "StaticText", 400, 250, 200, 100);
    centered.anchor.parentX = 0.5;
    centered.anchor.parentY = 0.5;
    centered.anchor.offsetX = -100;
    centered.anchor.offsetY = -50;
    const rightBottom = base("right-bottom", "right_bottom", "StaticImage", 840, 510, 120, 60);
    rightBottom.anchor.parentX = 1;
    rightBottom.anchor.parentY = 1;
    rightBottom.anchor.offsetX = -160;
    rightBottom.anchor.offsetY = -90;
    root.children = [centered, rightBottom];

    const json = JSON.parse(buildEngineJson({ designWidth: 1000, designHeight: 600, nodes: [root] }).json);
    expect(json.Dialog.Window.Window[0].Property[0]).toEqual({ Name: "Area", Value: "{{0,-100},{0,-50},{0,200},{0,100}}" });
    expect(json.Dialog.Window.Window[1].Property[0]).toEqual({ Name: "Area", Value: "{{0,-160},{0,-90},{0,120},{0,60}}" });
  });

  it("anchors a full-canvas root at the design origin", () => {
    const root = base("root", "root", "Layout", 0, 0, 1280, 720);
    root.anchor.offsetX = 24;
    root.anchor.offsetY = 18;
    const child = base("child", "child", "StaticText", 20, 30, 100, 30);
    root.children = [child];

    const json = JSON.parse(buildEngineJson({ designWidth: 1280, designHeight: 720, nodes: [root] }).json);
    expect(json.Dialog.Window.Property[0]).toEqual({ Name: "Area", Value: "{{0,0},{0,0},{0,1280},{0,720}}" });
    expect(json.Dialog.Window.Window[0].Property[0]).toEqual({ Name: "Area", Value: "{{0,20},{0,30},{0,100},{0,30}}" });
  });

  it("does not export the editor-only selected state", () => {
    const root = base("root", "root", "Layout", 0, 0, 100, 100);
    const radio = base("radio", "radio_tab", "RadioButton", 10, 10, 80, 30);
    radio.ctrl = { type: "RadioButton", selected: true };
    root.children = [radio];

    const result = buildEngineJson({ designWidth: 100, designHeight: 100, nodes: [root] });

    expect(result.errors).toEqual([]);
    expect(result.json).not.toContain("selected");
    expect(result.json).not.toContain("Selected");
  });

  it("reports unmarked nodes and maps empty editor nodes to Layout", () => {
    const unmarked = base("missing", "missing", "StaticImage");
    unmarked.ctrl = undefined;
    const empty = base("empty", "empty", "empty");
    const result = buildEngineJson({ designWidth: 100, designHeight: 100, nodes: [unmarked, empty] });
    expect(result.errors).toContain("节点「missing」未指定控件类型");
    expect(result.warnings).toContain("节点「empty」的编辑器类型 empty 将按 Layout 导出");
    expect(JSON.parse(result.json).Dialog.Window.Window[1].Type).toBe("Layout");
  });
});
