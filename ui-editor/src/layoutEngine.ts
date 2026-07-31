// LayoutEngine：独立布局计算（UIScene + LayoutContext → LayoutResult）
// Renderer 不负责布局。整体缩放策略（LayoutContext.scaleMode）：
//   contain：min(宽比, 高比)，完整显示 + letterbox（默认）
//   width  ：按宽度等比（scale = vw/dw），垂直方向 letterbox
//   height ：按高度等比（scale = vh/dh），水平方向 letterbox
//   fill   ：宽高各自适配（scaleX=vw/dw, scaleY=vh/dh），铺满、非等比时拉伸
// 节点模式：
//   anchor  ：节点在设计画布内定位（parent anchor + offset，设计像素），整体 ×scale
//   scale   ：整体等比（位置与尺寸都 ×scale，画布居中）
//   stretch ：填满容器（viewport 或 safe area）

import type { LayoutContext, LayoutResult, UINode } from "./types";

export class LayoutEngine {
  layoutScene(scene: { designWidth: number; designHeight: number; nodes: UINode[] }, ctx: LayoutContext): LayoutResult {
    const dw = scene.designWidth, dh = scene.designHeight;
    const vw = ctx.viewportWidth, vh = ctx.viewportHeight;

    let scaleX: number, scaleY: number;
    switch (ctx.scaleMode ?? "contain") {
      case "width": scaleX = scaleY = vw / dw; break;
      case "height": scaleX = scaleY = vh / dh; break;
      case "fill": scaleX = vw / dw; scaleY = vh / dh; break;
      case "cover": scaleX = scaleY = Math.min(vw / dw, vh / dh); break; // 与 contain 相同等比（不裁切），锚点参照视口贴边
      default: scaleX = scaleY = Math.min(vw / dw, vh / dh);
    }
    const lx = (vw - dw * scaleX) / 2;
    const ly = (vh - dh * scaleY) / 2;

    const sa = {
      left: ctx.safeArea.left,
      top: ctx.safeArea.top,
      width: ctx.viewportWidth - ctx.safeArea.left - ctx.safeArea.right,
      height: ctx.viewportHeight - ctx.safeArea.top - ctx.safeArea.bottom,
    };

    const nodes = scene.nodes.map((node) => ({ node, rect: this.layoutNode(node, scaleX, scaleY, lx, ly, sa, ctx) }));
    return { nodes, scaleX, scaleY, letterbox: { x: lx, y: ly } };
  }

  private layoutNode(n: UINode, scaleX: number, scaleY: number, lx: number, ly: number,
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

    const w = dw * scaleX, h = dh * scaleY;

    if (n.adaptation.mode === "scale") {
      // 整体缩放：位置与尺寸都 ×scale，画布居中
      return { x: lx + n.designRect.x * scaleX, y: ly + n.designRect.y * scaleY, width: w, height: h };
    }

    // anchor 模式：节点在设计画布内的位置 = parentX×设计尺寸 + offset（设计像素），整体 ×scale
    if (n.anchor.safeArea) {
      const sw = ctx.viewportWidth - ctx.safeArea.left - ctx.safeArea.right;
      const sh = ctx.viewportHeight - ctx.safeArea.top - ctx.safeArea.bottom;
      return {
        x: ctx.safeArea.left + n.anchor.parentX * sw + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
        y: ctx.safeArea.top + n.anchor.parentY * sh + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
        width: w, height: h,
      };
    }
    if (ctx.scaleMode === "cover") {
      // cover：锚点参照视口——贴边元素跟随屏幕边缘（等比不变形，无 letterbox 留边）
      return {
        x: n.anchor.parentX * ctx.viewportWidth + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
        y: n.anchor.parentY * ctx.viewportHeight + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
        width: w, height: h,
      };
    }
    return {
      x: lx + n.anchor.parentX * ctx.designWidth * scaleX + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
      y: ly + n.anchor.parentY * ctx.designHeight * scaleY + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
      width: w, height: h,
    };
  }
}

/** 修改锚点/self 锚点时保持视觉位置不跳（offset 按布局 scale 反推为设计像素） */
export function reanchor(node: UINode, dw: number, dh: number,
  rect: { x: number; y: number; width: number; height: number },
  ctx: LayoutContext, result: LayoutResult,
  a: { parentX: number; parentY: number; selfX: number; selfY: number }) {
  const ax = rect.x + a.selfX * rect.width;
  const ay = rect.y + a.selfY * rect.height;
  if (node.anchor.safeArea) {
    const sa = ctx.safeArea;
    const sw = ctx.viewportWidth - sa.left - sa.right;
    const sh = ctx.viewportHeight - sa.top - sa.bottom;
    node.anchor.offsetX = (ax - sa.left - a.parentX * sw) / result.scaleX;
    node.anchor.offsetY = (ay - sa.top - a.parentY * sh) / result.scaleY;
  } else if (ctx.scaleMode === "cover") {
    node.anchor.offsetX = (ax - a.parentX * ctx.viewportWidth) / result.scaleX;
    node.anchor.offsetY = (ay - a.parentY * ctx.viewportHeight) / result.scaleY;
  } else {
    node.anchor.offsetX = (ax - result.letterbox.x) / result.scaleX - a.parentX * dw;
    node.anchor.offsetY = (ay - result.letterbox.y) / result.scaleY - a.parentY * dh;
  }
  node.anchor.parentX = a.parentX;
  node.anchor.parentY = a.parentY;
  node.anchor.selfX = a.selfX;
  node.anchor.selfY = a.selfY;
}
