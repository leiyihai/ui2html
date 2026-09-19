import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANIMATION_DEFAULT_DURATION,
  createAnimationClip,
  removeAnimationKeyframe,
  upsertAnimationKeyframe,
} from "../animation";
import { ANIMATION_EFFECTS, createEffectClip, findAnimationEffect } from "../animationEffects";
import type { AnimationAiResult } from "../animationAi";
import type { AnimationClip, AnimationFlow, AnimationFlowStep, AnimationProperty, AnimationTrigger, UINode } from "../types";
import { Icon } from "./Icon";

export interface AnimationPreviewState {
  nodeId: string;
  clipId: string;
  time: number;
  playing: boolean;
}

const TRACKS: Array<{ property: AnimationProperty; label: string; unit: string }> = [
  { property: "x", label: "X 位置", unit: "px" },
  { property: "y", label: "Y 位置", unit: "px" },
  { property: "scaleX", label: "横向缩放", unit: "" },
  { property: "scaleY", label: "纵向缩放", unit: "" },
  { property: "rotation", label: "旋转", unit: "°" },
  { property: "opacity", label: "透明度", unit: "" },
  { property: "width", label: "视觉宽度", unit: "px" },
  { property: "height", label: "视觉高度", unit: "px" },
];

interface Props {
  node: UINode | null;
  nodes: UINode[];
  onAnimations: (animations: AnimationClip[]) => void;
  animationFlows: AnimationFlow[];
  onAnimationFlows: (flows: AnimationFlow[]) => void;
  onAiGenerate: (prompt: string, targetNodeIds: string[]) => Promise<AnimationAiResult>;
  onApplyAiResult: (result: AnimationAiResult) => void;
  onPreviewChange?: (preview: AnimationPreviewState | null) => void;
}

