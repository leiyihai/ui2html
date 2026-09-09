import type { UIScene, UINode } from "./types";

/**
 * 找到场景级氛围背景：只看 PSD 根层级的图片，不递归进入控件文件夹，
 * 避免把面板底图、按钮底图误判成整张 UI 的背景。
 */
export function findSceneBackgroundNode(scene: Pick<UIScene, "designWidth" | "designHeight" | "nodes">): UINode | null {
  const root = scene.nodes.length === 1 ? scene.nodes[0] : undefined;
  const isCanvasRoot = root?.ctrl?.type === "Layout"
    && root.designRect.x === 0 && root.designRect.y === 0
    && root.designRect.width === scene.designWidth && root.designRect.height === scene.designHeight;
  const candidates = isCanvasRoot ? root?.children ?? [] : scene.nodes;
  const nearCanvas = candidates.filter((node) => {
    if (!node.image || node.image.width <= 0 || node.image.height <= 0) return false;
    const widthRatio = node.designRect.width / Math.max(1, scene.designWidth);
    const heightRatio = node.designRect.height / Math.max(1, scene.designHeight);
    const areaRatio = node.designRect.width * node.designRect.height
      / Math.max(1, scene.designWidth * scene.designHeight);
    return widthRatio >= 0.75 && heightRatio >= 0.75 && areaRatio >= 0.55;
  });
  return [...nearCanvas].sort((a, b) => a.zIndex - b.zIndex)[0] ?? null;
}
