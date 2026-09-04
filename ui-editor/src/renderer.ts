// Canvas Renderer：只负责把 LayoutResult 画出来，不做布局计算
// uiCanvas：UI 图片；overlayCanvas：选中框 / 锚点 / Safe Area / 网格 / 设计分辨率边框

import type { LayoutResult, LayoutContext, ResourceSlot, UINode } from "./types";
import { fitFontSize, wrapText, LINE_HEIGHT } from "./textMeasure";

function boundImage(node: UINode, slot: ResourceSlot): HTMLCanvasElement | null {
  return node.resources?.[slot]?.image ?? null;
}

/** 返回编辑状态下当前应显示的控件资源层，顺序为从底到顶。 */
export function visibleControlResourceImages(node: UINode): HTMLCanvasElement[] {
  const compact = (images: (HTMLCanvasElement | null)[]) => images.filter((image): image is HTMLCanvasElement => Boolean(image));
  switch (node.ctrl?.type) {
    case "Layout":
      return compact([boundImage(node, "LayoutBackImage")]);
    case "StaticImage":
      return compact([boundImage(node, "ImageName")]);
    case "Button":
    case "CheckBox":
    case "RadioButton":
      return compact([boundImage(node, "NormalImage") ?? boundImage(node, "PushedImage")]);
    case "ProgressBar":
    case "Slider":
      return compact([
        boundImage(node, "ProgressBackImage"),
        boundImage(node, "ProgressImage"),
        boundImage(node, "ProgressHeaderImage"),
      ]);
    case "Edit":
      return compact([boundImage(node, "EditBackImage")]);
    default:
      return [];
  }
}

/** 九宫格拉伸绘制：四角原尺寸、四边单轴拉伸、中心双轴拉伸 */
export function draw9Slice(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
  s: { left: number; top: number; right: number; bottom: number }) {
  const iw = img.width, ih = img.height;
  const l = Math.max(0, Math.min(s.left, iw - 1)), t = Math.max(0, Math.min(s.top, ih - 1));
  const r = Math.max(0, Math.min(s.right, iw - l - 1)), b = Math.max(0, Math.min(s.bottom, ih - t - 1));
  const sx = [0, l, iw - r, iw];
  const sy = [0, t, ih - b, ih];
  const dx = [rect.x, rect.x + l, rect.x + rect.width - r, rect.x + rect.width];
  const dy = [rect.y, rect.y + t, rect.y + rect.height - b, rect.y + rect.height];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sw = sx[i + 1] - sx[i], sh = sy[j + 1] - sy[j];
      const dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      ctx.drawImage(img, sx[i], sy[j], sw, sh, dx[i], dy[j], dw, dh);
    }
  }
}

export function renderUi(ctx: CanvasRenderingContext2D, result: LayoutResult, useSlice = false) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const minimumDescendantZ = (node: LayoutResult["nodes"][number]["node"]): number => {
    let minimum = Number.POSITIVE_INFINITY;
    const visit = (children: typeof node.children) => {
      for (const child of children ?? []) {
        minimum = Math.min(minimum, child.zIndex);
        visit(child.children);
      }
    };
    visit(node.children);
    return minimum;
  };
  const paintZ = ({ node }: LayoutResult["nodes"][number]) => node.ctrl?.type === "Layout"
    && node.resources?.LayoutBackImage
    ? Math.min(node.zIndex, minimumDescendantZ(node) - 0.001)
    : node.zIndex;
  const nodes = [...result.nodes].sort((a, b) => paintZ(a) - paintZ(b)); // zIndex 小(底)先画；Layout 底图先于自身后代
  for (const { node, rect, visible, clipRect, opacity } of nodes) {
    if (!visible) continue; // 有效可见性：组隐藏时其后代也不显示
    ctx.save();
    if (clipRect) {
      // list 容器：内容超出框的部分裁切
      ctx.beginPath();
      ctx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
      ctx.clip();
    }
    ctx.globalAlpha = opacity; // 有效透明度：父组 × 自身
    for (const resourceImage of visibleControlResourceImages(node)) {
      ctx.drawImage(resourceImage, rect.x, rect.y, rect.width, rect.height);
    }
    if (useSlice && node.sliceImage && node.slice) {
      // 九宫格替换图：按 slice 边距九宫格拉伸绘制
      draw9Slice(ctx, node.sliceImage, rect, node.slice);
    } else if (node.image) {
      ctx.drawImage(node.image, rect.x, rect.y, rect.width, rect.height);
    } else if (node.text) {
      const t = node.text;
      const scale = Math.min(result.scaleX, result.scaleY);
      const fam = t.font ? `"${t.font}", ` : "";
      ctx.save();
      // 所有模式都裁剪到 rect：auto 内容超出尺寸宽度时裁切，fixed/fit 限框内
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      let fs = t.fontSize;
      if (t.mode === "fit") {
        fs = fitFontSize(t.content, t.fontSize, t.minFontSize,
          rect.width / result.scaleX, rect.height / result.scaleY);
      }
      ctx.font = `${fs * scale}px ${fam}"PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = t.color;
      ctx.textBaseline = "top";
      if (t.mode === "auto") {
        // 单行随内容延伸，不换行不裁切
        ctx.fillText(t.content, rect.x, rect.y);
      } else {
        const lines = wrapText(t.content, fs, rect.width / result.scaleX);
        for (let li = 0; li < lines.length; li++) {
          ctx.fillText(lines[li], rect.x, rect.y + li * fs * LINE_HEIGHT * result.scaleY);
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }
}

export interface OverlayOptions {
  selectedId: string | null;
  selectedIds?: string[];
  showGrid: boolean;
  showSafeArea: boolean;
  showDesignBorder: boolean;
}

export function renderOverlay(ctx: CanvasRenderingContext2D, result: LayoutResult,
  layoutCtx: LayoutContext, opt: OverlayOptions) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const { scaleX, scaleY, letterbox } = result;

  // 设计分辨率边框（letterbox 区域边界）
  if (opt.showDesignBorder) {
    ctx.strokeStyle = "rgba(74,144,217,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(letterbox.x, letterbox.y, layoutCtx.designWidth * scaleX, layoutCtx.designHeight * scaleY);
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

  // 多选框；主选中节点使用更醒目的颜色并显示尺寸标签与锚点
  const selectedIds = opt.selectedIds?.length ? opt.selectedIds : opt.selectedId ? [opt.selectedId] : [];
  for (const selectedId of selectedIds) {
    const item = result.nodes.find((n) => n.node.id === selectedId);
    if (!item) continue;
    ctx.strokeStyle = selectedId === opt.selectedId ? "#4a90d9" : "rgba(74,144,217,0.55)";
    ctx.lineWidth = selectedId === opt.selectedId ? 2 : 1;
    ctx.strokeRect(item.rect.x - 1, item.rect.y - 1, item.rect.width + 2, item.rect.height + 2);
  }

  // 主选中节点的尺寸标签与锚点
  const sel = result.nodes.find((n) => n.node.id === opt.selectedId);
  if (sel) {
    const { rect, node } = sel;
    // 尺寸标签
    ctx.fillStyle = "rgba(74,144,217,0.9)";
    ctx.fillText(
      `${Math.round(rect.width)}×${Math.round(rect.height)}  ${node.name}`,
      rect.x, Math.max(0, rect.y - 4),
    );
    // 锚点十字（parent anchor 位置：组内子节点参照父组矩形）
    const base = sel.parent
      ? { x: sel.parent.x, y: sel.parent.y, w: sel.parent.width, h: sel.parent.height }
      : node.anchor.safeArea
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
