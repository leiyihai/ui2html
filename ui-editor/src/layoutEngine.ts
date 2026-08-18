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

    const out: LayoutResult["nodes"] = [];
    for (const node of scene.nodes) {
      out.push(...this.layoutNode(node, scaleX, scaleY, lx, ly, sa, ctx));
    }
    return { nodes: out, scaleX, scaleY, letterbox: { x: lx, y: ly } };
  }

  /** 左上角定位（self 锚点恒为 0 的原点，list 容器/普通节点共用） */
  private anchorOrigin(n: UINode, scaleX: number, scaleY: number, lx: number, ly: number,
    ctx: LayoutContext, parentRect?: LayoutResult["nodes"][0]["rect"]) {
    if (parentRect) return {
      x: parentRect.x + n.anchor.parentX * parentRect.width + n.anchor.offsetX * scaleX,
      y: parentRect.y + n.anchor.parentY * parentRect.height + n.anchor.offsetY * scaleY,
    };
    if (n.anchor.safeArea) {
      const sw = ctx.viewportWidth - ctx.safeArea.left - ctx.safeArea.right;
      const sh = ctx.viewportHeight - ctx.safeArea.top - ctx.safeArea.bottom;
      return { x: ctx.safeArea.left + n.anchor.parentX * sw + n.anchor.offsetX * scaleX, y: ctx.safeArea.top + n.anchor.parentY * sh + n.anchor.offsetY * scaleY };
    }
    if (ctx.scaleMode === "cover") return {
      x: n.anchor.parentX * ctx.viewportWidth + n.anchor.offsetX * scaleX,
      y: n.anchor.parentY * ctx.viewportHeight + n.anchor.offsetY * scaleY,
    };
    return {
      x: lx + n.anchor.parentX * ctx.designWidth * scaleX + n.anchor.offsetX * scaleX,
      y: ly + n.anchor.parentY * ctx.designHeight * scaleY + n.anchor.offsetY * scaleY,
    };
  }

  /** list 布局：li 按类型重排（忽略 PSD 偏移），容器尺寸随内容自适应 */
  private layoutList(n: UINode, scaleX: number, scaleY: number, lx: number, ly: number,
    sa: { left: number; top: number; width: number; height: number },
    ctx: LayoutContext, parentRect?: LayoutResult["nodes"][0]["rect"],
    parentVisible = true): LayoutResult["nodes"] {
    const cfg = n.list!;
    const effVisible = n.visible && parentVisible;
    // li 项按 PSD 视觉位置排序（水平按 x、垂直/格子按 y），重排后保持原视觉顺序
    let lis = n.children!.filter((c) => c.children && c.name.toLowerCase() !== "list");
    lis = [...lis].sort((a, b) => cfg.type === "vertical"
      ? a.designRect.y - b.designRect.y
      : cfg.type === "grid"
        ? a.designRect.y - b.designRect.y || a.designRect.x - b.designRect.x
        : a.designRect.x - b.designRect.x);
    const others = n.children!.filter((c) => !c.children || c.name.toLowerCase() === "list");
    const liDims = lis.map((li) => ({ w: li.designRect.width * scaleX, h: li.designRect.height * scaleY }));
    const pad = cfg.padding;
    const spX = cfg.spacing * scaleX, spY = cfg.spacing * scaleY;
    let contentW = 0, contentH = 0;
    if (cfg.type === "horizontal") {
      contentW = liDims.reduce((s, d) => s + d.w, 0) + spX * Math.max(0, lis.length - 1);
      contentH = Math.max(0, ...liDims.map((d) => d.h));
    } else if (cfg.type === "vertical") {
      contentH = liDims.reduce((s, d) => s + d.h, 0) + spY * Math.max(0, lis.length - 1);
      contentW = Math.max(0, ...liDims.map((d) => d.w));
    } else {
      const cols = Math.max(1, Math.min(cfg.columns || 3, lis.length));
      const rows = Math.ceil(lis.length / cols);
      contentW = cols * Math.max(0, ...liDims.map((d) => d.w)) + (cols - 1) * spX;
      contentH = rows * Math.max(0, ...liDims.map((d) => d.h)) + (rows - 1) * spY;
    }
    const origin = this.anchorOrigin(n, scaleX, scaleY, lx, ly, ctx, parentRect);
    const rect: LayoutResult["nodes"][0]["rect"] = {
      x: origin.x, y: origin.y,
      width: contentW + (pad.left + pad.right) * scaleX,
      height: contentH + (pad.top + pad.bottom) * scaleY,
    };
    const out: LayoutResult["nodes"] = [{ node: n, rect, visible: effVisible }];
    let accX = pad.left * scaleX, accY = pad.top * scaleY;
    const cellW = Math.max(0, ...liDims.map((d) => d.w));
    const cellH = Math.max(0, ...liDims.map((d) => d.h));
    let i = 0;
    for (const li of lis) {
      const d = liDims[i];
      let liX: number, liY: number;
      if (cfg.type === "horizontal") { liX = accX; liY = accY; accX += d.w + spX; }
      else if (cfg.type === "vertical") { liX = accX; liY = accY; accY += d.h + spY; }
      else {
        const cols = Math.max(1, Math.min(cfg.columns || 3, lis.length));
        liX = pad.left * scaleX + (i % cols) * (cellW + spX);
        liY = pad.top * scaleY + Math.floor(i / cols) * (cellH + spY);
      }
      const liRect = { x: rect.x + liX, y: rect.y + liY, width: d.w, height: d.h };
      out.push(...this.layoutNode(li, scaleX, scaleY, lx, ly, sa, ctx, liRect, liRect, effVisible));
      i++;
    }
    // 非 li 子节点（含嵌套 list）：保持相对容器的偏移定位
    for (const o of others) out.push(...this.layoutNode(o, scaleX, scaleY, lx, ly, sa, ctx, rect, undefined, effVisible));
    return out;
  }

  private layoutNode(n: UINode, scaleX: number, scaleY: number, lx: number, ly: number,
    sa: { left: number; top: number; width: number; height: number },
    ctx: LayoutContext, parentRect?: LayoutResult["nodes"][0]["rect"],
    fixedRect?: LayoutResult["nodes"][0]["rect"],
    parentVisible = true): LayoutResult["nodes"] {
    const dw = n.designRect.width, dh = n.designRect.height;
    const effVisible = n.visible && parentVisible; // 组隐藏 → 后代全部隐藏
    let rect: LayoutResult["nodes"][0]["rect"];

    if (fixedRect) {
      rect = fixedRect; // list 重排结果：li 的矩形由父 list 决定，忽略自身 anchor
    } else if (n.adaptation.mode === "stretch") {
      const area = n.anchor.safeArea
        ? { x: sa.left, y: sa.top, width: sa.width, height: sa.height }
        : parentRect ?? { x: 0, y: 0, width: ctx.viewportWidth, height: ctx.viewportHeight };
      rect = { x: area.x, y: area.y, width: area.width, height: area.height };
    } else {
      const w = dw * scaleX, h = dh * scaleY;
      if (n.adaptation.mode === "scale") {
        rect = parentRect
          ? { x: parentRect.x + n.designRect.x * scaleX, y: parentRect.y + n.designRect.y * scaleY, width: w, height: h }
          : { x: lx + n.designRect.x * scaleX, y: ly + n.designRect.y * scaleY, width: w, height: h };
      } else if (parentRect) {
        // 组内子节点：锚点参照父组矩形
        rect = {
          x: parentRect.x + n.anchor.parentX * parentRect.width + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
          y: parentRect.y + n.anchor.parentY * parentRect.height + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
          width: w, height: h,
        };
      } else if (n.anchor.safeArea) {
        const sw = ctx.viewportWidth - ctx.safeArea.left - ctx.safeArea.right;
        const sh = ctx.viewportHeight - ctx.safeArea.top - ctx.safeArea.bottom;
        rect = {
          x: ctx.safeArea.left + n.anchor.parentX * sw + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
          y: ctx.safeArea.top + n.anchor.parentY * sh + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
          width: w, height: h,
        };
      } else if (ctx.scaleMode === "cover") {
        // cover：锚点参照视口——贴边元素跟随屏幕边缘（等比不变形，无 letterbox 留边）
        rect = {
          x: n.anchor.parentX * ctx.viewportWidth + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
          y: n.anchor.parentY * ctx.viewportHeight + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
          width: w, height: h,
        };
      } else {
        rect = {
          x: lx + n.anchor.parentX * ctx.designWidth * scaleX + n.anchor.offsetX * scaleX - n.anchor.selfX * w,
          y: ly + n.anchor.parentY * ctx.designHeight * scaleY + n.anchor.offsetY * scaleY - n.anchor.selfY * h,
          width: w, height: h,
        };
      }
    }

    if (n.children?.length) {
      if (n.list) return this.layoutList(n, scaleX, scaleY, lx, ly, sa, ctx, parentRect, effVisible);
      // 组节点自身也进入结果（可选中/拖动整体），不绘制；子节点带父组矩形参照
      const childOut: LayoutResult["nodes"] = [{ node: n, rect, visible: effVisible }];
      for (const c of n.children) childOut.push(...this.layoutNode(c, scaleX, scaleY, lx, ly, sa, ctx, rect, undefined, effVisible));
      return childOut;
    }
    return [{ node: n, rect, parent: parentRect, visible: effVisible }];
  }
}

/** 修改锚点/self 锚点时保持视觉位置不跳（offset 按布局 scale 反推为设计像素） */
export function reanchor(node: UINode, dw: number, dh: number,
  rect: { x: number; y: number; width: number; height: number },
  ctx: LayoutContext, result: LayoutResult,
  a: { parentX: number; parentY: number; selfX: number; selfY: number }) {
  const ax = rect.x + a.selfX * rect.width;
  const ay = rect.y + a.selfY * rect.height;
  const parent = result.nodes.find((r) => r.node.id === node.id)?.parent;
  if (parent) {
    // 组内子节点：参照父组矩形
    node.anchor.offsetX = (ax - parent.x - a.parentX * parent.width) / result.scaleX;
    node.anchor.offsetY = (ay - parent.y - a.parentY * parent.height) / result.scaleY;
  } else if (node.anchor.safeArea) {
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
