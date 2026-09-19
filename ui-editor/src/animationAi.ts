import { normalizeAnimationClip } from "./animation";
import { ANIMATION_EFFECTS, createEffectClip } from "./animationEffects";
import type { AnimationClip, AnimationFlow, UINode, UIScene } from "./types";

export interface AnimationAiNodeSummary {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  rect: { x: number; y: number; width: number; height: number };
  text?: string;
  existingClips: string[];
}

export interface AnimationAiManifest {
  designSize: { width: number; height: number };
  nodes: AnimationAiNodeSummary[];
  existingFlows: Array<{ id: string; name: string; trigger: string; stepCount: number }>;
  effectLibrary: typeof ANIMATION_EFFECTS;
}

export interface AnimationAiSuggestion {
  id: string;
  nodeId: string;
  nodeName: string;
  clip: AnimationClip;
  confidence: number;
  reason: string;
}

export interface AnimationAiResult {
  available: boolean;
  provider: "codex" | "local";
  suggestions: AnimationAiSuggestion[];
  flow?: AnimationFlow;
  warnings: string[];
  message?: string;
}

export interface AnimationAiRequest {
  prompt: string;
  targetNodeIds: string[];
  manifest: AnimationAiManifest;
  referenceDataUrl?: string;
}

function walkNodes(nodes: UINode[], result: UINode[] = []): UINode[] {
  for (const node of nodes) {
    result.push(node);
    if (node.children) walkNodes(node.children, result);
  }
  return result;
}

export function buildAnimationManifest(scene: UIScene, targetNodeIds: string[] = []): AnimationAiManifest {
  const targetSet = new Set(targetNodeIds);
  const all = walkNodes(scene.nodes);
  const selected = targetSet.size
    ? all.filter((node) => targetSet.has(node.id))
    : all.filter((node) => !node.children?.length && node.visible).slice(0, 24);
  return {
    designSize: { width: scene.designWidth, height: scene.designHeight },
    nodes: selected.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.ctrl?.type ?? (node.text ? "Text" : node.children ? "Layout" : "StaticImage"),
      visible: node.visible,
      locked: Boolean(node.locked),
      rect: { ...node.designRect },
      ...(node.text ? { text: node.text.content.slice(0, 120) } : {}),
      existingClips: (node.animations ?? []).map((clip) => clip.id),
    })),
    existingFlows: (scene.animationFlows ?? []).map((flow) => ({
      id: flow.id, name: flow.name, trigger: flow.trigger, stepCount: flow.steps.length,
    })),
    effectLibrary: ANIMATION_EFFECTS,
  };
}

function chooseEffect(prompt: string): string {
  const text = prompt.toLowerCase();
  if (/抖|震|shake/.test(text)) return "shake";
  if (/呼吸|脉冲|pulse|强调/.test(text)) return "pulse";
  if (/缩放|弹|scale|pop/.test(text)) return "scale-in";
  if (/左|右侧|slide.?left/.test(text)) return "slide-left";
  if (/上|进入|滑入|slide/.test(text)) return "slide-up";
  return "fade-in";
}

export function generateLocalAnimationResult(scene: UIScene, prompt: string, targetNodeIds: string[] = []): AnimationAiResult {
  const manifest = buildAnimationManifest(scene, targetNodeIds);
  const all = walkNodes(scene.nodes);
  const selected = manifest.nodes
    .map((summary) => all.find((node) => node.id === summary.id))
    .filter((node): node is UINode => Boolean(node))
    .filter((node) => !node.locked);
  const effectId = chooseEffect(prompt);
  const wantsSequence = /依次|顺序|序列|sequence|stagger|逐个/i.test(prompt);
  const suggestions = selected.map((node, index) => {
    const clip = createEffectClip(node, effectId, "ai-local-" + node.id + "-" + Date.now() + "-" + index);
    return {
      id: "suggestion-" + node.id + "-" + index,
      nodeId: node.id,
      nodeName: node.name,
      clip: { ...clip, source: "ai" as const },
      confidence: 0.58,
      reason: "本地动画适配器根据提示词选择了「" + (ANIMATION_EFFECTS.find((effect) => effect.id === effectId)?.name ?? effectId) + "」效果。",
    };
  });
  const flow = wantsSequence && suggestions.length > 1 ? {
    id: "ai-local-flow-" + Date.now(),
    name: "AI 生成流程",
    duration: Math.max(...suggestions.map((item, index) => index * 0.08 + item.clip.duration)),
    trigger: "onShow" as const,
    source: "ai" as const,
    steps: suggestions.map((item, index) => ({ id: item.id + "-step", nodeId: item.nodeId, clipId: item.clip.id, start: index * 0.08 })),
  } : undefined;
  return {
    available: true,
    provider: "local",
    suggestions,
    flow,
    warnings: ["AI 服务不可用或尚未返回结果，已使用本地特效适配器生成可审查草稿。"],
  };
}

