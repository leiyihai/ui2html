import { describe, expect, it } from "vitest";
import { collectSavedAssetPaths, restoreSceneSnapshot, SCENE_PERSISTENCE_VERSION, serializeScene } from "./scenePersistence";
import type { ImageBinding, UIScene, UINode } from "./types";

function node(id: string, name: string, assetPath?: string): UINode {
  return {
    id,
    name,
    image: assetPath ? {} as HTMLCanvasElement : null,
    ...(assetPath ? { assetPath } : {}),
    designRect: { x: 4, y: 5, width: 10, height: 10 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 4, offsetY: 5, safeArea: false },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex: 0,
    adaptation: { mode: "anchor" },
    psd: { layerId: 99, originalX: 4, originalY: 5, originalWidth: 10, originalHeight: 10 },
  };
}

describe("independent UI project snapshots", () => {
  it("serializes the complete editable hierarchy without PSD identities", () => {
    const first = node("first", "同名", "同名.png");
    first.ctrl = { type: "StaticImage" };
    first.rotation = 12;
    first.locked = true;
    const second = node("second", "同名");
    second.ctrl = { type: "StaticText" };
    second.text = { content: "可编辑", fontSize: 24, color: "#fff", mode: "auto", minFontSize: 12 };
    const scene: UIScene = { designWidth: 800, designHeight: 600, nodes: [first, second] };

    const saved = serializeScene(scene);
    const serialized = JSON.stringify(saved);

    expect(saved.schemaVersion).toBe(SCENE_PERSISTENCE_VERSION);
    expect(saved.nodes.map((item) => item.id)).toEqual(["first", "second"]);
    expect(saved.nodes[0].assetPath).toBe("同名.png");
    expect(saved.nodes[1].text?.content).toBe("可编辑");
    expect(serialized).not.toContain('"psd"');
    expect(serialized).not.toContain("psd-layer:");
  });

  it("restores image canvases only from the project asset map", () => {
    const source = node("image", "图标", "图标.png");
    source.anchor.offsetX = 37;
    const scene: UIScene = { designWidth: 800, designHeight: 600, nodes: [source] };
    const saved = serializeScene(scene);
    const projectCanvas = {} as HTMLCanvasElement;

    const restored = restoreSceneSnapshot(saved, new Map([["图标.png", projectCanvas]]));

    expect(restored.scene.nodes[0].image).toBe(projectCanvas);
    expect(restored.scene.nodes[0].anchor.offsetX).toBe(37);
    expect(restored.scene.nodes[0].id).toBe("image");
    expect(restored.missingAssets).toEqual([]);
  });

  it("keeps a missing resource node and reports the missing asset", () => {
    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [node("image", "图标", "lost.png")] });
    const restored = restoreSceneSnapshot(saved, new Map());

    expect(restored.scene.nodes[0].image).toBeNull();
    expect(restored.scene.nodes[0].assetPath).toBe("lost.png");
    expect(restored.missingAssets).toEqual(["lost.png"]);
  });

  it("round-trips bound resource source nodes through .assets", () => {
    const image = node("normal", "普通", "普通.png");
    const target = node("button", "按钮");
    target.ctrl = { type: "Button" };
    const binding: ImageBinding = {
      id: image.id,
      name: image.name,
      image: image.image!,
      sourceNode: image,
      sourceParentId: target.id,
      sourceIndex: 0,
    };
    target.resources = { NormalImage: binding };
    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [target] });
    const canvas = {} as HTMLCanvasElement;

    const restored = restoreSceneSnapshot(saved, new Map([["普通.png", canvas]])).scene;

    expect(restored.nodes[0].resources?.NormalImage?.image).toBe(canvas);
    expect(restored.nodes[0].resources?.NormalImage?.sourceNode.assetPath).toBe("普通.png");
    expect(collectSavedAssetPaths(saved)).toEqual(["普通.png"]);
  });

  it("round-trips a user-confirmed resource binding completion marker", () => {
    const target = node("button", "按钮");
    target.ctrl = { type: "Button" };
    target.resourceBindingComplete = true;

    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [target] });
    const restored = restoreSceneSnapshot(saved, new Map()).scene.nodes[0];

    expect(saved.nodes[0].resourceBindingComplete).toBe(true);
    expect(restored.resourceBindingComplete).toBe(true);
  });

  it("saves and restores project viewport settings", () => {
    const saved = serializeScene({ designWidth: 1280, designHeight: 720, nodes: [] }, {
      viewport: { width: 1920, height: 1080 },
      safeArea: { left: 20, right: 20, top: 10, bottom: 10 },
      scaleMode: "contain",
      showSafeArea: true,
      showDesignBorder: false,
    });

    expect(saved.view.viewport).toEqual({ width: 1920, height: 1080 });
    expect(saved.view.scaleMode).toBe("contain");
  });

  it("round-trips the text displayed by an Edit control", () => {
    const edit = node("edit", "输入框");
    edit.ctrl = { type: "Edit" };
    edit.text = { content: "请输入名称", fontSize: 20, color: "#ffffff", mode: "fixed", minFontSize: 12 };

    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [edit] });
    const restored = restoreSceneSnapshot(saved, new Map()).scene.nodes[0];

    expect(saved.nodes[0].text?.content).toBe("请输入名称");
    expect(restored.text?.content).toBe("请输入名称");
  });

  it("round-trips Slider progress settings", () => {
    const slider = node("slider", "slider_volume");
    slider.ctrl = { type: "Slider" };
    slider.progress = { value: 0.75, direction: "vertical", reverse: true };

    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [slider] });
    const restored = restoreSceneSnapshot(saved, new Map()).scene.nodes[0];

    expect(saved.nodes[0].progress).toEqual({ value: 0.75, direction: "vertical", reverse: true });
    expect(restored.progress).toEqual({ value: 0.75, direction: "vertical", reverse: true });
  });

  it("round-trips the editor-only initial selected state", () => {
    const radio = node("radio", "radio_tab", "radio.png");
    radio.ctrl = { type: "RadioButton", selected: true };

    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [radio] });
    const restored = restoreSceneSnapshot(saved, new Map([["radio.png", {} as HTMLCanvasElement]])).scene.nodes[0];

    expect(saved.nodes[0].ctrl).toEqual({ type: "RadioButton", selected: true });
    expect(restored.ctrl?.selected).toBe(true);
  });

  it("omits the default unselected state from the project JSON", () => {
    const check = node("check", "chk_option");
    check.ctrl = { type: "CheckBox", selected: undefined };

    expect(JSON.stringify(serializeScene({ designWidth: 100, designHeight: 100, nodes: [check] })))
      .not.toContain("selected");
  });

  it("round-trips AI/manual naming metadata without PSD dependencies", () => {
    const named = node("named", "btn_confirm");
    named.assetName = "img_button_normal";
    named.naming = { source: "manual", confidence: 1, suffix: "confirm" };
    const saved = serializeScene({ designWidth: 100, designHeight: 100, nodes: [named] });
    const restored = restoreSceneSnapshot(saved, new Map()).scene.nodes[0];
    expect(restored.assetName).toBe("img_button_normal");
    expect(restored.naming?.source).toBe("manual");
  });

  it("round-trips confirmed nine-slice groups and restores their render source", () => {
    const source = node("panel", "img_panel", "panel.png");
    const scene: UIScene = {
      designWidth: 100, designHeight: 100, nodes: [source],
      nineSliceCandidates: [{
        id: "slice-panel", memberNodeIds: ["panel"], sourceNodeId: "panel", sourceAssetKey: "panel-key",
        suggestedMargins: { left: 8, top: 6, right: 8, bottom: 6 }, confidence: 0.9,
        reason: "面板", status: "confirmed", signature: "panel-signature",
      }],
      nineSliceGroups: [{
        id: "slice-panel", memberNodeIds: ["panel"], sourceNodeId: "panel", sourceAssetKey: "panel-key",
        sourceAssetPath: "9/panel.png", margins: { left: 8, top: 6, right: 8, bottom: 6 },
      }],
      useNineSlicePreview: true,
    };
    const saved = serializeScene(scene);
    const nineCanvas = {} as HTMLCanvasElement;
    const restored = restoreSceneSnapshot(saved, new Map([["panel.png", {} as HTMLCanvasElement], ["9/panel.png", nineCanvas]])).scene;
    expect(saved.nineSliceGroups?.[0].margins).toEqual({ left: 8, top: 6, right: 8, bottom: 6 });
    expect(restored.useNineSlicePreview).toBe(true);
    expect(restored.nodes[0].nineSliceGroupId).toBe("slice-panel");
    expect(restored.nodes[0].slice).toEqual({ left: 8, top: 6, right: 8, bottom: 6 });
    expect(restored.nodes[0].sliceImage).toBe(nineCanvas);
    expect(collectSavedAssetPaths(saved)).toEqual(["panel.png", "9/panel.png"]);
  });
});
