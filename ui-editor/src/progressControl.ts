import type { ProgressConfig, ProgressDirection, UINode } from "./types";

export function inferProgressDirection(width: number, height: number): ProgressDirection {
  return width >= height ? "horizontal" : "vertical";
}

export function clampProgressValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function defaultProgressConfig(node: Pick<UINode, "designRect">): ProgressConfig {
  return {
    value: 0,
    direction: inferProgressDirection(node.designRect.width, node.designRect.height),
    reverse: false,
  };
}

/** 读取进度控件配置，同时兼容没有 progress 字段的旧工程。 */
export function progressConfig(node: Pick<UINode, "designRect" | "progress">): ProgressConfig {
  const fallback = defaultProgressConfig(node);
  return {
    value: clampProgressValue(node.progress?.value ?? fallback.value),
    direction: node.progress?.direction === "vertical" ? "vertical" : node.progress?.direction === "horizontal" ? "horizontal" : fallback.direction,
    reverse: node.progress?.reverse === true,
  };
}
