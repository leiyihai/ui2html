// PSD 导入：ag-psd readPsd → UIScene（层级化）
// 文件夹 → 组节点（尺寸 = 组内所有图层合并后的外接矩形；子节点坐标相对组原点，
// 保证视觉位置不变）；叶子 → 图片节点；文本图层 → 文本节点。
// 坐标统一为 Top-Left 系统（PSD 本身就是）。

import { readPsd, type Layer } from "ag-psd";
import type { CtrlType, ListConfig, ListType, UINode, UIScene } from "./types";

let layerIdSeq = 1;

function inferAnchor(x: number, y: number, w: number, h: number, dw: number, dh: number) {
  const dl = x, dr = dw - (x + w), dt = y, db = dh - (y + h);
  let px = dl <= dr ? 0 : 1;
  if (dl > dw * 0.3 && dr > dw * 0.3) px = 0.5;
  let py = dt <= db ? 0 : 1;
  if (dt > dh * 0.3 && db > dh * 0.3) py = 0.5;
  return { px, py, ox: x - px * dw, oy: y - py * dh };
}

/** 收集子树所有叶子图层的文档坐标矩形（组对象自身不收集——ag-psd 组 left/top 是虚拟 0 值） */
function collectRects(layers: Layer[], out: { x: number; y: number; w: number; h: number }[]) {
  for (const l of layers) {
    if (l.children && l.children.length) {
      collectRects(l.children, out); // 组：递归子图层，跳过组自身矩形
    } else if (l.left != null && l.top != null && l.right != null && l.bottom != null) {
      out.push({ x: l.left, y: l.top, w: l.right - l.left, h: l.bottom - l.top });
    }
  }
}

/** 合并多个矩形为外接矩形（组内容尺寸检测） */
function mergeRects(rects: { x: number; y: number; w: number; h: number }[]) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function textColor(layer: Layer): string {
  const c = layer.text?.style?.fillColor ?? layer.text?.styleRuns?.[0]?.style?.fillColor;
  if (!c) return "#ffffff";
  if (typeof c === "string") return c;
  // ag-psd 的 r/g/b 已是 0..255，直接使用（不要 ×255，否则深色溢出成白色）
  const v = c as { r: number; g: number; b: number; a?: number };
  if (v.a != null && v.a < 0.999) {
    return `rgba(${Math.round(v.r)},${Math.round(v.g)},${Math.round(v.b)},${v.a})`;
  }
  return `rgb(${Math.round(v.r)},${Math.round(v.g)},${Math.round(v.b)})`;
}

/** 检测启用的图层样式（投影/内阴影/发光/描边等），返回名称列表 */
function enabledEffects(layer: Layer): string[] {
  const e = layer.effects as any;
  if (!e) return [];
  const map: [string, string][] = [
    ["dropShadow", "投影"], ["innerShadow", "内阴影"], ["outerGlow", "外发光"],
    ["innerGlow", "内发光"], ["bevelEmboss", "斜面浮雕"], ["stroke", "描边"], ["satin", "光泽"],
  ];
  const on: string[] = [];
  for (const [k, name] of map) {
    const v = e[k];
    if (v && (v as any).enabled && (v as any).present !== false) on.push(name);
  }
  return on;
}

/** 兜底栅格化：无像素的矢量 shape 图层，用路径 + 纯色填充渲染（尽力而为） */
function rasterizeVector(layer: Layer, w: number, h: number): HTMLCanvasElement | null {
  const fill = layer.vectorFill as any;
  const paths = layer.vectorMask?.paths;
  if (!fill || fill.type !== "color" || !paths?.length || !w || !h) return null;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  const col = fill.color as { r: number; g: number; b: number; a?: number };
  g.fillStyle = col.a != null && col.a < 0.999
    ? `rgba(${Math.round(col.r)},${Math.round(col.g)},${Math.round(col.b)},${col.a})`
    : `rgb(${Math.round(col.r)},${Math.round(col.g)},${Math.round(col.b)})`;
  for (const p of paths) {
    g.beginPath();
    const knots = (p as any).knots as { point: { x: number; y: number }; left?: { x: number; y: number }; right?: { x: number; y: number } }[];
    if (!knots?.length) continue;
    knots.forEach((k, i) => {
      if (i === 0) g.moveTo(k.point.x, k.point.y);
      else if (k.left && knots[i - 1].right) {
        g.bezierCurveTo(knots[i - 1].right!.x, knots[i - 1].right!.y, k.left.x, k.left.y, k.point.x, k.point.y);
      } else g.lineTo(k.point.x, k.point.y);
    });
    g.closePath();
    g.fill();
  }
  return c;
}

