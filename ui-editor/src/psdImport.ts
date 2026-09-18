// PSD 导入：ag-psd readPsd → UIScene（层级化）
// 文件夹 → 组节点（尺寸 = 组内所有图层合并后的外接矩形；子节点坐标相对组原点，
// 保证视觉位置不变）；叶子 → 图片节点；文本图层 → 文本节点。
// 坐标统一为 Top-Left 系统（PSD 本身就是）。

import { readPsd, type Layer } from "ag-psd";
import type { CtrlType, UINode, UIScene } from "./types";
import { defaultFolderCtrlType } from "./controlType";
import { ENGINE_EDITOR_FONT_FAMILY } from "./engineFont";
import { resolvePsdFont } from "./fontResolution";
import { cropImportedSceneImages } from "./imageImport";
import { ensureRootLayout } from "./layoutValues";

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

function colorToCss(c: unknown): string {
  if (!c) return "#ffffff";
  if (typeof c === "string") return c;
  // ag-psd 的 r/g/b 已是 0..255，直接使用（不要 ×255，否则深色溢出成白色）
  const v = c as { r: number; g: number; b: number; a?: number };
  if (v.a != null && v.a < 0.999) {
    return `rgba(${Math.round(v.r)},${Math.round(v.g)},${Math.round(v.b)},${v.a})`;
  }
  return `rgb(${Math.round(v.r)},${Math.round(v.g)},${Math.round(v.b)})`;
}

function textColor(layer: Layer): string {
  const c = layer.text?.style?.fillColor ?? layer.text?.styleRuns?.[0]?.style?.fillColor;
  return colorToCss(c);
}

interface ImportedTextSegment {
  content: string;
  style: Record<string, unknown>;
}

/**
 * ag-psd exposes rich text as contiguous UTF-16 character ranges. Only split
 * when font size or fill color actually changes; harmless duplicate runs stay
 * on the existing single-node path.
 */
function richTextSegments(layer: Layer): ImportedTextSegment[] | null {
  const text = layer.text?.text ?? "";
  const runs = layer.text?.styleRuns;
  if (!runs || runs.length < 2 || !text) return null;

  const baseStyle = (layer.text?.style ?? {}) as Record<string, unknown>;
  const segments: ImportedTextSegment[] = [];
  let offset = 0;
  for (const run of runs) {
    const length = Math.max(0, Math.min(Math.round(run.length), text.length - offset));
    if (!length) continue;
    const style = { ...baseStyle, ...((run.style ?? {}) as Record<string, unknown>) };
    segments.push({ content: text.slice(offset, offset + length), style });
    offset += length;
  }
  if (offset < text.length) segments.push({ content: text.slice(offset), style: { ...baseStyle } });
  if (segments.length < 2) return null;

  const signature = (segment: ImportedTextSegment) => `${String(segment.style.fontSize ?? "")}|${colorToCss(segment.style.fillColor)}`;
  const firstSignature = signature(segments[0]);
  return segments.some((segment) => signature(segment) !== firstSignature) ? segments : null;
}

function importedFontSize(raw: unknown, textHeight: number): number {
  const fsRaw = typeof raw === "number" ? raw : 0;
  const fsEst = textHeight / 1.2;
  const sourceFontSize = fsRaw > 0 && fsRaw >= fsEst / 2 ? fsRaw : fsEst;
  // UI2HTML 工程保留 PSD 的实际字号；离散 HTn 字号只在引擎 JSON
  // 导出阶段通过 mapToEngineFont() 处理，不能在导入阶段提前替换。
  return sourceFontSize;
}

/**
 * PSD stores a text layer's visual scale in its text transform matrix while
 * styleRuns keep the untransformed character sizes. Keep the layer bounds in
 * document pixels, but apply the matrix's vertical scale to the editor font
 * size so the imported glyphs retain the PSD appearance.
 */
function textTransformScale(layer: Layer): number {
  const transform = layer.text?.transform;
  if (!Array.isArray(transform) || transform.length < 4) return 1;
  const scaleY = Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0);
  return Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
}

/**
 * PSD 文本变换矩阵的 f 分量是文本的原始字形基线位置。
 * 保存它的文档坐标值，渲染时再换算到当前画布坐标，避免替换字体后
 * 仅按新字体的 ascent/descent 重新对齐而产生上下漂移。
 */
function textTransformBaseline(layer: Layer): number | undefined {
  const transform = layer.text?.transform;
  if (!Array.isArray(transform) || transform.length < 6) return undefined;
  const baseline = Number(transform[5]);
  return Number.isFinite(baseline) ? baseline : undefined;
}

function estimateTextWidth(content: string, fontSize: number, font = ENGINE_EDITOR_FONT_FAMILY): number {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context && typeof context.measureText === "function") {
      context.font = `${fontSize}px "${font}"`;
      const measured = context.measureText(content).width;
      if (Number.isFinite(measured) && measured > 0) return measured;
    }
  }
  return Math.max(1, [...content].length * fontSize * 0.6);
}

