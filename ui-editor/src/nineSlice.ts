import type { NineSliceCandidate, NineSliceGroup, NineSliceMargins, UIScene, UINode } from "./types";

export interface NineSliceImageEntry {
  node: UINode;
  image: HTMLCanvasElement;
  assetKey: string;
  signature: string;
}

/** 解析九宫格批量边距：单值复制到四边，四值顺序为上、下、左、右。 */
export function parseBulkMargins(input: string, width: number, height: number): NineSliceMargins | null {
  const values = input.trim().split(/[,，\s]+/).filter(Boolean).map(Number);
  if ((values.length !== 1 && values.length !== 4) || values.some((value) => !Number.isInteger(value) || value < 0)) return null;
  const [top, bottom, left, right] = values.length === 1 ? [values[0], values[0], values[0], values[0]] : values;
  if (left + right > Math.max(0, width - 1) || top + bottom > Math.max(0, height - 1)) return null;
  return { left, top, right, bottom };
}

const CANDIDATE_HINT = /(panel|border|button|background|back|frame|window|dialog|bar|track|底|背景|面板|边框|按钮|窗口|框)/i;
const EXCLUDED_HINT = /(icon|logo|avatar|角色|头像|图标|装饰|effect|arrow|star)/i;
const SAMPLE_SIZE = 16;

export function collectNineSliceImages(scene: UIScene): NineSliceImageEntry[] {
  const nodes = new Map<string, UINode>();
  const visit = (items: UINode[]) => items.forEach((node) => {
    if (nodes.has(node.id)) return;
    nodes.set(node.id, node);
    if (node.children) visit(node.children);
    for (const binding of Object.values(node.resources ?? {})) if (binding) visit([binding.sourceNode]);
  });
  visit(scene.nodes);
  return [...nodes.values()]
    .filter((node): node is UINode & { image: HTMLCanvasElement } => Boolean(node.image && node.image.width > 0 && node.image.height > 0))
    .map((node) => ({
      node,
      image: node.image,
      assetKey: imageAssetKey(node.image),
      signature: imageSignature(node.image),
    }));
}

/** 结果页返回标记页时，保留仍存在于工程中的已处理节点选中状态。 */
export function retainKnownNineSliceSelection(selectedIds: string[], entries: NineSliceImageEntry[]): string[] {
  const knownIds = new Set(entries.map((entry) => entry.node.id));
  return selectedIds.filter((id) => knownIds.has(id));
}

/** 候选展示排序：先看扫描出的可拉伸置信度，再看名称语义，最后让同组大图优先。 */
export function rankNineSliceEntries(entries: NineSliceImageEntry[], candidates: NineSliceCandidate[]): NineSliceImageEntry[] {
  const rank = (entry: NineSliceImageEntry) => {
    const candidate = candidates.find((item) => item.memberNodeIds.includes(entry.node.id));
    const name = [entry.node.name, entry.node.originalName, entry.node.assetName].filter(Boolean).join(" ");
    const nameRelevance = (CANDIDATE_HINT.test(name) ? 1 : 0) - (EXCLUDED_HINT.test(name) ? 1 : 0);
    return {
      confidence: candidate?.confidence ?? 0,
      nameRelevance,
      source: candidate?.sourceNodeId === entry.node.id ? 1 : 0,
      area: entry.image.width * entry.image.height,
    };
  };
  return [...entries].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    return b.confidence - a.confidence
      || b.nameRelevance - a.nameRelevance
      || b.source - a.source
      || b.area - a.area
      || left.node.name.localeCompare(right.node.name)
      || left.node.id.localeCompare(right.node.id);
  });
}

/** 资源内容键：优先使用 PNG 数据，测试/损坏 Canvas 则退回尺寸。 */
export function imageAssetKey(image: HTMLCanvasElement): string {
  try { return image.toDataURL("image/png"); }
  catch { return `canvas:${image.width}x${image.height}`; }
}

/** 去透明边缘后采样为固定网格，让同一视觉内容的不同尺寸可以归组。 */
export function imageSignature(image: HTMLCanvasElement): string {
  try {
    const context = image.getContext("2d");
    if (!context) return `${image.width}x${image.height}`;
    const pixels = context.getImageData(0, 0, image.width, image.height);
    const { data, width, height } = pixels;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX || maxY < minY) return "transparent";
    const values: string[] = [];
    const spanW = Math.max(1, maxX - minX + 1);
    const spanH = Math.max(1, maxY - minY + 1);
    for (let sy = 0; sy < SAMPLE_SIZE; sy++) {
      const y = minY + Math.min(spanH - 1, Math.floor((sy + 0.5) * spanH / SAMPLE_SIZE));
      for (let sx = 0; sx < SAMPLE_SIZE; sx++) {
        const x = minX + Math.min(spanW - 1, Math.floor((sx + 0.5) * spanW / SAMPLE_SIZE));
        const offset = (y * width + x) * 4;
        values.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
          .map((value) => Math.round(value / 16).toString(16)).join(""));
      }
    }
    return `${Math.round((maxX - minX + 1) / width * 100)}:${Math.round((maxY - minY + 1) / height * 100)}:${values.join("")}`;
  } catch {
    return `${image.width}x${image.height}`;
  }
}

