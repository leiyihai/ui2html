import type { LayoutValue, LayoutValueMode, NodeLayoutValues, UINode } from "./types";

export function absoluteLayoutValue(value: number): LayoutValue {
  return { mode: "absolute", relative: 0, absolute: value };
}

export function relativeLayoutValue(value: number): LayoutValue {
  return { mode: "relative", relative: value, absolute: 0 };
}

export function resolveLayoutValue(value: LayoutValue | undefined, parentSize: number, fallback: number): number {
  if (!value) return fallback;
  return parentSize * value.relative + value.absolute;
}

export function layoutValueFor(node: UINode, key: keyof NodeLayoutValues, _parentSize: number, fallback: number): LayoutValue {
  const value = node.layout?.[key];
  if (value) return value;
  return absoluteLayoutValue(fallback);
}

/** 将当前视觉值规范化成单一 UI 面板模式，同时保留引擎公式的形状。 */
export function normalizeLayoutValue(
  mode: LayoutValueMode,
  current: number,
  parentSize: number,
): LayoutValue {
  if (mode === "relative") {
    return relativeLayoutValue(parentSize > 0 ? current / parentSize : 0);
  }
  return absoluteLayoutValue(current);
}

export function setNodeLayoutValue(
  node: UINode,
  key: keyof NodeLayoutValues,
  mode: LayoutValueMode,
  value: number,
): void {
  node.layout = {
    x: node.layout?.x ?? absoluteLayoutValue(node.anchor.offsetX),
    y: node.layout?.y ?? absoluteLayoutValue(node.anchor.offsetY),
    width: node.layout?.width ?? absoluteLayoutValue(node.designRect.width),
    height: node.layout?.height ?? absoluteLayoutValue(node.designRect.height),
    ...node.layout,
    [key]: mode === "relative" ? relativeLayoutValue(value) : absoluteLayoutValue(value),
  };
}

/** 锚点/画布拖动后同步位置字段，保持 UI 面板当前的绝对/相对模式不变。 */
export function syncNodeLayoutPosition(node: UINode, parentWidth: number, parentHeight: number): void {
  if (!node.layout) return;
  const position = (value: LayoutValue, current: number, size: number): LayoutValue => value.mode === "relative"
    ? { ...value, relative: size > 0 ? current / size : 0, absolute: 0 }
    : { ...value, relative: 0, absolute: current };
  node.layout = {
    ...node.layout,
    x: position(node.layout.x, node.anchor.offsetX, parentWidth),
    y: position(node.layout.y, node.anchor.offsetY, parentHeight),
  };
}

export function ensureRootLayout(node: UINode, designWidth: number, designHeight: number): void {
  node.layout = {
    x: relativeLayoutValue(0),
    y: relativeLayoutValue(0),
    width: relativeLayoutValue(1),
    height: relativeLayoutValue(1),
  };
  node.designRect = { x: 0, y: 0, width: designWidth, height: designHeight };
  node.anchor = { ...node.anchor, parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0 };
}
