import type { CtrlType, ProjectAnalysis, ResourceSlot, UINode, UIScene } from "./types";
import { controlNamePrefix } from "./nodeNaming";
import { resourceSlotDefinitions } from "./resourceBinding";

export interface NamingManifestNode {
  id: string;
  name: string;
  originalName?: string;
  type: CtrlType | "unknown";
  parentId: string | null;
  depth: number;
  rect: UINode["designRect"];
  visible: boolean;
  text?: string;
  assetKey?: string;
}

export interface NamingManifestAsset {
  key: string;
  nodeIds: string[];
  width: number;
  height: number;
  sourceNames: string[];
  /** 已绑定到控件槽位的资源角色，提供给 AI 作为图片命名语义。 */
  bindings?: Array<{ controlNodeId: string; slot: ResourceSlot; slotLabel: string }>;
}

export interface NamingManifest {
  design: { width: number; height: number };
  nodes: NamingManifestNode[];
  assets: NamingManifestAsset[];
}

export interface AiNamingResult {
  nodes?: Array<{ id: string; suffix?: string; confidence?: number; reason?: string }>;
  assets?: Array<{ key: string; name?: string; confidence?: number; reason?: string }>;
}

/**
 * AI 名称的本地防线：提示词要求 AI 优先使用这些约定俗成的 UI 缩写，
 * 这里再做一次规范化，避免模型偶尔返回过长或重复表达。
 */
export const COMMON_UI_ABBREVIATIONS: Record<string, string> = {
  background: "bg",
  foreground: "fg",
  experience: "exp",
  selected: "sel",
  deselected: "unsel",
  disabled: "dis",
  enabled: "ena",
  pressed: "press",
  quantity: "qty",
  number: "num",
  message: "msg",
  navigation: "nav",
  information: "info",
  configuration: "cfg",
  character: "char",
  description: "desc",
  thumbnail: "thumb",
  preview: "prev",
  volume: "vol",
  progress: "prog",
};

export const AI_NAME_MAX_SUFFIX_LENGTH = 24;

/**
 * 返回需要在层级树中逐项提示的节点。
 *
 * 本地兜底命名是“可继续编辑/导出”的正常结果，只在底部保留汇总提示；
 * 只有已经经过 Codex 分析但置信度不足的结果才需要逐行标红，避免 AI 不可用
 * 时整棵层级树都被误显示成错误状态。
 */
export function warningNodeIds(analysis: ProjectAnalysis | null): string[] {
  if (!analysis || analysis.provider !== "codex-cli") return [];
  return Object.entries(analysis.nodes)
    .filter(([, item]) => item.source === "fallback" || (item.confidence ?? 1) < 0.5)
    .map(([id]) => id);
}

const WORDS: Record<string, string> = {
  "地图": "map", "任务": "task", "宠物": "pet", "经验": "exp", "背包": "bag", "音量": "volume",
  "发送": "send", "关闭": "close", "确定": "confirm", "取消": "cancel", "标题": "title", "名称": "name",
  "按钮": "button", "进度": "progress", "滑块": "handle", "背景": "bg", "底图": "bg", "图标": "icon",
  "头像": "avatar", "货币": "currency", "金币": "coin", "钻石": "diamond", "奖励": "reward", "列表": "list",
  "选中": "on", "未选中": "off", "正常": "normal", "按下": "pressed", "填充": "fill", "空": "empty",
  "窗口": "panel", "面板": "panel", "箭头": "arrow", "输入": "input", "文本": "text",
};

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assetKey(image: HTMLCanvasElement): string {
  try { return `asset-${hashString(`${image.width}x${image.height}:${image.toDataURL("image/png")}`)}`; }
  catch { return `asset-${image.width}x${image.height}`; }
}

export function typePrefix(type: CtrlType | undefined): string {
  return controlNamePrefix(type).replace(/_$/, "");
}

/** 只允许名称中出现英文、数字和下划线，避免最终引擎字段出现非法名称。 */
export function sanitizeSemanticName(value: string): string {
  let output = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return output || "node";
}