function listConfigFor(type: CtrlType) {
  if (type !== "List" && type !== "ListHorizontal" && type !== "GridView") return undefined;
  return {
    type: type === "GridView" ? "grid" as const : type === "ListHorizontal" ? "horizontal" as const : "vertical" as const,
    spacing: 0,
    padding: { left: 0, right: 0, top: 0, bottom: 0 },
    columns: 3,
    sizeConfirmed: false,
  };
}

/** 检测启用的图层样式（投影/内阴影/发光/描边等），返回名称列表 */
function enabledEffects(layer: Layer): string[] {
  const e = layer.effects as any;
  if (!e || e.disabled) return [];
  const map: [string, string][] = [
    ["dropShadow", "投影"], ["innerShadow", "内阴影"], ["outerGlow", "外发光"],
    ["innerGlow", "内发光"], ["bevel", "斜面浮雕"], ["solidFill", "颜色叠加"],
    ["gradientOverlay", "渐变叠加"], ["patternOverlay", "图案叠加"], ["stroke", "描边"], ["satin", "光泽"],
  ];
  const isEnabled = (value: unknown) => {
    if (Array.isArray(value)) return value.some((item) => item && (item as any).enabled === true && (item as any).present !== false);
    return Boolean(value && (value as any).enabled === true && (value as any).present !== false);
  };
  const on: string[] = [];
  for (const [k, name] of map) {
    const v = e[k];
    if (isEnabled(v)) on.push(name);
  }
  return on;
}

function hasSpecialSource(layer: Layer): boolean {
  return Boolean(layer.vectorMask || layer.vectorFill || layer.vectorStroke || layer.placedLayer);
}

/** 从 PSD 合成图生成独立图层像素，并用图层自身透明度限制范围，避免把邻近图层一起带入节点。 */
function cropCompositeImage(compCanvas: HTMLCanvasElement, x: number, y: number, w: number, h: number,
  mask: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext("2d")!;
  g.drawImage(compCanvas, x, y, w, h, 0, 0, c.width, c.height);
  if (mask) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-over";
  }
  return c;
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

