import { useEffect, useMemo, useRef, useState } from "react";
import type { NineSliceCandidate, NineSliceGroup, NineSliceMargins, UIScene } from "../types";
import { collectNineSliceImages, createManualNineSliceCandidate, sameNodeSet, type NineSliceImageEntry } from "../nineSlice";

type SliceTab = "mark" | "result";

function statusLabel(status: NineSliceCandidate["status"]): string {
  return status === "confirmed" ? "已完成" : status === "skipped" ? "已跳过" : "待处理";
}

function groupFor(candidate: NineSliceCandidate, groups: NineSliceGroup[]): NineSliceGroup | undefined {
  return groups.find((group) => group.id === candidate.id);
}

function sourceFor(candidate: NineSliceCandidate, entries: NineSliceImageEntry[]): NineSliceImageEntry | null {
  return entries.find((entry) => entry.node.id === candidate.sourceNodeId) ?? null;
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
}) {
  const entries = useMemo(() => collectNineSliceImages(p.scene), [p.scene]);
  const candidates = useMemo(() => p.scene.nineSliceCandidates ?? [], [p.scene.nineSliceCandidates]);
  const groups = useMemo(() => p.scene.nineSliceGroups ?? [], [p.scene.nineSliceGroups]);
  const [tab, setTab] = useState<SliceTab>("mark");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedEntries = selectedIds.map((id) => entries.find((entry) => entry.node.id === id)).filter((entry): entry is NineSliceImageEntry => Boolean(entry));
  const confirmedIds = useMemo(() => new Set(groups.flatMap((group) => group.memberNodeIds)), [groups]);
  // 已完成的图片默认从候选列表移除；从结果页返回修改时，仅把当前编辑组临时放回列表。
  const availableEntries = entries.filter((entry) => !confirmedIds.has(entry.node.id) || selectedIds.includes(entry.node.id));
  const pendingEntries = entries.filter((entry) => !confirmedIds.has(entry.node.id));
  const existingCandidate = selectedIds.length ? candidates.find((candidate) => sameNodeSet(candidate.memberNodeIds, selectedIds)) : undefined;
  const workingCandidate = existingCandidate ?? (selectedEntries.length ? createManualNineSliceCandidate(selectedEntries) : null);
  const displaySource = selectedEntries[0] ?? (existingCandidate ? sourceFor(existingCandidate, entries) : null);
  const savedGroup = workingCandidate ? groupFor(workingCandidate, groups) : undefined;
  const workingCandidateId = workingCandidate?.id;
  const workingCandidateMargins = workingCandidate?.suggestedMargins;
  const [margins, setMargins] = useState<NineSliceMargins>({ left: 0, top: 0, right: 0, bottom: 0 });

  useEffect(() => {
    if (!selectedIds.length && availableEntries[0]) setSelectedIds([availableEntries[0].node.id]);
    if (selectedIds.some((id) => !availableEntries.some((entry) => entry.node.id === id))) setSelectedIds([]);
  }, [availableEntries, selectedIds]);
  useEffect(() => {
    if (workingCandidateMargins) setMargins({ ...(savedGroup?.margins ?? workingCandidateMargins) });
  }, [workingCandidateId, savedGroup?.margins, workingCandidateMargins]);

  const confirmed = candidates.filter((candidate) => candidate.status === "confirmed");
  const toggleSelection = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const confirm = () => {
    if (!workingCandidate) return;
    p.onConfirm(workingCandidate, margins);
    setSelectedIds([]);
    setTab("result");
  };

  return <section className="nine-slice-workspace">
    <header className="nine-slice-head"><div><span className="workspace-kicker">ASSET PROCESSING</span><h2>九宫格</h2><p>从候选图片中选择一张或多张，在右侧统一标记边距并生成引擎使用的九宫格资源。</p></div>
      <div className="nine-slice-actions"><button className="btn" onClick={p.onScan}>更新候选</button><span className="nine-slice-count">待处理 {pendingEntries.length} · 已完成 {confirmed.length}</span></div></header>
    <nav className="slice-tabs" aria-label="九宫格阶段"><button className={tab === "mark" ? "on" : ""} onClick={() => setTab("mark")}>候选图片与边距标记</button><button className={tab === "result" ? "on" : ""} disabled={!confirmed.length} onClick={() => setTab("result")}>九宫格结果</button></nav>
    {tab === "mark" && <div className="slice-stage mark-stage slice-merged-stage"><aside className="slice-candidate-list"><div className="nine-slice-list-title">候选图片</div><p className="slice-stage-hint">可多选同源图片；右侧以第一张选中图片显示标记，确认后同组图片共用边距。</p>{!availableEntries.length && <div className="slice-empty">所有图片都已完成处理。</div>}{availableEntries.map((entry) => {
      const candidate = candidates.find((item) => item.memberNodeIds.includes(entry.node.id));
      return <button key={entry.node.id} className={`slice-candidate-image ${selectedIds.includes(entry.node.id) ? "selected" : ""}`} onClick={() => toggleSelection(entry.node.id)}>
        <img src={entry.image.toDataURL("image/png")} alt="" /><span><strong>{entry.node.name}</strong><small>{entry.image.width} × {entry.image.height}{candidate ? ` · ${statusLabel(candidate.status)}` : ""}</small></span><i>{selectedIds.includes(entry.node.id) ? "✓" : ""}</i>
      </button>;
    })}</aside><main className="nine-slice-editor-panel">{workingCandidate && displaySource ? <><div className="nine-slice-editor-title"><div><span>当前标记图 · 已选 {selectedEntries.length} 张</span><h3>{displaySource.node.name}</h3><small>{selectedEntries.length > 1 ? "其他选中图片将沿用同一组边距；最终源图仍按最大尺寸选择" : "单张图片"}</small></div><span className="nine-status status-suggested">待标记</span></div><SliceEditor source={displaySource} slice={margins} onChange={setMargins} /><div className="nine-slice-editor-foot"><span>边距值是本组图片共用的引擎九宫格参数。</span><button className="btn primary" onClick={confirm}>转换并保存</button></div></> : <div className="slice-empty large">请先从左侧选择候选图片。</div>}</main></div>}
    {tab === "result" && <div className="slice-stage result-stage"><main><div className="nine-slice-list-title">已生成的九宫格图片</div><p className="slice-stage-hint">边距沿用候选与标记页；如需调整，请回到上一页重新选择并标记。</p><div className="slice-result-grid">{confirmed.map((candidate) => { const entry = sourceFor(candidate, entries); const group = groupFor(candidate, groups); return <article className="slice-result-card" key={candidate.id}>{entry && <img src={entry.node.sliceImage?.toDataURL("image/png") ?? entry.image.toDataURL("image/png")} alt="" />}<strong>{entry?.node.name ?? "图片已缺失"}</strong><small>{group ? `边距：${group.margins.left} / ${group.margins.top} / ${group.margins.right} / ${group.margins.bottom}` : "等待保存生成资源"}</small><button className="btn" onClick={() => { setSelectedIds(candidate.memberNodeIds); setTab("mark"); }}>返回修改</button></article>; })}</div></main></div>}
  </section>;
}
