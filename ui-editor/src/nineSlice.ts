import type { NineSliceCandidate, NineSliceGroup, NineSliceMargins, UIScene, UINode } from "./types";

export interface NineSliceImageEntry {
  node: UINode;
  image: HTMLCanvasElement;
  assetKey: string;
  signature: string;
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