/** list 配置推断：文件夹名为 list 时，按 li 项的 PSD 分布推断类型/间距/边距 */
function inferList(children: UINode[], mergedW: number, mergedH: number): ListConfig {
  const lis = children.filter((c) => c.children && c.name.toLowerCase() !== "list");
  const xs = lis.map((l) => l.designRect.x), ys = lis.map((l) => l.designRect.y);
  const x2 = lis.map((l) => l.designRect.x + l.designRect.width);
  const y2 = lis.map((l) => l.designRect.y + l.designRect.height);
  const horizSpread = Math.max(...x2) - Math.min(...xs);
  const vertSpread = Math.max(...y2) - Math.min(...ys);
  const sortedX = [...lis].sort((a, b) => a.designRect.x - b.designRect.x);
  const gapsX = sortedX.slice(1).map((l, i) => l.designRect.x - (sortedX[i].designRect.x + sortedX[i].designRect.width));
  const sortedY = [...lis].sort((a, b) => a.designRect.y - b.designRect.y);
  const gapsY = sortedY.slice(1).map((l, i) => l.designRect.y - (sortedY[i].designRect.y + sortedY[i].designRect.height));
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const type: ListType = vertSpread > horizSpread ? "vertical" : "horizontal";
  const spacing = Math.max(0, Math.round(type === "vertical" ? avg(gapsY) : avg(gapsX)));
  return {
    type,
    spacing,
    padding: {
      left: Math.max(0, Math.round(Math.min(...xs))),
      right: Math.max(0, Math.round(mergedW - Math.max(...x2))),
      top: Math.max(0, Math.round(Math.min(...ys))),
      bottom: Math.max(0, Math.round(mergedH - Math.max(...y2))),
    },
    columns: 3,
  };
}

/** 按文件夹/图层命名推断默认控件类型（辅助标记，界面中的标记优先并覆盖） */
function inferCtrl(name: string, isGroup: boolean, hasCanvas: boolean): CtrlType | undefined {
  const nm = name.trim().toLowerCase();
  if (isGroup) {
    if (/^(li\d*|listitem\d*)$/i.test(nm)) return "Layout";
    if (/^listh(?:_|$)/i.test(nm)) return "ListHorizontal";
    if (/^listv(?:_|$)/i.test(nm)) return "List";
    if (/^grid(?:_|$)/i.test(nm)) return "GridView";
    if (/^layout(?:_|$)/i.test(nm)) return "Layout";
    if (/^pbar(?:_|$)/i.test(nm)) return "ProgressBar";
    if (/^btn(?:_|$)/i.test(nm)) return "Button";
    if (/^chb(?:_|$)/i.test(nm)) return "CheckBox";
    if (/^radio(?:_|$)/i.test(nm)) return "RadioButton";
    if (/^slider(?:_|$)/i.test(nm)) return "Slider";
    if (/^edit(?:_|$)/i.test(nm)) return "Edit";
    return undefined; // 其他文件夹：未标记（手动设空节点等）
  }
  if (hasCanvas) return "StaticImage";
  // icon/img 开头的图层名也默认图片
  if (/^(icon|img)(_|$)/i.test(nm)) return "StaticImage";
  return undefined;
}

