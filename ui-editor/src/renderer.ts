// Canvas Renderer：只负责把 LayoutResult 画出来，不做布局计算
// uiCanvas：UI 图片；overlayCanvas：选中框 / 锚点 / Safe Area / 网格 / 设计分辨率边框

import type { LayoutResult, LayoutContext } from "./types";

export function renderUi(ctx: CanvasRenderingContext2D, result: LayoutResult) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const nodes = [...result.nodes].sort((a, b) => a.node.zIndex - b.node.zIndex); // zIndex 小(底)先画
  for (const { node, rect } of nodes) {
    if (!node.visible || !node.image) continue;
    ctx.save();
    ctx.globalAlpha = node.opacity;
    ctx.drawImage(node.image, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
}

export interface OverlayOptions {
  selectedId: string | null;
  showGrid: boolean;
  showSafeArea: boolean;
  showDesignBorder: boolean;
}

export function renderOverlay(ctx: CanvasRenderingContext2D, result: LayoutResult,
  layoutCtx: LayoutContext, opt: OverlayOptions) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const { scale, letterbox } = result;

  // 设计分辨率边框（letterbox 区域边界）
  if (opt.showDesignBorder) {
    ctx.strokeStyle = "rgba(74,144,217,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(letterbox.x, letterbox.y, layoutCtx.designWidth * scale, layoutCtx.designHeight * scale);
    ctx.setLineDash([]);
  }

  // Safe Area
  if (opt.showSafeArea) {
    const sa = layoutCtx.safeArea;
    const w = layoutCtx.viewportWidth - sa.left - sa.right;
    const h = layoutCtx.viewportHeight - sa.top - sa.bottom;
    ctx.fillStyle = "rgba(46,204,113,0.08)";
    ctx.strokeStyle = "rgba(46,204,113,0.8)";
    ctx.fillRect(sa.left, sa.top, w, h);
    ctx.strokeRect(sa.left, sa.top, w, h);
  }

  // 选中框 + 锚点
  const sel = result.nodes.find((n) => n.node.id === opt.selectedId);
  if (sel) {
    const { rect, node } = sel;
    ctx.strokeStyle = "#4a90d9";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x - 1, rect.y - 1, rect.width + 2, rect.height + 2);
    // 尺寸标签
    ctx.fillStyle = "rgba(74,144,217,0.9)";
    ctx.fillText(
      `${Math.round(rect.width)}×${Math.round(rect.height)}  ${node.name}`,
      rect.x, Math.max(0, rect.y - 4),
    );
    // 锚点十字（parent anchor 位置）
    const base = node.anchor.safeArea
      ? { x: layoutCtx.safeArea.left, y: layoutCtx.safeArea.top, w: layoutCtx.viewportWidth - layoutCtx.safeArea.left - layoutCtx.safeArea.right, h: layoutCtx.viewportHeight - layoutCtx.safeArea.top - layoutCtx.safeArea.bottom }
      : { x: 0, y: 0, w: layoutCtx.viewportWidth, h: layoutCtx.viewportHeight };
    const ax = base.x + node.anchor.parentX * base.w + node.anchor.offsetX;
    const ay = base.y + node.anchor.parentY * base.h + node.anchor.offsetY;
    ctx.strokeStyle = "rgba(230,126,34,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay);
    ctx.moveTo(ax, ay - 8); ctx.lineTo(ax, ay + 8);
    ctx.stroke();
  }
}
