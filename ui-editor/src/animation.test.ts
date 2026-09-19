import { describe, expect, it } from "vitest";
import { createAnimationClip, evaluateAnimationClip, evaluateAnimationTrack, removeAnimationKeyframe, upsertAnimationKeyframe } from "./animation";
import { applyAnimationPreview } from "./renderer";
import type { LayoutResult } from "./types";

describe("animation utilities", () => {
  it("creates a normalized clip and upserts keyframes by time", () => {
    let clip = createAnimationClip("入场", "clip-1");
    clip = upsertAnimationKeyframe(clip, "opacity", 0, 0);
    clip = upsertAnimationKeyframe(clip, "opacity", 0.3, 1, "ease-out");
    clip = upsertAnimationKeyframe(clip, "opacity", 0.3, 0.8);
    expect(clip.tracks).toHaveLength(1);
    expect(clip.tracks[0].keyframes).toEqual([
      { time: 0, value: 0, easing: "linear" },
      { time: 0.3, value: 0.8, easing: "linear" },
    ]);
  });

  it("interpolates a track using the easing of the left keyframe", () => {
    const value = evaluateAnimationTrack({ property: "x", keyframes: [
      { time: 0, value: 0, easing: "ease-in" },
      { time: 1, value: 100 },
    ] }, 0.5);
    expect(value).toBe(25);
  });

  it("evaluates clips and removes empty tracks", () => {
    let clip = createAnimationClip("移动", "clip-2");
    clip = { ...clip, duration: 1 };
    clip = upsertAnimationKeyframe(clip, "x", 0, 0);
    clip = upsertAnimationKeyframe(clip, "x", 1, 100);
    clip = upsertAnimationKeyframe(clip, "opacity", 0, 0);
    expect(evaluateAnimationClip(clip, 0.5)).toEqual({ x: 50, opacity: 0 });
    expect(removeAnimationKeyframe(clip, "opacity", 0).tracks.map((track) => track.property)).toEqual(["x"]);
  });

  it("does not sample a delayed clip before its start time", () => {
    let clip = createAnimationClip("延迟", "clip-delay");
    clip = { ...clip, duration: 1, delay: 0.2 };
    clip = upsertAnimationKeyframe(clip, "opacity", 0, 0);
    clip = upsertAnimationKeyframe(clip, "opacity", 1, 1);
    expect(evaluateAnimationClip(clip, 0.1)).toEqual({});
    expect(evaluateAnimationClip(clip, 0.7).opacity).toBeCloseTo(0.5);
  });

  it("maps a preview sample onto the rendered rectangle without mutating the node", () => {
    let clip = createAnimationClip("移动", "clip-3");
    clip = { ...clip, duration: 1 };
    clip = upsertAnimationKeyframe(clip, "x", 0, 10);
    clip = upsertAnimationKeyframe(clip, "x", 1, 30);
    const item = {
      node: {
        id: "node-1",
        anchor: { offsetX: 10, offsetY: 20, selfX: 0.5, selfY: 0.5 },
        scale: { x: 1, y: 1 },
        opacity: 1,
        animations: [clip],
      },
      rect: { x: 100, y: 40, width: 80, height: 20 },
      visible: true,
      opacity: 1,
    } as unknown as LayoutResult["nodes"][number];
    const next = applyAnimationPreview(item, { nodeId: "node-1", clipId: "clip-3", time: 0.5 }, 2, 2);
    expect(next.rect.x).toBe(120);
    expect(next.rect.y).toBe(40);
    expect(item.rect.x).toBe(100);
  });
});