function toNode(layer: Layer, baseX: number, baseY: number, refW: number, refH: number,
  counter: { n: number }, warnings: string[], compCanvas: HTMLCanvasElement | null): UINode | null {
  const i = counter.n++;
  const name = layer.name || `Layer ${i}`;
  const base = { id: `node-${layerIdSeq++}`, name, scale: { x: 1, y: 1 }, rotation: 0,
    opacity: layer.opacity ?? 1, visible: !(layer.hidden ?? false) };

  // 文件夹 → 组节点
  if (layer.children && layer.children.length) {
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    collectRects(layer.children, rects);
    const merged = mergeRects(rects);
    if (!merged) { warnings.push(`跳过空文件夹「${name}」`); return null; }
    const children = layer.children
      .map((ch) => toNode(ch, merged.x, merged.y, merged.w, merged.h, counter, warnings, compCanvas))
      .filter((n): n is UINode => !!n);
    if (!children.length) { warnings.push(`跳过文件夹「${name}」：无可显示图层`); return null; }
    const isFullscreen = merged.x <= 0 && merged.y <= 0 && merged.w >= refW && merged.h >= refH;
    // 锚点推断必须用「相对父组原点」的坐标（文档坐标 - baseX/baseY），否则组内定位跑偏
    const { px, py, ox, oy } = inferAnchor(merged.x - baseX, merged.y - baseY, merged.w, merged.h, refW, refH);
    const listMatch = name.trim().toLowerCase().match(/^(listv|listh|grid)(?:_|$)/);
    const ctrlType = inferCtrl(name, true, false);
    const listType: ListType | undefined = listMatch?.[1] === "listh" ? "horizontal"
      : listMatch?.[1] === "grid" ? "grid" : listMatch?.[1] === "listv" ? "vertical" : undefined;
    return {
      ...base, image: null, children, zIndex: i,
      ...(listType ? { list: { ...inferList(children, merged.w, merged.h), type: listType } } : {}),
      ...(ctrlType ? { ctrl: { type: ctrlType } } : {}),
      designRect: { x: merged.x - baseX, y: merged.y - baseY, width: merged.w, height: merged.h },
      anchor: { parentX: px, parentY: py, selfX: 0, selfY: 0, offsetX: ox, offsetY: oy, safeArea: false },
      adaptation: { mode: isFullscreen ? "stretch" : "anchor" },
      psd: { layerId: layer.id ?? i, originalX: merged.x, originalY: merged.y, originalWidth: merged.w, originalHeight: merged.h },
    };
  }

  // 叶子：图片 / 文本
  const canvas = layer.canvas ?? null;
  const w = (layer.right ?? 0) - (layer.left ?? 0);
  const h = (layer.bottom ?? 0) - (layer.top ?? 0);
  const x = layer.left ?? 0, y = layer.top ?? 0;
  const { px, py, ox, oy } = inferAnchor(x - baseX, y - baseY, w, h, refW, refH);
  const isFullscreen = x <= 0 && y <= 0 && w >= refW && h >= refH;
  const effects = enabledEffects(layer);

  // 文本图层优先转文本节点（可编辑文字），除非带启用的图层样式（此时保留合成裁剪的样式效果）
  if (layer.text?.text && !effects.length) {
    // ag-psd 对中文文本的 fontSize 解析异常（值远小于实际），用 bbox 高度估算兜底：
    // 单行文本高 ≈ 字号 × leading(≈1.2)。fsRaw 明显小于估算一半时视为异常。
    const fsRaw = layer.text.style?.fontSize ?? layer.text.styleRuns?.[0]?.style?.fontSize ?? 0;
    const fsEst = h / 1.2;
    const fontSize = fsRaw > 0 && fsRaw >= fsEst / 2 ? fsRaw : fsEst;
    return {
      ...base, image: null, ctrl: { type: "StaticText" as CtrlType }, text: {
        content: layer.text.text,
        fontSize,
        color: textColor(layer),
        font: layer.text.style?.font?.name ?? undefined,
        mode: "auto", // 默认单行随内容延伸，可在属性面板切换
        minFontSize: Math.max(6, Math.round(fontSize * 0.5)),
      }, zIndex: i,
      designRect: { x: x - baseX, y: y - baseY, width: w, height: h },
      anchor: { parentX: px, parentY: py, selfX: 0, selfY: 0, offsetX: ox, offsetY: oy, safeArea: false },
      adaptation: { mode: "anchor" },
      psd: { layerId: layer.id ?? i, originalX: x, originalY: y, originalWidth: w, originalHeight: h },
    };
  }

  // 有图层样式 → 优先从合成图裁剪该图层区域（含栅格化后的样式效果：投影/描边/渐变）
  // 无像素的矢量 shape 也优先合成裁剪（比纯色矢量渲染精确）
  const useComposite = compCanvas && (effects.length > 0 || (!canvas && layer.vectorMask));
  const img = useComposite
    ? (() => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      const g = c.getContext("2d")!;
      g.drawImage(compCanvas, x, y, w, h, 0, 0, c.width, c.height);
      return c;
    })()
    : canvas;

  if (img) {
    return {
      ...base, image: img, ctrl: { type: "StaticImage" as CtrlType }, zIndex: i,
      designRect: { x: x - baseX, y: y - baseY, width: w, height: h },
      anchor: { parentX: px, parentY: py, selfX: 0, selfY: 0, offsetX: ox, offsetY: oy, safeArea: false },
      adaptation: { mode: isFullscreen ? "stretch" : "anchor" },
      psd: { layerId: layer.id ?? i, originalX: x, originalY: y, originalWidth: w, originalHeight: h },
    };
  }
  if (effects.length) {
    warnings.push(`图层「${name}」带启用的图层样式（${effects.join("、")}）且无法从合成图裁剪，像素不含样式效果，需要时请在 Photoshop 中栅格化图层样式`);
  }
  const raster = layer.vectorMask?.paths ? rasterizeVector(layer, w, h) : null;
  if (raster) {
    warnings.push(`图层「${name}」无像素数据，已用矢量路径兜底栅格化（仅纯色填充，样式/渐变不包含）`);
    return {
      ...base, image: raster, zIndex: i,
      designRect: { x: x - baseX, y: y - baseY, width: w, height: h },
      anchor: { parentX: px, parentY: py, selfX: 0, selfY: 0, offsetX: ox, offsetY: oy, safeArea: false },
      adaptation: { mode: "anchor" },
      psd: { layerId: layer.id ?? i, originalX: x, originalY: y, originalWidth: w, originalHeight: h },
    };
  }
  warnings.push(`跳过图层「${name}」：无像素数据（矢量/智能对象等），请在 Photoshop 中栅格化图层`);
  return null;
}

