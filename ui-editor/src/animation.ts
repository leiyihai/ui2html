import type { AnimationClip, AnimationEasing, AnimationKeyframe, AnimationProperty, AnimationTrack } from "./types";

export const ANIMATION_DEFAULT_DURATION = 0.3;
export const ANIMATION_EASINGS: AnimationEasing[] = ["linear", "ease-in", "ease-out", "ease-in-out"];

export function clampAnimationTime(value: number, duration = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, duration), value));
}

export function normalizeAnimationKeyframes(keyframes: AnimationKeyframe[], duration = Number.POSITIVE_INFINITY): AnimationKeyframe[] {
  const sorted = keyframes
    .filter((keyframe) => Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value))
    .map((keyframe) => ({
      time: clampAnimationTime(keyframe.time, duration),
      value: keyframe.value,
      ...(keyframe.easing ? { easing: keyframe.easing } : {}),
    }))
    .sort((a, b) => a.time - b.time);
  const merged: AnimationKeyframe[] = [];
  for (const keyframe of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.time - keyframe.time) < 0.0001) merged[merged.length - 1] = keyframe;
    else merged.push(keyframe);
  }
  return merged;
}

export function normalizeAnimationClip(clip: AnimationClip): AnimationClip {
  const duration = Math.max(0, Number.isFinite(clip.duration) ? clip.duration : ANIMATION_DEFAULT_DURATION);
  return {
    ...clip,
    duration,
    delay: Math.max(0, Number.isFinite(clip.delay) ? clip.delay : 0),
    loop: clip.loop === "infinite" ? "infinite" : Math.max(1, Math.round(Number.isFinite(clip.loop) ? clip.loop : 1)),
    tracks: clip.tracks.map((track) => ({
      property: track.property,
      keyframes: normalizeAnimationKeyframes(track.keyframes, duration),
    })),
  };
}

export function createAnimationClip(name = "动画 1", id = `anim-${Date.now()}`): AnimationClip {
  return {
    id,
    name,
    duration: ANIMATION_DEFAULT_DURATION,
    delay: 0,
    loop: 1,
    direction: "normal",
    autoPlay: false,
    tracks: [],
    source: "manual",
  };
}

export function findAnimationTrack(clip: AnimationClip, property: AnimationProperty): AnimationTrack | undefined {
  return clip.tracks.find((track) => track.property === property);
}

export function upsertAnimationKeyframe(
  clip: AnimationClip,
  property: AnimationProperty,
  time: number,
  value: number,
  easing: AnimationEasing = "linear",
): AnimationClip {
  const normalized = normalizeAnimationClip(clip);
  const nextTime = clampAnimationTime(time, normalized.duration);
  const tracks = [...normalized.tracks];
  const trackIndex = tracks.findIndex((track) => track.property === property);
  const current = trackIndex >= 0 ? tracks[trackIndex] : { property, keyframes: [] };
  const keyframes = normalizeAnimationKeyframes([...current.keyframes, { time: nextTime, value, easing }], normalized.duration);
  const nextTrack = { ...current, keyframes };
  if (trackIndex >= 0) tracks[trackIndex] = nextTrack;
  else tracks.push(nextTrack);
  return { ...normalized, tracks };
}

export function removeAnimationKeyframe(clip: AnimationClip, property: AnimationProperty, time: number): AnimationClip {
  const normalized = normalizeAnimationClip(clip);
  const tracks = normalized.tracks
    .map((track) => track.property === property
      ? { ...track, keyframes: track.keyframes.filter((keyframe) => Math.abs(keyframe.time - time) >= 0.0001) }
      : track)
    .filter((track) => track.keyframes.length > 0);
  return { ...normalized, tracks };
}

function easingValue(value: number, easing: AnimationEasing): number {
  switch (easing) {
    case "ease-in": return value * value;
    case "ease-out": return 1 - ((1 - value) * (1 - value));
    case "ease-in-out": return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
    default: return value;
  }
}

/** 在指定时间读取单条轨道值；无关键帧时返回 undefined。 */
export function evaluateAnimationTrack(track: AnimationTrack, time: number): number | undefined {
  const keyframes = normalizeAnimationKeyframes(track.keyframes);
  if (!keyframes.length) return undefined;
  if (time <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;
  for (let index = 1; index < keyframes.length; index++) {
    const right = keyframes[index];
    const left = keyframes[index - 1];
    if (time > right.time) continue;
    const span = Math.max(0.0001, right.time - left.time);
    const progress = easingValue((time - left.time) / span, left.easing ?? "linear");
    return left.value + (right.value - left.value) * progress;
  }
  return last.value;
}

export function evaluateAnimationClip(clip: AnimationClip, time: number): Partial<Record<AnimationProperty, number>> {
  const normalized = normalizeAnimationClip(clip);
  if (time < normalized.delay) return {};
  const localTime = Math.max(0, time - normalized.delay);
  let sampleTime = localTime;
  if (normalized.loop === "infinite" || normalized.loop > 1) {
    const cycle = Math.max(0.0001, normalized.duration);
    const cycleIndex = Math.floor(localTime / cycle);
    sampleTime = localTime % cycle;
    if (normalized.direction === "reverse" || (normalized.direction === "alternate" && cycleIndex % 2 === 1)) {
      sampleTime = cycle - sampleTime;
    }
  } else if (normalized.direction === "reverse") {
    sampleTime = normalized.duration - Math.min(normalized.duration, sampleTime);
  }
  return Object.fromEntries(normalized.tracks.flatMap((track) => {
    const value = evaluateAnimationTrack(track, sampleTime);
    return value === undefined ? [] : [[track.property, value]];
  }));
}
