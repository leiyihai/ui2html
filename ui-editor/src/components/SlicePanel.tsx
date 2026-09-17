import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutResult, NineSliceCandidate, NineSliceGroup, NineSliceMargins, UIScene } from "../types";
import { collectNineSliceImages, createManualNineSliceCandidate, parseBulkMargins, rankNineSliceEntries, retainKnownNineSliceSelection, sameNodeSet, type NineSliceImageEntry } from "../nineSlice";
import { applySelection, createSelectionIntent } from "../selection";
import SceneOverview from "./SceneOverview";

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

export function NineSliceImageCard(p: {
  entry: NineSliceImageEntry;
  candidate?: NineSliceCandidate;
  selected?: boolean;
  handledStatus?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const content = <>
    <img src={p.entry.image.toDataURL("image/png")} alt="" />
    <span><strong>{p.entry.node.name}</strong><small>{p.entry.image.width} × {p.entry.image.height}{p.handledStatus ? ` · ${p.handledStatus}` : p.candidate ? ` · ${statusLabel(p.candidate.status)}` : ""}</small></span>
    <i>{p.selected ? "✓" : ""}</i>
  </>;
  if (p.handledStatus) return <div className="slice-candidate-image handled">{content}</div>;
  return <button type="button" className={`slice-candidate-image ${p.selected ? "selected" : ""}`} onClick={p.onClick}>{content}</button>;
}

export function SliceEditor(p: { source: NineSliceImageEntry; slice: NineSliceMargins; onChange: (slice: NineSliceMargins) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"top" | "bottom" | "left" | "right" | null>(null);
  const scaleRef = useRef(1);
  const [bulkMargins, setBulkMargins] = useState("");
  const [bulkError, setBulkError] = useState("");

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const image = p.source.image;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(0.25, Math.min(300 / image.width, 210 / image.height, 8));
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
    context.strokeStyle = "rgba(110, 216, 223, .9)";
    context.lineWidth = Math.max(0.5, 0.75 / scale);
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
  const applyBulkMargins = () => {
    const next = parseBulkMargins(bulkMargins, p.source.image.width, p.source.image.height);
    if (!next) {
      setBulkError("请输入一个数，或按“上,下,左,右”输入四个非负整数");
      return;
    }
    setBulkError("");
    p.onChange(next);
  };
  return <div className="slice-editor"><div className="slice-preview"><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} /></div>
    <div className="slice-nums"><div className="slice-bulk-margins"><label htmlFor="slice-bulk-input">批量设置</label><input id="slice-bulk-input" value={bulkMargins} placeholder="上,下,左,右 或 4" onChange={(event) => { setBulkMargins(event.target.value); setBulkError(""); }} onKeyDown={(event) => { if (event.key === "Enter") applyBulkMargins(); }} /><button type="button" className="btn" onClick={applyBulkMargins}>应用</button></div>{bulkError && <div className="slice-bulk-error">{bulkError}</div>}<div className="slice-edge-margins">{(["left", "top", "right", "bottom"] as const).map((key) => <label className="slice-num" key={key}>
      <span>{key === "left" ? "左" : key === "top" ? "上" : key === "right" ? "右" : "下"}</span><input type="number" min="0" value={p.slice[key]} onChange={(event) => setMargin(key, +event.target.value)} />
    </label>)}</div></div></div>;
}

export default function NineSliceWorkspace(p: {
  scene: UIScene;
  layout: LayoutResult | null;
  viewport: { width: number; height: number };
  onScan: () => void;
  onConfirm: (candidate: NineSliceCandidate, margins: NineSliceMargins) => void;
  onSkip: (candidate: NineSliceCandidate) => void;
}) {
  const entries = useMemo(() => collectNineSliceImages(p.scene), [p.scene]);
  const candidates = useMemo(() => p.scene.nineSliceCandidates ?? [], [p.scene.nineSliceCandidates]);
  const groups = useMemo(() => p.scene.nineSliceGroups ?? [], [p.scene.nineSliceGroups]);
  const [tab, setTab] = useState<SliceTab>("mark");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const initialSelectionDoneRef = useRef(false);
  const selectedEntries = selectedIds.map((id) => entries.find((entry) => entry.node.id === id)).filter((entry): entry is NineSliceImageEntry => Boolean(entry));
  const confirmedIds = useMemo(() => new Set([
    ...groups.flatMap((group) => group.memberNodeIds),
    ...candidates.filter((candidate) => candidate.status === "confirmed").flatMap((candidate) => candidate.memberNodeIds),
  ]), [candidates, groups]);
  const skippedIds = useMemo(() => new Set(candidates
    .filter((candidate) => candidate.status === "skipped")
    .flatMap((candidate) => candidate.memberNodeIds)), [candidates]);
  const handledIds = useMemo(() => new Set([...confirmedIds, ...skippedIds]), [confirmedIds, skippedIds]);
  // 已处理或已跳过的图片移到下方；从结果页返回修改时仍可通过当前选中项打开编辑区。
  const availableEntries = entries.filter((entry) => !handledIds.has(entry.node.id));
  const rankedAvailableEntries = useMemo(
    () => rankNineSliceEntries(availableEntries, candidates),
    [availableEntries, candidates],
  );
  const pendingEntries = availableEntries;
  const handledEntries = entries.filter((entry) => handledIds.has(entry.node.id));
  const existingCandidate = selectedIds.length ? candidates.find((candidate) => sameNodeSet(candidate.memberNodeIds, selectedIds)) : undefined;
  const workingCandidate = existingCandidate ?? (selectedEntries.length ? createManualNineSliceCandidate(selectedEntries) : null);
  const displaySource = selectedEntries[0] ?? (existingCandidate ? sourceFor(existingCandidate, entries) : null);
  const savedGroup = workingCandidate ? groupFor(workingCandidate, groups) : undefined;
  const workingCandidateId = workingCandidate?.id;
  const workingCandidateMargins = workingCandidate?.suggestedMargins;
  const [margins, setMargins] = useState<NineSliceMargins>({ left: 0, top: 0, right: 0, bottom: 0 });

  useEffect(() => {
    setSelectedIds((current) => {
      const next = retainKnownNineSliceSelection(current, entries);
      if (!initialSelectionDoneRef.current && !next.length && availableEntries[0]) {
        const firstId = availableEntries[0].node.id;
        selectionAnchorRef.current = firstId;
        initialSelectionDoneRef.current = true;
        return [firstId];
      }
      return next.length === current.length ? current : next;
    });
  }, [availableEntries]);
  useEffect(() => {
    if (workingCandidateMargins) setMargins({ ...(savedGroup?.margins ?? workingCandidateMargins) });
  }, [workingCandidateId, savedGroup?.margins, workingCandidateMargins]);

  const confirmed = candidates.filter((candidate) => candidate.status === "confirmed");
  const candidateForEntry = (id: string) => candidates
    .filter((candidate) => candidate.memberNodeIds.includes(id))
    .sort((left, right) => Number(left.status === "suggested") - Number(right.status === "suggested"))[0];
  const selectCandidate = (event: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const orderedIds = rankedAvailableEntries.map((entry) => entry.node.id);
    const next = applySelection(
      selectedIds,
      id,
      selectionAnchorRef.current,
      createSelectionIntent(event, orderedIds),
    );
    selectionAnchorRef.current = event.shiftKey
      ? next.anchorId ?? selectionAnchorRef.current ?? id
      : id;
    setSelectedIds(next.ids);
  };
  const clearCandidateSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      selectionAnchorRef.current = null;
      setSelectedIds([]);
    }
  };
  const confirm = () => {
    if (!workingCandidate) return;
    p.onConfirm(workingCandidate, margins);
    selectionAnchorRef.current = null;
    const next = rankedAvailableEntries.find((entry) => !selectedIds.includes(entry.node.id));
    setSelectedIds(next ? [next.node.id] : []);
  };
  const skip = () => {
    if (!selectedEntries.length) return;
    const skippedCandidate = {
      ...(existingCandidate ?? createManualNineSliceCandidate(selectedEntries)),
      memberNodeIds: selectedEntries.map((entry) => entry.node.id).sort(),
      status: "skipped" as const,
      reason: "用户手动跳过九宫格处理",
    };
    p.onSkip(skippedCandidate);
    selectionAnchorRef.current = null;
    const next = rankedAvailableEntries.find((entry) => !selectedIds.includes(entry.node.id));
    setSelectedIds(next ? [next.node.id] : []);
  };

  return <section className="nine-slice-workspace">
    <nav className="slice-tabs" aria-label="九宫格阶段">
      <div className="slice-tab-list"><button className={tab === "mark" ? "on" : ""} onClick={() => setTab("mark")}>候选图片与边距标记</button><button className={tab === "result" ? "on" : ""} disabled={!confirmed.length} onClick={() => setTab("result")}>九宫格结果</button></div>
      <div className="slice-tabs-actions"><button className="btn" onClick={p.onScan}>更新候选</button><span className="nine-slice-count">待处理 {pendingEntries.length} · 已处理 {entries.filter((entry) => confirmedIds.has(entry.node.id)).length} · 已跳过 {entries.filter((entry) => skippedIds.has(entry.node.id)).length}</span></div>
    </nav>
    {tab === "mark" && <div className="slice-stage mark-stage slice-merged-stage">
      <aside className="slice-candidate-list">
        <div className="nine-slice-list-title">候选图片</div>
        {!rankedAvailableEntries.length && <div className="slice-empty">没有待处理候选图片。</div>}
        <div className="slice-candidate-grid" onPointerDown={clearCandidateSelection}>{rankedAvailableEntries.map((entry) => <NineSliceImageCard
          key={entry.node.id}
          entry={entry}
          candidate={candidateForEntry(entry.node.id)}
          selected={selectedIds.includes(entry.node.id)}
          onClick={(event) => selectCandidate(event, entry.node.id)}
        />)}</div>
        <section className="slice-handled-section">
          <div className="nine-slice-list-title">已处理 / 已跳过</div>
          {!handledEntries.length && <div className="slice-empty">暂无已处理图片。</div>}
          <div className="slice-candidate-grid slice-handled-grid">{handledEntries.map((entry) => <NineSliceImageCard
            key={entry.node.id}
            entry={entry}
            candidate={candidateForEntry(entry.node.id)}
            handledStatus={candidateForEntry(entry.node.id)?.status === "skipped" ? "已跳过" : "已处理"}
          />)}</div>
        </section>
      </aside>
      <main className="nine-slice-editor-panel"><div className="nine-slice-overview"><SceneOverview
        result={p.layout}
        nodes={p.scene.nodes}
        viewport={p.viewport}
        selectedId={displaySource?.node.id ?? null}
        onLocate={(id) => { if (entries.some((entry) => entry.node.id === id)) { selectionAnchorRef.current = id; setSelectedIds([id]); } }}
        useNineSlice={p.scene.useNineSlicePreview}
      /></div>{workingCandidate && displaySource ? <><div className="nine-slice-editor-title"><div><span>当前标记图 · 已选 {selectedEntries.length} 张</span><h3>{displaySource.node.name}</h3><small>{selectedEntries.length > 1 ? "其他选中图片将沿用同一组边距；最终源图仍按最大尺寸选择" : "单张图片"}</small></div><span className={`nine-status status-${workingCandidate.status}`}>{workingCandidate.status === "confirmed" ? "已处理" : workingCandidate.status === "skipped" ? "已跳过" : "待标记"}</span></div><SliceEditor source={displaySource} slice={margins} onChange={setMargins} /><div className="nine-slice-editor-foot"><span>边距值是本组图片共用的引擎九宫格参数。</span><div><button className="btn" onClick={skip}>跳过处理</button><button className="btn primary" onClick={confirm}>转换并保存</button></div></div></> : <div className="slice-empty large">请先从左侧选择候选图片。</div>}</main>
    </div>}
    {tab === "result" && <div className="slice-stage result-stage"><main><div className="nine-slice-list-title">已生成的九宫格图片</div><p className="slice-stage-hint">边距沿用候选与标记页；如需调整，请回到上一页重新选择并标记。</p><div className="slice-result-grid">{confirmed.map((candidate) => { const entry = sourceFor(candidate, entries); const group = groupFor(candidate, groups); const output = entry?.node.sliceImage ?? entry?.image; return <article className="slice-result-card" key={candidate.id}>{output && <img src={output.toDataURL("image/png")} alt="" />}<strong>{entry?.node.name ?? "图片已缺失"}</strong><small>{output ? `尺寸：${output.width} × ${output.height}` : "尺寸：未知"}{group ? ` · 边距：${group.margins.left} / ${group.margins.top} / ${group.margins.right} / ${group.margins.bottom}` : " · 等待保存生成资源"}</small><button className="btn" onClick={() => { setSelectedIds(candidate.memberNodeIds); setTab("mark"); }}>返回修改</button></article>; })}</div></main></div>}
  </section>;
}
