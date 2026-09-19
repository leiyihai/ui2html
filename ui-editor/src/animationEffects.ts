import { createAnimationClip, upsertAnimationKeyframe } from "./animation";
import type { AnimationClip, AnimationEasing, AnimationProperty, UINode } from "./types";

/** UI2HTML 的内置特效适配层：将常用网页动效转成可导出的关键帧数据。 */
export const ANIMATION_EFFECT_LIBRARY_VERSION = "ui2html-effects-1.0.0";
export const ANIMATION_EFFECT_LIBRARY_LICENSE = "MIT-compatible adapter";
export const ANIMATION_EFFECT_LIBRARY_SOURCE = "https://github.com/juliangarnier/anime";

export interface AnimationEffectDefinition {
  id: string;
  name: string;
  description: string;
  duration: number;
  source: string;
  sourceUrl: string;
  license: string;
}

export const ANIMATION_EFFECTS: AnimationEffectDefinition[] = [
  { id: "fade-in", name: "淡入", description: "透明度从 0 平滑进入", duration: 0.36, source: "anime.js@3.2.2-inspired", sourceUrl: ANIMATION_EFFECT_LIBRARY_SOURCE, license: ANIMATION_EFFECT_LIBRARY_LICENSE },
  { id: "scale-in", name: "弹性出现", description: "从略小尺寸平滑放大到原尺寸", duration: 0.42, source: "anime.js@3.2.2-inspired", sourceUrl: ANIMATION_EFFECT_LIBRARY_SOURCE, license: ANIMATION_EFFECT_LIBRARY_LICENSE },
  { id: "slide-up", name: "向上滑入", description: "从下方进入当前位置", duration: 0.42, source: "anime.js@3.2.2-inspired", sourceUrl: ANIMATION_EFFECT_LIBRARY_SOURCE, license: ANIMATION_EFFECT_LIBRARY_LICENSE },
  { id: "slide-left", name: "向左滑入", description: "从右侧进入当前位置", duration: 0.42, source: "anime.js@3.2.2-inspired", sourceUrl: ANIMATION_EFFECT_LIBRARY_SOURCE, license: ANIMATION_EFFECT_LIBRARY_LICENSE },
  { id: "pulse", name: "强调呼吸", description: "短暂放大后回到原尺寸", duration: 0.6, source: "anime.js@3.2.2-inspired", sourceUrl: ANIMATION_EFFECT_LIBRARY_SOURCE, license: ANIMATION_EFFECT_LIBRARY_LICENSE },
  { id: "shake", name: "轻微抖动", description: "横向快速抖动后复位", duration: 0.42, source: "anime.js@3.2.2-inspired", sourceUrl: ANIMATION_EFFECT_LIBRARY_SOURCE, license: ANIMATION_EFFECT_LIBRARY_LICENSE },
];

function effectDefinition(effectId: string): AnimationEffectDefinition {
  return ANIMATION_EFFECTS.find((effect) => effect.id === effectId) ?? ANIMATION_EFFECTS[0];
}

function valueFor(node: UINode, property: AnimationProperty): number {
  switch (property) {
    case "x": return node.anchor.offsetX;
    case "y": return node.anchor.offsetY;
    case "scaleX": return node.scale.x;
    case "scaleY": return node.scale.y;
    case "rotation": return node.rotation;
    case "opacity": return node.opacity;
    case "width": return node.designRect.width;
    case "height": return node.designRect.height;
  }
}

function addKeyframes(clip: AnimationClip, property: AnimationProperty, values: Array<[number, number, AnimationEasing?]>): AnimationClip {
  return values.reduce((current, [time, value, easing = "ease-out"]) => upsertAnimationKeyframe(current, property, time, value, easing), clip);
}

export function createEffectClip(node: UINode, effectId: string, id = "effect-" + effectId + "-" + Date.now()): AnimationClip {
  const definition = effectDefinition(effectId);
  let clip: AnimationClip = {
    ...createAnimationClip(definition.name, id),
    duration: definition.duration,
    source: "system",
    effectId: definition.id,
    effectVersion: ANIMATION_EFFECT_LIBRARY_VERSION,
    effectLicense: definition.license,
  };
  const x = valueFor(node, "x");
  const y = valueFor(node, "y");
  const scaleX = valueFor(node, "scaleX");
  const scaleY = valueFor(node, "scaleY");
  const opacity = valueFor(node, "opacity");
  switch (definition.id) {
    case "scale-in":
      clip = addKeyframes(clip, "scaleX", [[0, scaleX * 0.84], [definition.duration, scaleX]]);
      clip = addKeyframes(clip, "scaleY", [[0, scaleY * 0.84], [definition.duration, scaleY]]);
      break;
    case "slide-up":
      clip = addKeyframes(clip, "y", [[0, y + 48], [definition.duration, y]]);
      clip = addKeyframes(clip, "opacity", [[0, 0], [definition.duration, opacity]]);
      break;
    case "slide-left":
      clip = addKeyframes(clip, "x", [[0, x + 48], [definition.duration, x]]);
      clip = addKeyframes(clip, "opacity", [[0, 0], [definition.duration, opacity]]);
      break;
    case "pulse":
      clip = addKeyframes(clip, "scaleX", [[0, scaleX], [definition.duration * 0.45, scaleX * 1.06], [definition.duration, scaleX]]);
      clip = addKeyframes(clip, "scaleY", [[0, scaleY], [definition.duration * 0.45, scaleY * 1.06], [definition.duration, scaleY]]);
      break;
    case "shake":
      clip = addKeyframes(clip, "x", [[0, x], [0.08, x - 8], [0.16, x + 8], [0.25, x - 4], [definition.duration, x]]);
      break;
    case "fade-in":
    default:
      clip = addKeyframes(clip, "opacity", [[0, 0], [definition.duration, opacity]]);
      break;
  }
  return clip;
}

export function findAnimationEffect(effectId: string | undefined): AnimationEffectDefinition | undefined {
  return effectId ? ANIMATION_EFFECTS.find((effect) => effect.id === effectId) : undefined;
}
