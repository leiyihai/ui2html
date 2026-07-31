// LayoutEngine：独立布局计算（UIScene + LayoutContext → LayoutResult）
// Renderer 不负责布局。三种模式：
//   anchor  ：节点在设计画布内定位（parent anchor + offset，设计像素），整体 ×scale 等比
//   scale   ：整体 contain 等比（位置与尺寸都 ×scale，容器居中，letterbox）
//   stretch ：填满容器（viewport 或 safe area）

import type { LayoutContext, LayoutResult, UINode } from "./types";

export class LayoutEngine {
  layoutScene(scene: { designWidth: number; designHeight: number; nodes: UINode[] }, ctx: LayoutContext): LayoutResult {
    const dw = scene.designWidth, dh = scene.designHeight;
    // contain：保证完整显示，允许 letterbox
    const scale = Math.min(ctx.viewportWidth / dw, ctx.viewportHeight / dh);
    const lx = (ctx.viewportWidth - dw * scale) / 2;
    const ly = (ctx.viewportHeight - dh * scale) / 2;

    const sa = {
      left: ctx.safeArea.left,
      top: ctx.safeArea.top,
      width: ctx.viewportWidth - ctx.safeArea.left - ctx.safeArea.right,
      height: ctx.viewportHeight - ctx.safeArea.top - ctx.safeArea.bottom,
    };

    const nodes = scene.nodes.map((node) => ({ node, rect: this.layoutNode(node, scale, lx, ly, sa, ctx) }));
    return { nodes, scale, letterbox: { x: lx, y: ly } };
  }

  private layoutNode(n: UINode, scale: number, lx: number, ly: number,
    sa: { left: number; top: number; width: number; height: number },
    ctx: LayoutContext) {
    const dw = n.designRect.width, dh = n.designRect.height;

    if (n.adaptation.mode === "stretch") {
      const x = n.anchor.safeArea ? sa.left : 0;
      const y = n.anchor.safeArea ? sa.top : 0;
      const w = n.anchor.safeArea ? sa.width : ctx.viewportWidth;
      const h = n.anchor.safeArea ? sa.height : ctx.viewportHeight;
      return { x, y, width: w, height: h };
    }

    const w = dw * scale, h = dh * scale;

    if (n.adaptation.mode === "scale") {
      // 整体 contain：位置与尺寸都 ×scale，画布居中
      return { x: lx + n.designRect.x * scale, y: ly + n.designRect.y * scale, width: w, height: h };
    }

    // anchor 模式：节点在设计画布内的位置 = parentX×设计尺寸 + offset（设计像素），
    // 整体 ×scale 等比缩放 + letterbox；offset 随 scale 缩放（同比例切换看起来完全一致）
    if (n.anchor.safeArea) {
      const sw = ctx.viewportWidth - ctx.safeArea.left - ctx.safeArea.right;
      const sh = ctx.viewportHeight - ctx.safeArea.top - ctx.safeArea.bottom;
      return {
        x: ctx.safeArea.left + n.anchor.parentX * sw + n.anchor.offsetX * scale - n.anchor.selfX * w,
        y: ctx.safeArea.top + n.anchor.parentY * sh + n.anchor.offsetY * scale - n.anchor.selfY * h,
        width: w, height: h,
      };
    }
    return {
      x: lx + n.anchor.parentX * ctx.designWidth * scale + n.anchor.offsetX * scale - n.anchor.selfX * w,
      y: ly + n.anchor.parentY * ctx.designHeight * scale + n.anchor.offsetY * scale - n.anchor.selfY * h,
      width: w, height: h,
    };
  }
}

/** 修改锚点/self 锚点时保持视觉位置不跳（offset 按布局 scale 反推为设计像素） */
export function reanchor(node: UINode, dw: number, dh: number,
  rect: { x: number; y: number; width: number; height: number },
  ctx: LayoutContext, result: LayoutResult,
  a: { parentX: number; parentY: number; selfX: number; selfY: number }) {
  const scale = result.scale;
  const ax = rect.x + a.selfX * rect.width;
  const ay = rect.y + a.selfY * rect.height;
  if (node.anchor.safeArea) {
    const sa = ctx.safeArea;
    const sw = ctx.viewportWidth - sa.left - sa.right;
    const sh = ctx.viewportHeight - sa.top - sa.bottom;
    node.anchor.offsetX = (ax - sa.left - a.parentX * sw) / scale;
    node.anchor.offsetY = (ay - sa.top - a.parentY * sh) / scale;
  } else {
    node.anchor.offsetX = (ax - result.letterbox.x) / scale - a.parentX * dw;
    node.anchor.offsetY = (ay - result.letterbox.y) / scale - a.parentY * dh;
  }
  node.anchor.parentX = a.parentX;
  node.anchor.parentY = a.parentY;
  node.anchor.selfX = a.selfX;
  node.anchor.selfY = a.selfY;
}