const GENERIC_REDUNDANT_WORDS = new Set(["ui", "control", "component", "widget", "element"]);
const ASSET_REDUNDANT_WORDS = new Set(["image", "texture", "asset"]);
const TYPE_REDUNDANT_WORDS: Partial<Record<CtrlType, Set<string>>> = {
  Button: new Set(["button"]),
  CheckBox: new Set(["check", "checkbox", "box"]),
  Edit: new Set(["edit", "input", "field"]),
  GridView: new Set(["grid", "view"]),
  Layout: new Set(["layout", "panel", "container"]),
  List: new Set(["list", "view"]),
  ListHorizontal: new Set(["list", "horizontal", "view"]),
  ProgressBar: new Set(["progress", "prog", "bar"]),
  RadioButton: new Set(["radio", "button"]),
  Slider: new Set(["slider"]),
  StaticImage: new Set(["image", "img"]),
  StaticText: new Set(["text", "label"]),
};

/**
 * 压缩 AI 返回的语义名。只处理 AI 结果，不改变 PSD 原名和本地兜底命名，
 * 这样美术仍能看到原始信息，AI 不可用时也保持既有兜底结果。
 */
export function compactSemanticName(value: string, type?: CtrlType, kind: "node" | "asset" = "node"): string {
  const sanitized = sanitizeSemanticName(value);
  const redundant = new Set(GENERIC_REDUNDANT_WORDS);
  if (kind === "asset") ASSET_REDUNDANT_WORDS.forEach((word) => redundant.add(word));
  if (type) TYPE_REDUNDANT_WORDS[type]?.forEach((word) => redundant.add(word));

  const words = sanitized.split("_")
    .map((word) => COMMON_UI_ABBREVIATIONS[word] ?? word)
    .filter((word) => !redundant.has(word));
  const output = words.join("_") || "item";
  if (output.length <= AI_NAME_MAX_SUFFIX_LENGTH) return output;

  const clipped = output.slice(0, AI_NAME_MAX_SUFFIX_LENGTH).replace(/_+$/g, "");
  const lastSeparator = clipped.lastIndexOf("_");
  return lastSeparator >= 8 ? clipped.slice(0, lastSeparator) : clipped;
}

function translateHint(value: string): string {
  let output = value.trim();
  for (const [source, target] of Object.entries(WORDS).sort((a, b) => b[0].length - a[0].length)) {
    output = output.replaceAll(source, ` ${target} `);
  }
  return sanitizeSemanticName(output);
}

function uniqueName(prefix: string, suffix: string, used: Set<string>): string {
  const base = `${prefix}_${sanitizeSemanticName(suffix)}`;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) candidate = `${base}_${index++}`;
  used.add(candidate);
  return candidate;
}

function visitNodes(nodes: UINode[], callback: (node: UINode, parentId: string | null, depth: number) => void,
  parentId: string | null = null, depth = 0) {
  for (const node of nodes) {
    callback(node, parentId, depth);
    visitNodes(node.children ?? [], callback, node.id, depth + 1);
  }
}

export function buildNamingManifest(scene: UIScene): NamingManifest {
  const nodes: NamingManifestNode[] = [];
  const assetMap = new Map<string, NamingManifestAsset>();
  const registerAsset = (
    image: HTMLCanvasElement,
    nodeId: string,
    sourceNames: string[],
    binding?: { controlNodeId: string; slot: ResourceSlot; slotLabel: string },
  ) => {
    const key = assetKey(image);
    const current = assetMap.get(key) ?? { key, nodeIds: [], width: image.width, height: image.height, sourceNames: [] };
    if (!current.nodeIds.includes(nodeId)) current.nodeIds.push(nodeId);
    for (const sourceName of sourceNames) {
      if (sourceName && !current.sourceNames.includes(sourceName)) current.sourceNames.push(sourceName);
    }
    if (binding) {
      current.bindings ??= [];
      if (!current.bindings.some((item) => item.controlNodeId === binding.controlNodeId && item.slot === binding.slot)) {
        current.bindings.push(binding);
      }
    }
    assetMap.set(key, current);
    return key;
  };
  visitNodes(scene.nodes, (node, parentId, depth) => {
    const key = node.image ? registerAsset(node.image, node.id, [node.name, node.originalName ?? ""]) : undefined;
    nodes.push({
      id: node.id, name: node.name, ...(node.originalName ? { originalName: node.originalName } : {}),
      type: node.ctrl?.type ?? "unknown", parentId, depth,
      rect: { ...node.designRect }, visible: node.visible,
      ...(node.text?.content ? { text: node.text.content.slice(0, 120) } : {}),
      ...(key ? { assetKey: key } : {}),
    });
    for (const [slotKey, binding] of Object.entries(node.resources ?? {})) {
      if (!binding) continue;
      const image = binding.sourceNode.image ?? binding.image;
      if (!image) continue;
      const slot = slotKey as ResourceSlot;
      const slotLabel = resourceSlotDefinitions(node.ctrl?.type).find((definition) => definition.key === slot)?.label ?? slot;
      registerAsset(image, binding.sourceNode.id, [binding.sourceNode.name, binding.sourceNode.originalName ?? ""], {
        controlNodeId: node.id, slot, slotLabel,
      });
    }
  });
  return { design: { width: scene.designWidth, height: scene.designHeight }, nodes, assets: [...assetMap.values()] };
}

