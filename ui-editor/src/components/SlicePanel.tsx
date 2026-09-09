import { useEffect, useMemo, useRef, useState } from "react";
import type { NineSliceCandidate, NineSliceGroup, NineSliceMargins, UIScene } from "../types";
import { collectNineSliceImages, createManualNineSliceCandidate, type NineSliceImageEntry } from "../nineSlice";

type SliceTab = "candidates" | "mark" | "result";

function statusLabel(status: NineSliceCandidate["status"]): string {
  return status === "confirmed" ? "已完成" : status === "skipped" ? "已跳过" : "待处理";
}

function sourceFor(candidate: NineSliceCandidate, entries: NineSliceImageEntry[]): NineSliceImageEntry | null {
  return entries.find((entry) => entry.node.id === candidate.sourceNodeId) ?? null;
}

function groupFor(candidate: NineSliceCandidate, groups: NineSliceGroup[]): NineSliceGroup | undefined {
  return groups.find((group) => group.id === candidate.id);
}

export function SliceEditor(p: { source: NineSliceImageEntry; slice: NineSliceMargins; onChange: (slice: NineSliceMargins) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"top" | "bottom" | "left" | "right" | null>(null);
  const scaleRef = useRef(1);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const image = p.source.image;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(0.25, Math.min(460 / image.width, 300 / image.height, 8));
    scaleRef.current = scale;
    cv.width = Math.max(1, Math.round(image.width * scale * dpr));
    cv.height = Math.max(1, Math.round(image.height * scale * dpr));
    cv.style.width = `${image.width * scale}px`;
    cv.style.height = `${image.height * scale}px`;
    const context = cv.getContext("2d");
    if (!context) return;
    context.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    context.clearRect(0, 0, image.width, image.height);
    context.drawImage(image, 0, 0);
    context.fillStyle = "rgba(45, 177, 198, .12)";
    context.fillRect(p.slice.left, p.slice.top, Math.max(0, image.width - p.slice.left - p.slice.right), Math.max(0, image.height - p.slice.top - p.slice.bottom));
    context.strokeStyle = "#6ed8df";
    context.lineWidth = Math.max(1, 1 / scale);
    const lines: [number, number, number, number][] = [
      [0, p.slice.top, image.width, p.slice.top], [0, image.height - p.slice.bottom, image.width, image.height - p.slice.bottom],
      [p.slice.left, 0, p.slice.left, image.height], [image.width - p.slice.right, 0, image.width - p.slice.right, image.height],
    ];
    for (const [x1, y1, x2, y2] of lines) { context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke(); }
  }, [p.source, p.slice]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(p.source.image.width, Math.round((event.clientX - rect.left) / scaleRef.current))),
      y: Math.max(0, Math.min(p.source.image.height, Math.round((event.clientY - rect.top) / scaleRef.current))),
    };
  };
  const lineAt = (x: number, y: number): "top" | "bottom" | "left" | "right" | null => {
    const { width, height } = p.source.image;
    const threshold = 7 / scaleRef.current;
    const distances: ["top" | "bottom" | "left" | "right", number][] = [
      ["top", Math.abs(y - p.slice.top)], ["bottom", Math.abs(y - (height - p.slice.bottom))],
      ["left", Math.abs(x - p.slice.left)], ["right", Math.abs(x - (width - p.slice.right))],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][1] <= threshold ? distances[0][0] : null;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    const hit = lineAt(point.x, point.y);
    if (!hit) return;
    dragRef.current = hit;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    const hit = dragRef.current;
    if (!hit) {
      const near = lineAt(point.x, point.y);
      event.currentTarget.style.cursor = near === "left" || near === "right" ? "ew-resize" : near ? "ns-resize" : "crosshair";
      return;
    }
    const { width, height } = p.source.image;
    const next = { ...p.slice };
    if (hit === "left") next.left = Math.max(0, Math.min(point.x, width - next.right - 1));
    if (hit === "right") next.right = Math.max(0, Math.min(width - point.x, width - next.left - 1));
    if (hit === "top") next.top = Math.max(0, Math.min(point.y, height - next.bottom - 1));
    if (hit === "bottom") next.bottom = Math.max(0, Math.min(height - point.y, height - next.top - 1));
    p.onChange(next);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };
  const setMargin = (key: keyof NineSliceMargins, value: number) => {
    const max = key === "left" || key === "right" ? p.source.image.width - 1 : p.source.image.height - 1;
    const other = key === "left" ? p.slice.right : key === "right" ? p.slice.left : key === "top" ? p.slice.bottom : p.slice.top;
    p.onChange({ ...p.slice, [key]: Math.max(0, Math.min(max - other, Math.round(value) || 0)) });
  };
  return <div className="slice-editor"><div className="slice-preview"><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} /></div>
    <div className="slice-nums">{(["left", "top", "right", "bottom"] as const).map((key) => <label className="slice-num" key={key}>
      <span>{key === "left" ? "左" : key === "top" ? "上" : key === "right" ? "右" : "下"}</span><input type="number" min="0" value={p.slice[key]} onChange={(event) => setMargin(key, +event.target.value)} />
    </label>)}</div></div>;
}

