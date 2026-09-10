import { describe, expect, it } from "vitest";
import { applyAiNaming, applyFallbackNaming, buildNamingManifest, type AiNamingResult, typePrefix, warningNodeIds } from "./aiNaming";
import type { UIScene, UINode } from "./types";

function node(id: string, name: string, type: UINode["ctrl"] extends infer T ? T : never, image = false): UINode {
  return {
    id, name, image: image ? { width: 4, height: 4, toDataURL: () => `data:image/png;base64,${id}` } as unknown as HTMLCanvasElement : null,
    ctrl: type as UINode["ctrl"], designRect: { x: 0, y: 0, width: 40, height: 20 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
    adaptation: { mode: "anchor" }, psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 40, originalHeight: 20 },
  };
}

describe("AI naming pipeline", () => {
  it("uses the same engine prefixes as manual type conversion", () => {
    expect(typePrefix("CheckBox")).toBe("chk");
    expect(typePrefix("Edit")).toBe("edit");
    expect(typePrefix("StaticText")).toBe("txt");
    expect(typePrefix("List")).toBe("vlist");
    expect(typePrefix("ListHorizontal")).toBe("hlist");
    expect(typePrefix("GridView")).toBe("grid");
  });

  it("creates stable local fallback names and an analysis record", () => {
    const scene: UIScene = { designWidth: 100, designHeight: 100, nodes: [node("a", "音量", { type: "Slider" }, true)] };
    const fallback = applyFallbackNaming(scene);
    expect(fallback.scene.nodes[0].name).toBe("slider_volume");
    expect(fallback.scene.nodes[0].assetName).toBe("img_volume");
    expect(fallback.analysis.nodes.a.source).toBe("fallback");
  });

  it("accepts high confidence AI names but falls back for low confidence", () => {
    const scene: UIScene = { designWidth: 100, designHeight: 100, nodes: [node("a", "任务", { type: "Button" }), node("b", "未知", { type: "Button" })] };
    const fallback = applyFallbackNaming(scene).scene;
    const result: AiNamingResult = { nodes: [
      { id: "a", suffix: "confirm", confidence: 0.96 },
      { id: "b", suffix: "mystery", confidence: 0.2 },
    ] };
    const named = applyAiNaming(fallback, result);
    expect(named.scene.nodes[0].name).toBe("btn_confirm");
    expect(named.scene.nodes[1].name).toBe("btn_item");
    expect(named.analysis.nodes.a.source).toBe("ai");
    expect(named.analysis.nodes.b.source).toBe("fallback");
  });

  it("sends a compact layer and unique asset manifest", () => {
    const image = node("a", "背景", { type: "StaticImage" }, true);
    image.originalName = "背包背景";
    const scene: UIScene = { designWidth: 100, designHeight: 100, nodes: [{ ...image }, { ...image, id: "b" }] };
    const manifest = buildNamingManifest(scene);
    expect(manifest.nodes).toHaveLength(2);
    expect(manifest.nodes[0].originalName).toBe("背包背景");
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].nodeIds).toEqual(["a", "b"]);
    expect(manifest.assets[0].sourceNames).toContain("背包背景");
    expect(manifest.design).toEqual({ width: 100, height: 100 });
  });

  it("keeps manually renamed nodes unchanged when AI naming is run again", () => {
    const original = node("manual", "btn_custom", { type: "Button" });
    original.naming = { source: "manual", confidence: 1, suffix: "custom" };
    const named = applyAiNaming({ designWidth: 100, designHeight: 100, nodes: [original] }, {
      nodes: [{ id: "manual", suffix: "overwritten", confidence: 1 }],
    });
    expect(named.scene.nodes[0].name).toBe("btn_custom");
    expect(named.analysis.nodes.manual.source).toBe("manual");
  });

  it("can explicitly overwrite manual names when the user triggers a full AI rename", () => {
    const original = node("manual", "按钮", { type: "Button" });
    original.naming = { source: "manual", confidence: 1, suffix: "按钮" };
    const named = applyAiNaming({ designWidth: 100, designHeight: 100, nodes: [original] }, {
      nodes: [{ id: "manual", suffix: "confirm", confidence: 0.96 }],
    }, { overwriteManual: true });

    expect(named.scene.nodes[0].name).toBe("btn_confirm");
    expect(named.analysis.nodes.manual.source).toBe("ai");
  });

  it("does not mark every node red when local fallback naming is the only available result", () => {
    const fallback = applyFallbackNaming({
      designWidth: 100,
      designHeight: 100,
      nodes: [node("local", "未知", { type: "Button" })],
    });
    expect(warningNodeIds(fallback.analysis)).toEqual([]);
    expect(warningNodeIds({
      ...fallback.analysis,
      provider: "codex-cli",
      status: "partial",
      nodes: { local: { source: "fallback", confidence: 0.2 } },
    })).toEqual(["local"]);
  });
});