/** 在 AI 不可用时提供可读且可导出的本地命名。 */
export function applyFallbackNaming(scene: UIScene): { scene: UIScene; analysis: ProjectAnalysis } {
  const used = new Set<string>();
  const nodes: Record<string, ProjectAnalysis["nodes"][string]> = {};
  const assets: Record<string, ProjectAnalysis["assets"][string]> = {};
  const assetNames = new Map<string, string>();
  const fallbackAssetName = (image: HTMLCanvasElement, hint: string): string => {
    const key = assetKey(image);
    const existing = assetNames.get(key);
    if (existing) return existing;
    const name = `img_${translateHint(hint.replace(/^img_/i, ""))}`;
    assetNames.set(key, name);
    assets[key] = { source: "fallback", confidence: 0.35, name, reason: "AI 命名不可用，使用本地备用命名" };
    return name;
  };
  const renameResources = (input: UINode): UINode["resources"] | undefined => {
    if (!input.resources) return input.resources;
    return Object.fromEntries(Object.entries(input.resources).map(([slot, binding]) => {
      if (!binding) return [slot, binding];
      const image = binding.sourceNode.image ?? binding.image;
      if (!image) return [slot, binding];
      const name = fallbackAssetName(image, binding.sourceNode.name);
      const sourceNode = { ...binding.sourceNode, name, assetName: name, image };
      return [slot, { ...binding, name, image, sourceNode }];
    })) as UINode["resources"];
  };
  const clone = (input: UINode): UINode => {
    if (input.naming?.source === "manual") {
      used.add(input.name);
      nodes[input.id] = { ...input.naming };
      return { ...input, resources: renameResources(input), children: input.children?.map(clone) };
    }
    const type = input.ctrl?.type;
    const suffix = translateHint(input.name.replace(/^(btn|chk|check|edit|input|grid|layout|vlist|list|hlist|pbar|radio|slider|img|txt|text|node)_/i, ""));
    const generated = uniqueName(typePrefix(type), suffix === "node" ? "item" : suffix, used);
    const key = input.image ? assetKey(input.image) : null;
    const assetName = key ? fallbackAssetName(input.image!, input.name) : undefined;
    nodes[input.id] = { source: "fallback", confidence: 0.35, suffix: generated.slice(typePrefix(type).length + 1), reason: "AI 命名不可用，使用本地规则" };
    if (key && assetName) assets[key] = { source: "fallback", confidence: 0.35, name: assetName, reason: "AI 命名不可用，使用本地规则" };
    return {
      ...input,
      name: generated,
      ...(assetName ? { assetName } : {}),
      naming: { source: "fallback", confidence: 0.35, suffix: generated.slice(typePrefix(type).length + 1), reason: "AI 命名不可用，使用本地规则" },
      resources: renameResources(input),
      children: input.children?.map(clone),
    };
  };
  return {
    scene: { ...scene, nodes: scene.nodes.map(clone) },
    analysis: { version: 1, provider: "local", status: "fallback", generatedAt: new Date().toISOString(), nodes, assets, warnings: ["AI 命名不可用，已使用本地备用命名"] },
  };
}