export function suggestedMargins(image: HTMLCanvasElement): NineSliceMargins {
  const edge = Math.max(1, Math.round(Math.min(image.width, image.height) * 0.15));
  return {
    left: Math.min(edge, Math.max(0, image.width - 2)),
    right: Math.min(edge, Math.max(0, image.width - 2)),
    top: Math.min(edge, Math.max(0, image.height - 2)),
    bottom: Math.min(edge, Math.max(0, image.height - 2)),
  };
}

interface AxisVariation {
  deviation: number;
  peakDelta: number;
  averageDelta: number;
}

interface StretchVariation {
  x: AxisVariation;
  y: AxisVariation;
}

const NO_VARIATION: AxisVariation = { deviation: 0, peakDelta: 0, averageDelta: 0 };

function profileVariation(profile: Float64Array): AxisVariation {
  if (!profile.length) return NO_VARIATION;
  let mean = 0;
  for (const value of profile) mean += value;
  mean /= profile.length;
  let square = 0;
  for (const value of profile) square += (value - mean) ** 2;
  if (profile.length < 2) return { deviation: Math.sqrt(square / profile.length) / 128, peakDelta: 0, averageDelta: 0 };
  let peakDelta = 0;
  let totalDelta = 0;
  for (let index = 1; index < profile.length; index++) {
    const delta = Math.abs(profile[index] - profile[index - 1]);
    peakDelta = Math.max(peakDelta, delta);
    totalDelta += delta;
  }
  return {
    deviation: Math.sqrt(square / profile.length) / 128,
    peakDelta,
    averageDelta: totalDelta / (profile.length - 1),
  };
}

function stretchVariation(image: HTMLCanvasElement, margins: NineSliceMargins): StretchVariation {
  try {
    const context = image.getContext("2d", { willReadFrequently: true });
    if (!context) return { x: NO_VARIATION, y: NO_VARIATION };
    const left = Math.max(0, Math.min(image.width - 1, margins.left));
    const top = Math.max(0, Math.min(image.height - 1, margins.top));
    const width = Math.max(1, image.width - margins.left - margins.right);
    const height = Math.max(1, image.height - margins.top - margins.bottom);
    const pixels = context.getImageData(left, top, width, height).data;
    const columnProfile = new Float64Array(width);
    const rowProfile = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const value = (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
        columnProfile[x] += value;
        rowProfile[y] += value;
      }
    }
    for (let index = 0; index < width; index++) columnProfile[index] /= height;
    for (let index = 0; index < height; index++) rowProfile[index] /= width;
    return { x: profileVariation(columnProfile), y: profileVariation(rowProfile) };
  } catch {
    return { x: NO_VARIATION, y: NO_VARIATION };
  }
}

function centerScale(length: number, variation: AxisVariation, hasVariation: boolean): number {
  if (!hasVariation) return 1 / length;
  // 短而明显的过渡如果也按 25% 压缩，会在结果图中退化成一条线。
  // 对这类轴保留一半中心区域，仍能明显减小资源体积，同时留下可辨认的渐变过渡。
  const preservesShortTransition = variation.peakDelta >= 4
    && variation.peakDelta >= Math.max(1, variation.averageDelta * 3);
  return preservesShortTransition ? 0.5 : 0.25;
}

/** 生成用于引擎九宫格的紧凑源图；整体纯色压成 1px，渐变轴按变化特征保留 25% 或 50%。 */
export function generateNineSliceImage(image: HTMLCanvasElement, margins: NineSliceMargins): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !image.width || !image.height) return null;
  const left = Math.max(0, Math.min(margins.left, image.width - 1));
  const right = Math.max(0, Math.min(margins.right, image.width - left - 1));
  const top = Math.max(0, Math.min(margins.top, image.height - 1));
  const bottom = Math.max(0, Math.min(margins.bottom, image.height - top - 1));
  const centerWidth = Math.max(1, image.width - left - right);
  const centerHeight = Math.max(1, image.height - top - bottom);
  const variation = stretchVariation(image, { left, right, top, bottom });
  const hasVariation = variation.x.deviation > 0.02 || variation.y.deviation > 0.02;
  const centerScaleX = centerScale(centerWidth, variation.x, hasVariation);
  const centerScaleY = centerScale(centerHeight, variation.y, hasVariation);
  const targetWidth = left + Math.max(1, Math.round(centerWidth * centerScaleX)) + right;
  const targetHeight = top + Math.max(1, Math.round(centerHeight * centerScaleY)) + bottom;
  const output = document.createElement("canvas");
  output.width = targetWidth;
  output.height = targetHeight;
  const context = output.getContext("2d");
  if (!context) return null;
  const sx = [0, left, image.width - right, image.width];
  const sy = [0, top, image.height - bottom, image.height];
  const dx = [0, left, targetWidth - right, targetWidth];
  const dy = [0, top, targetHeight - bottom, targetHeight];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const sw = sx[col + 1] - sx[col], sh = sy[row + 1] - sy[row];
    const dw = dx[col + 1] - dx[col], dh = dy[row + 1] - dy[row];
    if (sw > 0 && sh > 0 && dw > 0 && dh > 0) context.drawImage(image, sx[col], sy[row], sw, sh, dx[col], dy[row], dw, dh);
  }
  return output;
}

