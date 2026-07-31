// PSD 导入：ag-psd readPsd → UIScene
// 坐标统一为 Top-Left 系统（PSD 本身就是），Cocos 转换只在导出阶段做。

import { readPsd, type Layer } from "ag-psd";
import type { UINode, UIScene } from "./types";

let layerIdSeq = 1;

function collectLeaves(layers: Layer[], out: { layer: Layer }[] = []) {
  for (const l of layers) {
    if (l.children && l.children.length) {
      collectLeaves(l.children, out); // 组：递归子图层
    } else {
      out.push({ layer: l });
    }
  }
  return out;
}

function inferAnchor(x: number, y: number, w: number, h: number, dw: number, dh: number) {
  const dl = x, dr = dw - (x + w), dt = y, db = dh - (y + h);
  let px = dl <= dr ? 0 : 1;
  if (dl > dw * 0.3 && dr > dw * 0.3) px = 0.5;
  let py = dt <= db ? 0 : 1;
  if (dt > dh * 0.3 && db > dh * 0.3) py = 0.5;
  return { px, py, ox: x - px * dw, oy: y - py * dh };
}

export function importPsd(buffer: ArrayBuffer): { scene: UIScene; warnings: string[] } {
  const psd = readPsd(buffer);
  const warnings: string[] = [];
  const leaves = collectLeaves(psd.children ?? []);
  const nodes: UINode[] = [];

  leaves.forEach(({ layer }, i) => {
    const canvas = layer.canvas ?? null;
    if (!canvas) {
      warnings.push(`跳过图层「${layer.name}」：无像素数据（文本/智能对象/组等）`);
      return;
    }
    const w = (layer.right ?? 0) - (layer.left ?? 0);
    const h = (layer.bottom ?? 0) - (layer.top ?? 0);
    const x = layer.left ?? 0;
    const y = layer.top ?? 0;
    const rect = { x, y, width: w, height: h };
    const { px, py, ox, oy } = inferAnchor(x, y, w, h, psd.width, psd.height);
    // 全屏图层默认 stretch（背景铺满）
    const isFullscreen = x <= 0 && y <= 0 && w >= psd.width && h >= psd.height;
    nodes.push({
      id: `node-${layerIdSeq++}`,
      name: layer.name || `Layer ${i}`,
      image: canvas,
      designRect: rect,
      anchor: {
        parentX: px, parentY: py,
        selfX: 0, selfY: 0,
        offsetX: ox, offsetY: oy,
        safeArea: false,
      },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: layer.opacity ?? 1,
      visible: !(layer.hidden ?? false),
      zIndex: i, // ag-psd children 顺序：index 0 = 最底层（背景在前）→ zIndex 最小
      adaptation: { mode: isFullscreen ? "stretch" : "anchor" },
      psd: { layerId: layer.id ?? i, originalX: x, originalY: y, originalWidth: w, originalHeight: h },
    });
  });

  return {
    scene: { designWidth: psd.width, designHeight: psd.height, nodes },
    warnings,
  };
}