function sanitizeResult(value: unknown, manifest: AnimationAiManifest): Omit<AnimationAiResult, "available" | "provider"> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { suggestions?: unknown; flow?: unknown; warnings?: unknown; message?: unknown };
  const nodeMap = new Map(manifest.nodes.map((node) => [node.id, node]));
  const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<AnimationAiSuggestion>;
    if (typeof input.nodeId !== "string" || !nodeMap.has(input.nodeId) || !input.clip || typeof input.clip !== "object") return [];
    const clip = normalizeAnimationClip(input.clip as AnimationClip);
    if (!clip.id || !clip.tracks.length) return [];
    return [{
      id: typeof input.id === "string" ? input.id : "ai-" + input.nodeId + "-" + clip.id,
      nodeId: input.nodeId,
      nodeName: nodeMap.get(input.nodeId)!.name,
      clip: { ...clip, source: "ai" as const },
      confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, Number(input.confidence))) : 0.5,
      reason: typeof input.reason === "string" ? input.reason : "AI 根据场景与提示词生成。",
    }];
  }) : [];
  const flow = raw.flow && typeof raw.flow === "object" ? raw.flow as AnimationFlow : undefined;
  return {
    suggestions,
    ...(flow?.steps?.length ? { flow: { ...flow, source: "ai", steps: flow.steps.filter((step) => nodeMap.has(step.nodeId)) } } : {}),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === "string") : [],
    ...(typeof raw.message === "string" ? { message: raw.message } : {}),
  };
}

export async function requestAiAnimation(request: AnimationAiRequest, signal?: AbortSignal): Promise<AnimationAiResult> {
  try {
    const response = await fetch("/api/ai/animation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(request),
    });
    if (!response.ok) return { ...generateLocalAnimationResultFromManifest(request), available: false, message: await response.text() || "AI 动画服务不可用" };
    const payload = await response.json() as { available?: boolean; result?: unknown; message?: string };
    const result = sanitizeResult(payload.result ?? payload, request.manifest);
    if (!result || !result.suggestions.length) {
      return { ...generateLocalAnimationResultFromManifest(request), available: false, message: payload.message ?? "AI 未返回可应用的动画建议" };
    }
    return { available: payload.available !== false, provider: "codex", ...result };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ...generateLocalAnimationResultFromManifest(request), available: false, message: error instanceof Error ? error.message : "AI 动画请求失败" };
  }
}

function generateLocalAnimationResultFromManifest(request: AnimationAiRequest): AnimationAiResult {
  // 服务不可用时仍返回可审查结果；节点本身由 manifest 保留，效果使用安全的淡入适配器。
  const fakeNodes = request.manifest.nodes.map((item) => ({
    id: item.id,
    name: item.name,
    image: null,
    designRect: { ...item.rect },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: item.rect.x, offsetY: item.rect.y, safeArea: false },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: item.visible,
    zIndex: 0,
    adaptation: { mode: "anchor" as const },
    psd: { layerId: -1, originalX: item.rect.x, originalY: item.rect.y, originalWidth: item.rect.width, originalHeight: item.rect.height },
    ...(item.text ? { text: { content: item.text, fontSize: 16, color: "#fff", mode: "fixed" as const, minFontSize: 8 } } : {}),
  } as UINode));
  const fakeScene: UIScene = { designWidth: request.manifest.designSize.width, designHeight: request.manifest.designSize.height, nodes: fakeNodes };
  return generateLocalAnimationResult(fakeScene, request.prompt, request.targetNodeIds);
}
