import { describe, expect, it } from "vitest";
import { ANIMATION_EFFECT_LIBRARY_VERSION, createEffectClip } from "./animationEffects";
import type { UINode } from "./types";

const node: UINode = {
  id: "button",
  name: "按钮",
  image: null,
  designRect: { x: 20, y: 30, width: 100, height: 40 },
  anchor: { parentX: 0, parentY: 0, selfX: 0.5, selfY: 0.5, offsetX: 20, offsetY: 30, safeArea: false },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  visible: true,
  zIndex: 1,
  adaptation: { mode: "anchor" },
  psd: { layerId: 1, originalX: 20, originalY: 30, originalWidth: 100, originalHeight: 40 },
};

describe("animation effect adapter", () => {
  it("converts a curated effect into versioned keyframes", () => {
    const clip = createEffectClip(node, "slide-up", "effect-1");
    expect(clip.source).toBe("system");
    expect(clip.effectVersion).toBe(ANIMATION_EFFECT_LIBRARY_VERSION);
    expect(clip.tracks.map((track) => track.property)).toEqual(["y", "opacity"]);
    expect(clip.tracks[0].keyframes[0].value).toBe(78);
  });
});