function stableId(signature: string, ids: string[]): string {
  let hash = 2166136261;
  for (const char of `${signature}|${ids.join(",")}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `slice-${(hash >>> 0).toString(16)}`;
}

function memberKey(ids: string[]): string { return [...ids].sort().join("|"); }

function candidateConfidence(entries: NineSliceImageEntry[]): { confidence: number; reason: string } {
  const names = entries.map((entry) => entry.node.name).join(" ");
  const hasHint = CANDIDATE_HINT.test(names);
  const excluded = EXCLUDED_HINT.test(names);
  const sufficientlyLarge = entries.every(({ image }) => image.width >= 24 && image.height >= 12);
  if (entries.some((entry) => entry.signature === "transparent")) return { confidence: 0.05, reason: "图片没有有效像素，无法生成九宫格边距" };
  if (excluded) return { confidence: 0.12, reason: "名称更像图标或装饰资源，建议仅在确认视觉上可拉伸时手动处理" };
  if (!sufficientlyLarge) return { confidence: 0.18, reason: "图片尺寸较小，可能是图标或装饰资源" };
  if (hasHint) return { confidence: 0.82, reason: "名称提示为面板、边框、按钮底图或条形背景，且尺寸适合拉伸" };
  return { confidence: 0.56, reason: "尺寸和透明边缘特征疑似适合拉伸，请结合预览确认" };
}

function oldDecision(previous: NineSliceCandidate[], signature: string, ids: string[]): NineSliceCandidate | undefined {
  const key = memberKey(ids);
  return previous.find((item) => item.signature === signature && memberKey(item.memberNodeIds) === key);
}

/** 本地保守扫描：只推荐，不修改场景。 */
export function scanNineSliceCandidates(scene: UIScene, previous: NineSliceCandidate[] = []): NineSliceCandidate[] {
  const entries = collectNineSliceImages(scene);
  const groups = new Map<string, NineSliceImageEntry[]>();
  for (const entry of entries) groups.set(entry.signature, [...(groups.get(entry.signature) ?? []), entry]);
  const scanned = [...groups.entries()]
    .flatMap(([signature, members]) => {
      const ids = members.map((entry) => entry.node.id).sort();
      const ordered = [...members].sort((a, b) => b.image.width * b.image.height - a.image.width * a.image.height);
      const decision = candidateConfidence(members);
      const old = oldDecision(previous, signature, ids);
      const candidate: NineSliceCandidate = {
        id: old?.id ?? stableId(signature, ids),
        memberNodeIds: ids,
        sourceNodeId: ordered[0].node.id,
        sourceAssetKey: ordered[0].assetKey,
        suggestedMargins: old?.suggestedMargins ?? suggestedMargins(ordered[0].image),
        confidence: old?.confidence ?? decision.confidence,
        reason: old?.reason ?? decision.reason,
        status: old?.status ?? "suggested",
        signature,
      };
      return candidate.confidence >= 0.35 ? [candidate] : [];
    })
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  const known = new Set(scanned.map((candidate) => candidate.id));
  for (const candidate of previous) {
    if (!known.has(candidate.id) && (candidate.status !== "suggested" || candidate.signature.startsWith("manual:"))) scanned.push(candidate);
  }
  return scanned.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

export function groupFromCandidate(candidate: NineSliceCandidate, margins = candidate.suggestedMargins): NineSliceGroup {
  return {
    id: candidate.id,
    memberNodeIds: [...candidate.memberNodeIds],
    sourceNodeId: candidate.sourceNodeId,
    sourceAssetKey: candidate.sourceAssetKey,
    margins: { ...margins },
    confidence: candidate.confidence,
    reason: candidate.reason,
  };
}

export function createManualNineSliceCandidate(entries: NineSliceImageEntry[]): NineSliceCandidate {
  const ordered = [...entries].sort((a, b) => b.image.width * b.image.height - a.image.width * a.image.height);
  const memberNodeIds = entries.map((entry) => entry.node.id).sort();
  const signature = `manual:${entries.map((entry) => entry.signature).sort().join("+")}`;
  return {
    id: stableId(signature, memberNodeIds),
    memberNodeIds,
    sourceNodeId: ordered[0].node.id,
    sourceAssetKey: ordered[0].assetKey,
    suggestedMargins: suggestedMargins(ordered[0].image),
    confidence: 1,
    reason: "用户手动选择的逻辑图片组",
    status: "suggested",
    signature,
  };
}

export function sameNodeSet(left: string[], right: string[]): boolean {
  return memberKey(left) === memberKey(right);
}