export function applyAiNaming(source: UIScene, result: AiNamingResult, options: { overwriteManual?: boolean } = {}): { scene: UIScene; analysis: ProjectAnalysis } {
  const overwriteManual = options.overwriteManual ?? false;
  const fallback = applyFallbackNaming(source);
  const byNode = new Map((result.nodes ?? []).map((item) => [item.id, item]));
  const byAsset = new Map((result.assets ?? []).map((item) => [item.key, item]));
  const used = new Set<string>();
  const nodes: ProjectAnalysis["nodes"] = {};
  const assets: ProjectAnalysis["assets"] = {};
  const fallbackAssetNames = new Map<string, string>();
  const resolveAssetName = (image: HTMLCanvasElement, hint: string, existing?: string): { key: string; name: string } => {
    const key = assetKey(image);
    const asset = byAsset.get(key);
    const nameCandidate = asset?.name ? compactSemanticName(asset.name.replace(/^img_/, ""), undefined, "asset") : null;
    const assetConfidence = asset?.confidence ?? 0;
    let name = nameCandidate && assetConfidence >= 0.5 ? `img_${nameCandidate}` : existing;
    if (!name) {
      name = fallbackAssetNames.get(key);
      if (!name) {
        const fallbackHint = hint.replace(/^img_/i, "");
        name = `img_${translateHint(fallbackHint)}`;
        fallbackAssetNames.set(key, name);
      }
    }
    assets[key] = nameCandidate && assetConfidence >= 0.5
      ? { source: "ai", confidence: assetConfidence, name, ...(asset?.reason ? { reason: asset.reason } : {}) }
      : { source: "fallback", confidence: assetConfidence || 0.35, name, reason: asset?.reason ?? "AI 未返回可靠图片名" };
    return { key, name };
  };
  const renameResources = (input: UINode): UINode["resources"] | undefined => {
    if (!input.resources) return input.resources;
    return Object.fromEntries(Object.entries(input.resources).map(([slot, binding]) => {
      if (!binding) return [slot, binding];
      const image = binding.sourceNode.image ?? binding.image;
      if (!image) return [slot, binding];
      const resolved = resolveAssetName(image, binding.sourceNode.name, binding.sourceNode.assetName);
      const sourceNode = {
        ...binding.sourceNode,
        name: resolved.name,
        assetName: resolved.name,
        image,
      };
      return [slot, { ...binding, name: resolved.name, image, sourceNode }];
    })) as UINode["resources"];
  };
  const clone = (input: UINode): UINode => {
    if (input.naming?.source === "manual" && !overwriteManual) {
      used.add(input.name);
      nodes[input.id] = { ...input.naming };
      return { ...input, resources: renameResources(input), children: input.children?.map(clone) };
    }
    const type = input.ctrl?.type;
    const item = byNode.get(input.id);
    const prefix = typePrefix(type);
    const fallbackSuffix = input.naming?.suffix ?? "item";
    const aiSuffix = item?.suffix
      ? compactSemanticName(item.suffix.replace(new RegExp(`^${prefix}_`, "i"), ""), type)
      : null;
    const confidence = item?.confidence ?? 0;
    const accepted = Boolean(aiSuffix && confidence >= 0.5);
    const name = uniqueName(prefix, accepted ? aiSuffix! : fallbackSuffix, used);
    const naming = accepted
      ? { source: "ai" as const, confidence, suffix: aiSuffix!, ...(item?.reason ? { reason: item.reason } : {}) }
      : { source: "fallback" as const, confidence: confidence || 0.35, suffix: name.slice(prefix.length + 1), reason: item?.reason ?? "AI 未返回可靠名称" };
    nodes[input.id] = naming;
    let assetName = input.assetName;
    if (input.image) {
      assetName = resolveAssetName(input.image, fallbackSuffix, assetName).name;
    }
    return { ...input, name, ...(assetName ? { assetName } : {}), naming, resources: renameResources(input), children: input.children?.map(clone) };
  };
  const namedScene = { ...fallback.scene, nodes: fallback.scene.nodes.map(clone) };
  const warnings: string[] = [];
  if (Object.values(nodes).some((item) => item.source === "fallback")) warnings.push("部分节点名称置信度不足，已使用备用名称");
  if (Object.values(assets).some((item) => item.source === "fallback")) warnings.push("部分图片名称置信度不足，已使用备用名称");
  return { scene: namedScene, analysis: { version: 1, provider: "codex-cli", status: warnings.length ? "partial" : "complete", generatedAt: new Date().toISOString(), nodes, assets, warnings } };
}