function valueFor(node: UINode, property: AnimationProperty): number {
  switch (property) {
    case "x": return node.anchor.offsetX;
    case "y": return node.anchor.offsetY;
    case "scaleX": return node.scale.x;
    case "scaleY": return node.scale.y;
    case "rotation": return node.rotation;
    case "opacity": return node.opacity;
    case "width": return node.designRect.width;
    case "height": return node.designRect.height;
  }
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function flattenNodes(nodes: UINode[], result: UINode[] = []): UINode[] {
  for (const item of nodes) {
    result.push(item);
    if (item.children) flattenNodes(item.children, result);
  }
  return result;
}

function nodeKind(node: UINode): string {
  return node.ctrl?.type ?? (node.text ? "Text" : node.children ? "Layout" : "StaticImage");
}

export default function AnimationWorkspace({ node, nodes, onAnimations, animationFlows, onAnimationFlows, onAiGenerate, onApplyAiResult, onPreviewChange }: Props) {
  const clips = useMemo(() => node?.animations ?? [], [node?.animations]);
  const allNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const allClips = useMemo(() => allNodes.flatMap((item) => (item.animations ?? []).map((clip) => ({ node: item, clip }))), [allNodes]);
  const [clipId, setClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const [effectId, setEffectId] = useState(ANIMATION_EFFECTS[0].id);
  const [aiPrompt, setAiPrompt] = useState("请为当前界面制作自然、克制的入场动画");
  const [aiScope, setAiScope] = useState<"selected" | "scene">("selected");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<AnimationAiResult | null>(null);
  const [flowId, setFlowId] = useState<string | null>(animationFlows[0]?.id ?? null);
  const [flowNodeId, setFlowNodeId] = useState(node?.id ?? allNodes[0]?.id ?? "");
  const [flowClipId, setFlowClipId] = useState("");
  const [flowStepStart, setFlowStepStart] = useState(0);

  useEffect(() => { timeRef.current = time; }, [time]);

  useEffect(() => {
    if (!clips.length) {
      setClipId(null);
      setTime(0);
      setPlaying(false);
      return;
    }
    if (!clipId || !clips.some((clip) => clip.id === clipId)) setClipId(clips[0].id);
  }, [clipId, clips]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let elapsedTotal = timeRef.current;
    const tick = (now: number) => {
      const clip = clips.find((item) => item.id === clipId);
      if (!clip) { setPlaying(false); return; }
      const elapsed = (now - last) / 1000;
      last = now;
      elapsedTotal += elapsed;
      setTime((current) => {
        const next = current + elapsed;
        const loopDuration = Math.max(0.01, clip.duration);
        if (clip.loop === "infinite") return next % loopDuration;
        if (elapsedTotal < loopDuration * clip.loop) return next % loopDuration;
        setPlaying(false);
        return clip.duration;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clipId, clips, playing]);

  const clip = useMemo(() => clips.find((item) => item.id === clipId) ?? null, [clipId, clips]);
  const nodeId = node?.id;
  const flow = useMemo(() => animationFlows.find((item) => item.id === flowId) ?? null, [animationFlows, flowId]);
  const flowNode = allNodes.find((item) => item.id === flowNodeId) ?? null;
  const flowNodeClips = useMemo(() => flowNode?.animations ?? [], [flowNode]);

  useEffect(() => {
    if (!animationFlows.length) {
      setFlowId(null);
      return;
    }
    if (!flowId || !animationFlows.some((item) => item.id === flowId)) setFlowId(animationFlows[0].id);
  }, [animationFlows, flowId]);

  useEffect(() => {
    if (node?.id && allNodes.some((item) => item.id === node.id)) setFlowNodeId(node.id);
  }, [allNodes, node?.id]);

  useEffect(() => {
    if (!flowNodeClips.some((item) => item.id === flowClipId)) setFlowClipId(flowNodeClips[0]?.id ?? "");
  }, [flowClipId, flowNodeClips]);

  useEffect(() => {
    if (!nodeId || !clip) {
      onPreviewChange?.(null);
      return;
    }
    onPreviewChange?.({ nodeId, clipId: clip.id, time, playing });
  }, [clip, nodeId, onPreviewChange, playing, time]);

  const updateClip = (next: AnimationClip) => {
    onAnimations(clips.map((item) => item.id === next.id ? next : item));
  };

  const createClip = () => {
    if (!node) return;
    const next = createAnimationClip(`动画 ${clips.length + 1}`);
    onAnimations([...clips, next]);
    setClipId(next.id);
    setTime(0);
  };

  const addKeyframe = (property: AnimationProperty) => {
    if (!node || !clip) return;
    updateClip(upsertAnimationKeyframe(clip, property, time, valueFor(node, property), "ease-out"));
  };

  const applyEffect = () => {
    if (!node) return;
    const generated = createEffectClip(node, effectId);
    onAnimations([...clips, generated]);
    setClipId(generated.id);
    setTime(0);
    setPlaying(false);
  };

  const generateAi = async () => {
    const targetIds = aiScope === "selected" && node ? [node.id] : allNodes.filter((item) => item.visible && !item.locked).map((item) => item.id);
    if (!targetIds.length || !aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      setAiResult(await onAiGenerate(aiPrompt.trim(), targetIds));
    } catch (error) {
      setAiResult({ available: false, provider: "local", suggestions: [], warnings: [error instanceof Error ? error.message : "AI 动画生成失败"] });
    } finally {
      setAiBusy(false);
    }
  };

  const createFlow = () => {
    const next: AnimationFlow = {
      id: "flow-" + Date.now(), name: "新动画流程", duration: 1, trigger: "onShow", steps: [], source: "manual",
    };
    onAnimationFlows([...animationFlows, next]);
    setFlowId(next.id);
  };

  const updateFlow = (next: AnimationFlow) => onAnimationFlows(animationFlows.map((item) => item.id === next.id ? next : item));

  const addFlowStep = () => {
    if (!flow || !flowNodeId || !flowClipId) return;
    const step: AnimationFlowStep = { id: "step-" + Date.now(), nodeId: flowNodeId, clipId: flowClipId, start: Math.max(0, flowStepStart) };
    const clipDuration = allClips.find((item) => item.node.id === flowNodeId && item.clip.id === flowClipId)?.clip.duration ?? 0;
    updateFlow({ ...flow, duration: Math.max(flow.duration, step.start + clipDuration), steps: [...flow.steps, { ...step, duration: clipDuration }].sort((a, b) => a.start - b.start) });
  };

  const removeFlow = () => {
    if (!flow) return;
    const next = animationFlows.filter((item) => item.id !== flow.id);
    onAnimationFlows(next);
    setFlowId(next[0]?.id ?? null);
  };

  const clipLabel = (nodeId: string, selectedClipId: string) => {
    const item = allClips.find((candidate) => candidate.node.id === nodeId && candidate.clip.id === selectedClipId);
    return item ? item.node.name + " / " + item.clip.name : selectedClipId;
  };

  const renderFlowEditor = () => <section className="animation-flow-editor">
    <header className="animation-section-head">
      <div><strong>界面动画流程</strong><small>把多个节点片段编排为可审查的场景流程</small></div>
      <button className="btn" type="button" onClick={createFlow}><Icon name="plus" size={13} /> 新建流程</button>
    </header>
    {!flow ? <p className="animation-hint">还没有流程。创建后可选择节点动画片段并设置开始时间。</p> : <>
      <div className="animation-flow-toolbar">
        <select value={flow.id} onChange={(event) => setFlowId(event.target.value)}>{animationFlows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <input value={flow.name} onChange={(event) => updateFlow({ ...flow, name: event.target.value })} aria-label="流程名称" />
        <label>时长<input type="number" min={0.05} step={0.05} value={flow.duration} onChange={(event) => updateFlow({ ...flow, duration: Math.max(0.05, Number(event.target.value) || 0.05) })} /></label>
        <label>触发<select value={flow.trigger} onChange={(event) => updateFlow({ ...flow, trigger: event.target.value as AnimationTrigger })}>
          <option value="manual">手动</option><option value="onShow">显示时</option><option value="onClick">点击时</option><option value="onHover">悬停时</option><option value="onSelect">选中时</option><option value="onValueChange">数值变化时</option>
        </select></label>
        <button className="icon-btn" type="button" title="删除流程" aria-label="删除流程" onClick={removeFlow}><Icon name="trash" size={13} /></button>
      </div>
      <div className="animation-flow-add">
        <select value={flowNodeId} onChange={(event) => { setFlowNodeId(event.target.value); setFlowClipId(""); }} aria-label="流程节点"><option value="">选择节点</option>{allNodes.filter((item) => item.animations?.length).map((item) => <option key={item.id} value={item.id}>{item.name} · {nodeKind(item)}</option>)}</select>
        <select value={flowClipId} onChange={(event) => setFlowClipId(event.target.value)} aria-label="流程片段"><option value="">选择片段</option>{flowNodeClips.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <label>开始<input type="number" min={0} step={0.05} value={flowStepStart} onChange={(event) => setFlowStepStart(Math.max(0, Number(event.target.value) || 0))} /></label>
        <button className="btn" type="button" disabled={!flowClipId} onClick={addFlowStep}><Icon name="plus" size={13} /> 加入流程</button>
      </div>
      <div className="animation-flow-steps">{flow.steps.length ? flow.steps.map((step) => <div className="animation-flow-step" key={step.id}>
        <span>{clipLabel(step.nodeId, step.clipId)}</span>
        <label>开始<input type="number" min={0} step={0.05} value={step.start} onChange={(event) => updateFlow({ ...flow, steps: flow.steps.map((item) => item.id === step.id ? { ...item, start: Math.max(0, Number(event.target.value) || 0) } : item) })} /></label>
        <label>持续<input type="number" min={0.05} step={0.05} value={step.duration ?? 0.05} onChange={(event) => updateFlow({ ...flow, steps: flow.steps.map((item) => item.id === step.id ? { ...item, duration: Math.max(0.05, Number(event.target.value) || 0.05) } : item) })} /></label>
        <button className="icon-btn" type="button" title="移除步骤" aria-label="移除步骤" onClick={() => updateFlow({ ...flow, steps: flow.steps.filter((item) => item.id !== step.id) })}><Icon name="close" size={12} /></button>
      </div>) : <p className="animation-hint">流程还没有步骤。</p>}</div>
    </>}
  </section>;

  if (!node) return <section className="animation-workspace">
    <div className="animation-empty"><Icon name="sparkles" size={26} /><h2>动画工具</h2><p>请先在层级中选择一个节点，再编辑节点动画；已有流程仍可在下方继续编排。</p></div>
    {renderFlowEditor()}
  </section>;

  return <section className="animation-workspace">
    <header className="animation-head">
      <div>
        <span className="workspace-kicker">ANIMATION TOOL</span>
        <h2>{node.name}</h2>
        <p>节点动画只修改视觉属性；AI 结果和流程都会先进入审查区，再写入工程。</p>
      </div>
      <button className="btn primary" type="button" onClick={createClip}><Icon name="plus" size={14} /> 新建片段</button>
    </header>

    <div className="animation-ai-panel">
      <div className="animation-section-head"><div><strong><Icon name="sparkles" size={14} /> AI 动画生成</strong><small>读取当前场景结构与效果参考图，只生成动画数据，不改层级和资源</small></div><span className="animation-ai-badge">审查后应用</span></div>
      <div className="animation-ai-controls">
        <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={2} aria-label="动画提示词" />
        <select value={aiScope} onChange={(event) => setAiScope(event.target.value as "selected" | "scene")} aria-label="动画生成范围"><option value="selected">当前节点</option><option value="scene">整个场景</option></select>
        <button className="btn primary" type="button" disabled={aiBusy || (aiScope === "selected" && !node)} onClick={() => { void generateAi(); }}>{aiBusy ? "生成中…" : "生成动画"}</button>
      </div>
      {aiResult && <div className="animation-ai-review">
        <div className="animation-ai-review-head"><span>{aiResult.provider === "codex" ? "Codex 结果" : "本地适配结果"} · {aiResult.suggestions.length} 条建议</span><button className="btn primary" type="button" disabled={!aiResult.suggestions.length} onClick={() => { onApplyAiResult(aiResult); setAiResult(null); }}>应用全部</button><button className="icon-btn" type="button" title="丢弃结果" aria-label="丢弃结果" onClick={() => setAiResult(null)}><Icon name="close" size={13} /></button></div>
        {aiResult.warnings.map((warning) => <p className="animation-ai-warning" key={warning}>{warning}</p>)}
        {aiResult.suggestions.map((suggestion) => <div className="animation-ai-suggestion" key={suggestion.id}><span><strong>{suggestion.nodeName}</strong> · {suggestion.clip.name}</span><small>{Math.round(suggestion.confidence * 100)}% · {suggestion.reason}</small></div>)}
      </div>}
    </div>

    {!clip ? <div className="animation-no-clip"><p>还没有动画片段。</p><button className="btn" type="button" onClick={createClip}>创建第一个动画</button></div> : <>
      <div className="animation-clip-toolbar">
        <label>动画片段
          <select value={clip.id} onChange={(event) => { setClipId(event.target.value); setTime(0); setPlaying(false); }}>
            {clips.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>名称<input value={clip.name} onChange={(event) => updateClip({ ...clip, name: event.target.value })} /></label>
        <label>时长<input type="number" min={0.05} step={0.05} value={clip.duration}
          onChange={(event) => updateClip({ ...clip, duration: Math.max(0.05, Number(event.target.value) || ANIMATION_DEFAULT_DURATION) })} /></label>
        <label>循环<select value={String(clip.loop)} onChange={(event) => updateClip({ ...clip, loop: event.target.value === "infinite" ? "infinite" : Math.max(1, Number(event.target.value)) })}>
          <option value="1">一次</option><option value="2">2 次</option><option value="3">3 次</option><option value="infinite">无限循环</option>
        </select></label>
        <label className="chk"><input type="checkbox" checked={clip.autoPlay} onChange={(event) => updateClip({ ...clip, autoPlay: event.target.checked })} /> 自动播放</label>
        <label>内置特效<select value={effectId} onChange={(event) => setEffectId(event.target.value)}>{ANIMATION_EFFECTS.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</select></label>
        <button className="btn" type="button" onClick={applyEffect} title={findAnimationEffect(effectId)?.description}><Icon name="sparkles" size={13} /> 应用特效为新片段</button>
        <button className="icon-btn" type="button" title="删除当前片段" aria-label="删除当前片段" onClick={() => {
          const next = clips.filter((item) => item.id !== clip.id);
          onAnimations(next);
          setClipId(next[0]?.id ?? null);
          setTime(0);
          setPlaying(false);
        }}><Icon name="trash" size={14} /></button>
      </div>

      <div className="animation-transport">
        <button className="btn" type="button" onClick={() => { setTime(0); setPlaying(false); }}><Icon name="refresh" size={14} /> 回到开始</button>
        <button className="btn primary" type="button" onClick={() => setPlaying((value) => !value)}><Icon name={playing ? "pause" : "play"} size={14} /> {playing ? "暂停" : "播放"}</button>
        <span className="animation-time-readout">{time.toFixed(2)}s / {clip.duration.toFixed(2)}s</span>
        <input className="animation-time-range" type="range" min={0} max={clip.duration} step={0.01} value={Math.min(time, clip.duration)} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} />
      </div>

      <div className="animation-timeline" style={{ "--animation-duration": `${Math.max(0.05, clip.duration)}s` } as React.CSSProperties}>
        <div className="animation-ruler"><span>0s</span><span>{(clip.duration / 2).toFixed(2)}s</span><span>{clip.duration.toFixed(2)}s</span></div>
        {TRACKS.map((item) => {
          const track = clip.tracks.find((candidate) => candidate.property === item.property);
          return <div className="animation-track-row" key={item.property}>
            <div className="animation-track-label"><span>{item.label}</span><small>{track?.keyframes.length ?? 0} 个关键帧</small></div>
            <div className="animation-track-lane">
              <span className="animation-playhead" style={{ left: `${(time / Math.max(0.05, clip.duration)) * 100}%` }} />
              {track?.keyframes.map((keyframe) => <button key={`${item.property}-${keyframe.time}`} className="animation-keyframe" type="button"
                style={{ left: `${(keyframe.time / Math.max(0.05, clip.duration)) * 100}%` }} title={`${formatValue(keyframe.value)}${item.unit} · ${keyframe.time.toFixed(2)}s`}
                onClick={() => updateClip(removeAnimationKeyframe(clip, item.property, keyframe.time))} />)}
              <button className="animation-add-keyframe" type="button" onClick={() => addKeyframe(item.property)} title="在当前时间添加关键帧"><Icon name="plus" size={12} /></button>
            </div>
          </div>;
        })}
      </div>
      <p className="animation-hint">点击轨道右侧的 + 可把当前节点属性写入当前时间。点击菱形关键帧可删除。</p>
    </>}
    {renderFlowEditor()}
  </section>;
}