export default function NineSliceWorkspace(p: {
  scene: UIScene; onScan: () => void; onConfirm: (candidate: NineSliceCandidate, margins: NineSliceMargins) => void;
  onSkip: (candidateId: string) => void; onRestoreSkipped: () => void; onManualCreate: (candidate: NineSliceCandidate) => void;
}) {
  const entries = useMemo(() => collectNineSliceImages(p.scene), [p.scene]);
  const candidates = useMemo(() => p.scene.nineSliceCandidates ?? [], [p.scene.nineSliceCandidates]);
  const groups = useMemo(() => p.scene.nineSliceGroups ?? [], [p.scene.nineSliceGroups]);
  const [tab, setTab] = useState<SliceTab>("candidates");
  const [selectedId, setSelectedId] = useState<string | null>(candidates[0]?.id ?? null);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? null;
  const source = selected ? sourceFor(selected, entries) : null;
  const selectedGroup = selected ? groupFor(selected, groups) : undefined;
  const [margins, setMargins] = useState<NineSliceMargins>(selectedGroup?.margins ?? selected?.suggestedMargins ?? { left: 0, top: 0, right: 0, bottom: 0 });
  useEffect(() => {
    if (!selected) { setSelectedId(candidates[0]?.id ?? null); return; }
    setMargins({ ...(groupFor(selected, groups)?.margins ?? selected.suggestedMargins) });
  }, [candidates, groups, selected]);

  const pending = candidates.filter((candidate) => candidate.status === "suggested");
  const skipped = candidates.filter((candidate) => candidate.status === "skipped");
  const confirmed = candidates.filter((candidate) => candidate.status === "confirmed");
  const choose = (id: string, nextTab: SliceTab = tab) => { setSelectedId(id); setTab(nextTab); };
  const toggleManual = (id: string) => setManualIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const createManual = () => {
    const selectedEntries = entries.filter((entry) => manualIds.includes(entry.node.id));
    if (!selectedEntries.length) return;
    const candidate = createManualNineSliceCandidate(selectedEntries);
    p.onManualCreate(candidate);
    setManualIds([]);
    choose(candidate.id, "mark");
  };

  return <section className="nine-slice-workspace">
    <header className="nine-slice-head"><div><span className="workspace-kicker">ASSET PROCESSING</span><h2>九宫格</h2><p>先确认图片，再在原图上标记边界并转换；结果页沿用第二阶段的边距。</p></div>
      <div className="nine-slice-actions"><button className="btn primary" onClick={p.onScan}>扫描 / 更新候选</button><button className="btn" disabled={!skipped.length} onClick={p.onRestoreSkipped}>恢复已跳过</button></div></header>
    <div className="nine-slice-summary"><span>待处理 <strong>{pending.length}</strong></span><span>已完成 <strong>{confirmed.length}</strong></span><span>已跳过 <strong>{skipped.length}</strong></span><span>图片资源 <strong>{entries.length}</strong></span></div>
    <nav className="slice-tabs" aria-label="九宫格阶段"><button className={tab === "candidates" ? "on" : ""} onClick={() => setTab("candidates")}>1 · 候选图片</button><button className={tab === "mark" ? "on" : ""} disabled={!selected} onClick={() => setTab("mark")}>2 · 原图标记</button><button className={tab === "result" ? "on" : ""} disabled={!confirmed.length} onClick={() => setTab("result")}>3 · 九宫格结果</button></nav>
    {tab === "candidates" && <div className="slice-stage candidates-stage"><main className="slice-image-catalog"><div className="nine-slice-list-title">候选图片</div><p className="slice-stage-hint">算法只做推荐。可以多选图片后手动创建一个逻辑图片组；同一组最终使用最大尺寸的原图。</p><div className="slice-catalog-grid">{entries.map((entry) => <button key={entry.node.id} className={`slice-catalog-card ${manualIds.includes(entry.node.id) ? "selected" : ""}`} onClick={() => toggleManual(entry.node.id)}><img src={entry.image.toDataURL("image/png")} alt="" /><strong>{entry.node.name}</strong><small>{entry.image.width} × {entry.image.height}</small></button>)}</div><button className="btn" disabled={!manualIds.length} onClick={createManual}>确认手动归组{manualIds.length ? `（${manualIds.length}）` : ""}</button></main><aside className="slice-candidate-list"><div className="nine-slice-list-title">算法推荐</div>{!candidates.length && <div className="slice-empty">点击“扫描 / 更新候选”开始分析。</div>}{candidates.map((candidate) => { const entry = sourceFor(candidate, entries); return <button key={candidate.id} className={`nine-candidate status-${candidate.status}`} onClick={() => choose(candidate.id, "mark")}>{entry && <img src={entry.image.toDataURL("image/png")} alt="" />}<span><strong>{entry?.node.name ?? "图片已缺失"}</strong><small>{candidate.memberNodeIds.length} 张 · {statusLabel(candidate.status)}</small></span><em>{Math.round(candidate.confidence * 100)}%</em></button>; })}</aside></div>}
    {tab === "mark" && <div className="slice-stage mark-stage">{selected && source ? <main className="nine-slice-editor-panel"><div className="nine-slice-editor-title"><div><span>公共源图</span><h3>{source.node.name}</h3><small>{selected.memberNodeIds.length > 1 ? `同源图片 ${selected.memberNodeIds.length} 张，最大尺寸作为源图` : "单张图片"}</small></div><span className={`nine-status status-${selected.status}`}>{statusLabel(selected.status)}</span></div><p className="nine-slice-reason">{selected.reason}</p><SliceEditor source={source} slice={margins} onChange={setMargins} /><div className="nine-slice-editor-foot"><span>第二阶段是边距的唯一编辑入口；修改后重新点击转换。</span><div><button className="btn" onClick={() => p.onSkip(selected.id)}>跳过</button><button className="btn primary" onClick={() => p.onConfirm(selected, margins)}>转换并保存边距</button></div></div></main> : <div className="slice-empty large">请先在第一阶段选择或创建图片组。</div>}<aside className="slice-stage-side"><div className="nine-slice-list-title">图片组</div>{candidates.map((candidate) => <button key={candidate.id} className={`slice-stage-item ${candidate.id === selected?.id ? "on" : ""}`} onClick={() => choose(candidate.id, "mark")}><span>{sourceFor(candidate, entries)?.node.name ?? "图片已缺失"}</span><small>{statusLabel(candidate.status)}</small></button>)}</aside></div>}
    {tab === "result" && <div className="slice-stage result-stage"><main><div className="nine-slice-list-title">已生成的九宫格图片</div><p className="slice-stage-hint">这里不再确认边距。边距沿用第二阶段；如需调整，请返回“原图标记”。</p><div className="slice-result-grid">{confirmed.map((candidate) => { const entry = sourceFor(candidate, entries); const group = groupFor(candidate, groups); return <article className="slice-result-card" key={candidate.id}>{entry && <img src={entry.node.sliceImage?.toDataURL("image/png") ?? entry.image.toDataURL("image/png")} alt="" />}<strong>{entry?.node.name ?? "图片已缺失"}</strong><small>{group ? `边距：${group.margins.left} / ${group.margins.top} / ${group.margins.right} / ${group.margins.bottom}` : "等待保存生成资源"}</small><button className="btn" onClick={() => choose(candidate.id, "mark")}>返回第二阶段修改</button></article>; })}</div></main></div>}
  </section>;
}