function toNode(layer: Layer, baseX: number, baseY: number, refW: number, refH: number,
  counter: { n: number }, warnings: string[], compCanvas: HTMLCanvasElement | null,
  isRoot = false): UINode | UINode[] | null {
  const i = counter.n++;
  const name = layer.name || `Layer ${i}`;
  const base = { id: `node-${layerIdSeq++}`, name, originalName: name, scale: { x: 1, y: 1 }, rotation: 0,
    opacity: layer.opacity ?? 1, visible: !(layer.hidden ?? false) };

  // 文件夹 → 组节点
  if (layer.children) {
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    collectRects(layer.children, rects);
    const merged = mergeRects(rects) ?? { x: baseX, y: baseY, w: 0, h: 0 };
    const children = layer.children.flatMap((ch) => {
      const result = toNode(ch, merged.x, merged.y, Math.max(1, merged.w), Math.max(1, merged.h), counter, warnings, compCanvas, false);
      if (!result) return [];
      return Array.isArray(result) ? result : [result];
    });
    const isFullscreen = merged.x <= 0 && merged.y <= 0 && merged.w >= refW && merged.h >= refH;
    // 锚点推断必须用「相对父组原点」的坐标（文档坐标 - baseX/baseY），否则组内定位跑偏
    const { px, py, ox, oy } = inferAnchor(merged.x - baseX, merged.y - baseY, merged.w, merged.h, refW, refH);
    const ctrlType = defaultFolderCtrlType(name, isRoot);
    return {
      ...base, image: null, children, ctrl: { type: ctrlType }, list: listConfigFor(ctrlType), zIndex: i,
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
    const segments = richTextSegments(layer);
    const textScale = textTransformScale(layer);
    const sourceBaseline = textTransformBaseline(layer);
    const makeTextNode = (segment: ImportedTextSegment, segmentIndex: number, segmentCount: number,
      segmentX: number, segmentWidth: number): UINode => {
      const segmentName = segmentCount === 1 || segmentIndex === 0 ? name : `${name}_${segmentIndex + 1}`;
      const segmentBase = segmentIndex === 0
        ? base
        : { ...base, id: `node-${layerIdSeq++}`, name: segmentName, originalName: segmentName };
      const { px: segmentPx, py: segmentPy, ox: segmentOx, oy: segmentOy } =
        inferAnchor(segmentX - baseX, y - baseY, segmentWidth, h, refW, refH);
      const fontSize = importedFontSize(segment.style.fontSize, h) * textScale;
      const horizontalAlign = segmentCount === 1
        ? "center" as const
        : segmentIndex === 0 ? "right" as const : segmentIndex === segmentCount - 1 ? "left" as const : "center" as const;
      return {
        ...segmentBase,
        image: null,
        ctrl: { type: "StaticText" as CtrlType },
        text: {
          content: segment.content,
          fontSize,
          color: colorToCss(segment.style.fillColor ?? textColor(layer)),
          // PSD 字体可用时保留原字体；当前编辑器不可用时回退到 DroidSans。
          font: resolvePsdFont(segment.style.font),
          // PSD 文字框的高度和位置属于视觉快照，必须保留原框；auto
          // 会在布局阶段把高度改成字号 × 行高，导致文字整体下移。
          // 用户仍可在属性面板手动切换到 auto/fit。
          mode: "fixed",
          minFontSize: Math.max(6, Math.round(fontSize * 0.5)),
          textColor: colorToCss(segment.style.fillColor ?? textColor(layer)),
          horizontalAlign,
          // PSD 同一文字层的不同字号共享同一条字形底线。
          verticalAlign: segmentCount > 1 ? "bottom" : "center",
          wordWrap: false,
          selfAdaptHeight: false,
          shadow: false,
          shadowColor: "#000000",
          border: false,
          borderColor: "#000000",
          scale: 1,
          lineExtraSpace: 0,
          autoOmission: false,
        },
        zIndex: i,
        designRect: { x: segmentX - baseX, y: y - baseY, width: segmentWidth, height: h },
        anchor: { parentX: segmentPx, parentY: segmentPy, selfX: 0, selfY: 0, offsetX: segmentOx, offsetY: segmentOy, safeArea: false },
        adaptation: { mode: "anchor" },
        psd: {
          layerId: layer.id ?? i,
          originalX: segmentX,
          originalY: y,
          originalWidth: segmentWidth,
          originalHeight: h,
          originalBaseline: sourceBaseline,
        },
      };
    };

    if (segments) {
      const widths = segments.map((segment) => estimateTextWidth(segment.content,
        importedFontSize(segment.style.fontSize, h) * textScale, resolvePsdFont(segment.style.font)));
      const totalWidth = widths.reduce((sum, width) => sum + width, 0) || segments.length;
      const splitNodes: UINode[] = [];
      let cursor = x;
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segmentWidth = segmentIndex === segments.length - 1
          ? Math.max(0, x + w - cursor)
          : w * widths[segmentIndex] / totalWidth;
        splitNodes.push(makeTextNode(segments[segmentIndex], segmentIndex, segments.length, cursor, segmentWidth));
        cursor += segmentWidth;
      }
      warnings.push(`文字图层「${name}」包含多种字号或颜色，已拆分为 ${splitNodes.length} 个文字控件`);
      return splitNodes;
    }

    // ag-psd 对中文文本的 fontSize 解析异常（值远小于实际），用 bbox 高度估算兜底。
    const fontSize = importedFontSize(layer.text.style?.fontSize ?? layer.text.styleRuns?.[0]?.style?.fontSize, h) * textScale;
    return makeTextNode({
      content: layer.text.text,
      style: {
        fillColor: textColor(layer),
        fontSize,
        font: layer.text.style?.font,
      },
    }, 0, 1, x, w);
  }

  // 导入时自动“栅格化”特殊图层：
  // - Photoshop 已经提供独立像素时，优先使用图层自己的 canvas，避免残留的矢量/智能对象元数据把判断带回旧分支；
  // - 只有启用图层样式时，才从 PSD 合成图取样式结果，并用图层像素作蒙版隔离邻近图层；
  // - 没有独立像素的矢量/智能对象，使用合成图裁剪作为最终像素兜底。
  const specialSource = hasSpecialSource(layer);
  const useComposite = Boolean(compCanvas && effects.length > 0);
  const img = useComposite
    ? cropCompositeImage(compCanvas!, x, y, w, h, canvas)
    : canvas ?? (specialSource && compCanvas ? cropCompositeImage(compCanvas, x, y, w, h, null) : null);

  if (specialSource && canvas && !useComposite) {
    warnings.push(`图层「${name}」已按自身像素结果导入，忽略残留的矢量/智能对象元数据`);
  } else if (useComposite && canvas) {
    warnings.push(`图层「${name}」已栅格化图层样式，并按图层像素范围裁切`);
  } else if (specialSource && !canvas && compCanvas) {
    warnings.push(`图层「${name}」无独立像素，已使用 PSD 合成结果自动栅格化`);
  }

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
    warnings.push(`图层「${name}」带启用的图层样式（${effects.join("、")}），但未找到可用像素结果`);
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
  const topLayers = psd.children ?? [];
  const nodes: UINode[] = [];
  for (const layer of topLayers) {
    const result = toNode(layer, 0, 0, psd.width, psd.height, counter, warnings, compCanvas, true);
    if (result) nodes.push(...(Array.isArray(result) ? result : [result]));
  }
  const scene = cropImportedSceneImages({ designWidth: psd.width, designHeight: psd.height, nodes, sliceSources: [] }, warnings);
  if (scene.nodes.length === 1 && scene.nodes[0].ctrl?.type === "Layout"
    && scene.nodes[0].designRect.width === psd.width && scene.nodes[0].designRect.height === psd.height) {
    ensureRootLayout(scene.nodes[0], psd.width, psd.height);
  }
  return { scene, warnings };
}
