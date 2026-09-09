import { useEffect, useMemo, useRef, useState } from "react";
import type { NineSliceCandidate, NineSliceMargins, UIScene } from "../types";
import { collectNineSliceImages, createManualNineSliceCandidate, type NineSliceImageEntry } from "../nineSlice";

function statusLabel(status: NineSliceCandidate["status"]): string {
  return status === "confirmed" ? "已确认" : status === "skipped" ? "已跳过" : "待确认";
}

function sourceFor(candidate: NineSliceCandidate, entries: NineSliceImageEntry[]): NineSliceImageEntry | null {
  return entries.find((entry) => entry.node.id === candidate.sourceNodeId) ?? null;
}

export function SliceEditor(p: {
  source: NineSliceImageEntry;
  slice: NineSliceMargins;
  onChange: (slice: NineSliceMargins) => void;
}) {
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
  return <div className="slice-editor">
    <div className="slice-preview"><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} /></div>
    <div className="slice-nums">{(["left", "top", "right", "bottom"] as const).map((key) => <label className="slice-num" key={key}>
      <span>{key === "left" ? "左" : key === "top" ? "上" : key === "right" ? "右" : "下"}</span>
      <input type="number" min="0" value={p.slice[key]} onChange={(event) => setMargin(key, +event.target.value)} />
    </label>)}</div>
  </div>;
}

export default function NineSliceWorkspace(p: {
  scene: UIScene;
  onScan: () => void;
  onConfirm: (candidate: NineSliceCandidate, margins: NineSliceMargins) => void;
  onSkip: (candidateId: string) => void;
  onRestoreSkipped: () => void;
  onManualCreate: (candidate: NineSliceCandidate) => void;
}) {
  const entries = useMemo(() => collectNineSliceImages(p.scene), [p.scene]);
  const candidates = useMemo(() => p.scene.nineSliceCandidates ?? [], [p.scene.nineSliceCandidates]);
  const [selectedId, setSelectedId] = useState<string | null>(candidates[0]?.id ?? null);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? null;
  const source = selected ? sourceFor(selected, entries) : null;
  const [margins, setMargins] = useState<NineSliceMargins>(selected?.suggestedMargins ?? { left: 0, top: 0, right: 0, bottom: 0 });
  useEffect(() => {
    const current = candidates.find((candidate) => candidate.id === selectedId);
    if (!current) { setSelectedId(candidates[0]?.id ?? null); return; }
    setMargins({ ...current.suggestedMargins });
  }, [candidates, selectedId]);

  const pending = candidates.filter((candidate) => candidate.status === "suggested");
  const skipped = candidates.filter((candidate) => candidate.status === "skipped");
  const confirmed = candidates.filter((candidate) => candidate.status === "confirmed");
  const toggleManual = (id: string) => setManualIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const createManual = () => {
    const selectedEntries = entries.filter((entry) => manualIds.includes(entry.node.id));
    if (!selectedEntries.length) return;
    const candidate = createManualNineSliceCandidate(selectedEntries);
    p.onManualCreate(candidate);
    setManualIds([]);
    setSelectedId(candidate.id);
  };

  return <section className="nine-slice-workspace">
    <header className="nine-slice-head"><div><span className="workspace-kicker">ASSET PROCESSING</span><h2>九宫格</h2><p>本地规则只提供建议，确认后才会影响工程预览。</p></div>
      <div className="nine-slice-actions"><button className="btn primary" onClick={p.onScan}>扫描 / 更新候选</button><button className="btn" disabled={!skipped.length} onClick={p.onRestoreSkipped}>恢复已跳过</button></div></header>
    <div className="nine-slice-summary"><span>待确认 <strong>{pending.length}</strong></span><span>已确认 <strong>{confirmed.length}</strong></span><span>已跳过 <strong>{skipped.length}</strong></span><span>图片资源 <strong>{entries.length}</strong></span></div>
    <div className="nine-slice-body"><aside className="nine-slice-candidates"><div className="nine-slice-list-title">候选列表</div>
      {!candidates.length && <div className="slice-empty">点击“扫描 / 更新候选”开始分析工程图片。</div>}
      {candidates.map((candidate) => { const entry = sourceFor(candidate, entries); return <button key={candidate.id} className={`nine-candidate ${candidate.id === selected?.id ? "on" : ""} status-${candidate.status}`} onClick={() => setSelectedId(candidate.id)}>
        {entry && <img src={entry.image.toDataURL("image/png")} alt="" />}<span><strong>{entry?.node.name ?? "图片已缺失"}</strong><small>{candidate.memberNodeIds.length > 1 ? `${candidate.memberNodeIds.length} 个同源图 · ` : ""}{statusLabel(candidate.status)}</small></span><em>{Math.round(candidate.confidence * 100)}%</em>
      </button>; })}</aside>
      <main className="nine-slice-editor-panel">{selected && source ? <><div className="nine-slice-editor-title"><div><span>公共源图</span><h3>{source.node.name}</h3><small>{selected.memberNodeIds.length > 1 ? `同源图片 ${selected.memberNodeIds.length} 张，已选择最大分辨率源图` : "单张图片"}</small></div><span className={`nine-status status-${selected.status}`}>{statusLabel(selected.status)}</span></div>
        <p className="nine-slice-reason">{selected.reason}</p><SliceEditor source={source} slice={margins} onChange={setMargins} />
        <div className="nine-slice-editor-foot"><span>拖动边界线或直接输入边距；原图始终保留。</span><div><button className="btn" onClick={() => p.onSkip(selected.id)}>{selected.status === "skipped" ? "保持跳过" : "跳过"}</button><button className="btn primary" disabled={selected.status === "confirmed"} onClick={() => p.onConfirm(selected, margins)}>{selected.status === "confirmed" ? "已确认" : "确认并应用"}</button></div></div>
      </> : <div className="slice-empty large">选择候选后在这里确认九宫格边界。</div>}</main>
      <aside className="nine-slice-manual"><div className="nine-slice-list-title">手动补选</div><p>算法没推荐的图片，可以在这里多选并归为同一逻辑图片组。</p><div className="nine-manual-list">{entries.map((entry) => <label key={entry.node.id} className="nine-manual-item"><input type="checkbox" checked={manualIds.includes(entry.node.id)} onChange={() => toggleManual(entry.node.id)} /><img src={entry.image.toDataURL("image/png")} alt="" /><span>{entry.node.name}</span></label>)}</div><button className="btn" disabled={!manualIds.length} onClick={createManual}>创建手动候选{manualIds.length ? `（${manualIds.length}）` : ""}</button></aside>
    </div>
  </section>;
}