export function importPsd(buffer: ArrayBuffer): { scene: UIScene; warnings: string[] } {
  const psd = readPsd(buffer);
  const warnings: string[] = [];
  const counter = { n: 0 };
  const compCanvas = psd.canvas ?? null; // PSD 合成图（含图层样式效果）
  // "9" 文件夹（设计约定）：内部的图片是九宫格替换源，不进入场景布局
  const sliceSources: { name: string; canvas: HTMLCanvasElement }[] = [];
  const topLayers = psd.children ?? [];
  const nodes: UINode[] = [];
  for (const layer of topLayers) {
    if (layer.children?.length && /^9$/.test((layer.name ?? "").trim())) {
      collectSliceSources(layer.children, sliceSources, warnings);
      continue;
    }
    const n = toNode(layer, 0, 0, psd.width, psd.height, counter, warnings, compCanvas);
    if (n) {
      // 顶层文件夹 = 根节点（默认空节点，用于组织层级）
      if (n.children?.length && !n.ctrl) n.ctrl = { type: "empty" };
      nodes.push(n);
    }
  }
  return {
    scene: { designWidth: psd.width, designHeight: psd.height, nodes, sliceSources },
    warnings,
  };
}

/** 收集 "9" 文件夹内的图片（叶子 canvas，递归嵌套） */
function collectSliceSources(layers: Layer[], out: { name: string; canvas: HTMLCanvasElement }[], warnings: string[]) {
  for (const l of layers) {
    if (l.children?.length) {
      collectSliceSources(l.children, out, warnings);
    } else if (l.canvas) {
      out.push({ name: l.name ?? "unnamed", canvas: l.canvas });
    } else {
      warnings.push(`九宫格源「${l.name}」无像素数据，跳过`);
    }
  }
}
