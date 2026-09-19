import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LayoutResult, NineSliceCandidate, NineSliceGroup, NineSliceMargins, UIScene } from "../types";
import { bulkMarginsValidationError, collectNineSliceImages, createManualNineSliceCandidate, parseBulkMargins, rankNineSliceEntries, retainKnownNineSliceSelection, sameNodeSet, type NineSliceImageEntry } from "../nineSlice";
import { applySelection, createSelectionIntent } from "../selection";
import SceneOverview from "./SceneOverview";
import { Icon } from "./Icon";

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
    <i>{p.selected ? <Icon name="check" size={14} /> : null}</i>
  </>;
  if (p.handledStatus) return <div className="slice-candidate-image handled">{content}</div>;
  return <button type="button" className={`slice-candidate-image ${p.selected ? "selected" : ""}`} onClick={p.onClick}>{content}</button>;
}

export function SliceEditor(p: { source: NineSliceImageEntry; slice: NineSliceMargins; onChange: (slice: NineSliceMargins) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"top" | "bottom" | "left" | "right" | null>(null);
  const scaleRef = useRef({ x: 1, y: 1 });
  const [bulkMargins, setBulkMargins] = useState("");
  const [bulkError, setBulkError] = useState("");

  useEffect(() => {
    // 切换图片时显示当前边距；拖拽标记线后也会由 p.slice 同步到输入框。
    setBulkMargins(`${p.slice.top},${p.slice.bottom},${p.slice.left},${p.slice.right}`);
    setBulkError("");
  }, [p.source.node.id, p.slice]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const image = p.source.image;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(0.25, Math.min(300 / image.width, 210 / image.height, 8));
    cv.width = Math.max(1, Math.round(image.width * scale * dpr));
    cv.height = Math.max(1, Math.round(image.height * scale * dpr));
    cv.style.width = `${image.width * scale}px`;
    cv.style.height = `${image.height * scale}px`;
    const context = cv.getContext("2d");
    if (!context) return;
    cv.style.cursor = "crosshair";
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
    // getBoundingClientRect 包含应用整体缩放；不能继续使用未缩放的内部 scale，
    // 否则鼠标越靠近右侧/下侧，换算误差越明显。
    const scaleX = rect.width / Math.max(1, p.source.image.width);
    const scaleY = rect.height / Math.max(1, p.source.image.height);
    scaleRef.current = { x: scaleX, y: scaleY };
    return {
      x: Math.max(0, Math.min(p.source.image.width, Math.round((event.clientX - rect.left) / Math.max(.01, scaleX)))),
      y: Math.max(0, Math.min(p.source.image.height, Math.round((event.clientY - rect.top) / Math.max(.01, scaleY)))),
    };
  };
  const lineAt = (x: number, y: number): "top" | "bottom" | "left" | "right" | null => {
    const { width, height } = p.source.image;
    const thresholdX = 9 / Math.max(.01, scaleRef.current.x);
    const thresholdY = 9 / Math.max(.01, scaleRef.current.y);
    const distances: ["top" | "bottom" | "left" | "right", number][] = [
      ["top", Math.abs(y - p.slice.top) / thresholdY], ["bottom", Math.abs(y - (height - p.slice.bottom)) / thresholdY],
      ["left", Math.abs(x - p.slice.left) / thresholdX], ["right", Math.abs(x - (width - p.slice.right)) / thresholdX],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][1] <= 1 ? distances[0][0] : null;
  };
  const setCursorForLine = (canvas: HTMLCanvasElement, line: "top" | "bottom" | "left" | "right" | null) => {
    canvas.style.cursor = line === "left" || line === "right" ? "ew-resize" : line ? "ns-resize" : "crosshair";
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    const hit = lineAt(point.x, point.y);
    if (!hit) return;
    dragRef.current = hit;
    setCursorForLine(event.currentTarget, hit);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    const hit = dragRef.current;
    if (!hit) {
      const near = lineAt(point.x, point.y);
      setCursorForLine(event.currentTarget, near);
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
  const onPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };
  const applyBulkMargins = () => {
    const validationError = bulkMarginsValidationError(bulkMargins, p.source.image.width, p.source.image.height);
    if (validationError) {
      setBulkError(validationError);
      return;
    }
    const next = parseBulkMargins(bulkMargins, p.source.image.width, p.source.image.height);
    if (!next) {
      setBulkError("批量边距无法应用，请检查输入格式");
      return;
    }
    setBulkError("");
    p.onChange(next);
  };
  return <div className="slice-editor"><div className="slice-preview"><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} /></div>
    <div className="slice-nums"><div className="slice-bulk-margins"><label htmlFor="slice-bulk-input"><span>批量设置</span><small>{p.source.image.width} × {p.source.image.height}</small></label><input id="slice-bulk-input" value={bulkMargins} placeholder="上,下,左,右 或 4" onChange={(event) => { setBulkMargins(event.target.value); setBulkError(""); }} onKeyDown={(event) => { if (event.key === "Enter") applyBulkMargins(); }} /><button type="button" className="btn" onClick={applyBulkMargins}>应用</button></div>{bulkError && <div className="slice-bulk-error">{bulkError}</div>}</div></div>;
}

export interface NineSliceWorkspaceProps {
  scene: UIScene;
  layout: LayoutResult | null;
  viewport: { width: number; height: number };
  onScan: () => void;
  onConfirm: (candidate: NineSliceCandidate, margins: NineSliceMargins) => void;
  onSkip: (candidate: NineSliceCandidate) => void;
}

interface NineSliceState {
  scene: UIScene | null;
  layout: LayoutResult | null;
  viewport: { width: number; height: number };
  tab: SliceTab;
  setTab: (tab: SliceTab) => void;
  entries: NineSliceImageEntry[];
  candidates: NineSliceCandidate[];
  groups: NineSliceGroup[];
  confirmed: NineSliceCandidate[];
  selectedIds: string[];
  selectedEntries: NineSliceImageEntry[];
  rankedAvailableEntries: NineSliceImageEntry[];
  handledEntries: NineSliceImageEntry[];
  candidateForEntry: (id: string) => NineSliceCandidate | undefined;
  workingCandidate: NineSliceCandidate | null;
  displaySource: NineSliceImageEntry | null;
  margins: NineSliceMargins;
  setMargins: (margins: NineSliceMargins) => void;
  scan: () => void;
  selectCandidate: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
  selectEntry: (id: string) => void;
  selectEntries: (ids: string[]) => void;
  clearCandidateSelection: (event: React.PointerEvent<HTMLDivElement>) => void;
  confirm: () => void;
  skip: () => void;
}

const NineSliceContext = createContext<NineSliceState | null>(null);

export function useNineSliceWorkspace(): NineSliceState {
  const state = useContext(NineSliceContext);
  if (!state) throw new Error("useNineSliceWorkspace 必须在 NineSliceWorkspaceProvider 内使用");
  return state;
}

export function NineSliceWorkspaceProvider(p: Omit<NineSliceWorkspaceProps, "scene"> & { scene: UIScene | null; children: ReactNode }) {
  const entries = useMemo(() => p.scene ? collectNineSliceImages(p.scene) : [], [p.scene]);
  const candidates = useMemo(() => p.scene?.nineSliceCandidates ?? [], [p.scene?.nineSliceCandidates]);
  const groups = useMemo(() => p.scene?.nineSliceGroups ?? [], [p.scene?.nineSliceGroups]);
  const [tab, setTab] = useState<SliceTab>("mark");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const initialSelectionDoneRef = useRef(false);
  const selectedEntries = useMemo(
    () => selectedIds.map((id) => entries.find((entry) => entry.node.id === id)).filter((entry): entry is NineSliceImageEntry => Boolean(entry)),
    [entries, selectedIds],
  );
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
  const handledEntries = entries.filter((entry) => handledIds.has(entry.node.id));
  const existingCandidate = selectedIds.length ? candidates.find((candidate) => sameNodeSet(candidate.memberNodeIds, selectedIds)) : undefined;
  const workingCandidate = useMemo(
    () => existingCandidate ?? (selectedEntries.length ? createManualNineSliceCandidate(selectedEntries) : null),
    [existingCandidate, selectedEntries],
  );
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
  }, [availableEntries, entries]);
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
  const selectEntries = (ids: string[]) => {
    const knownIds = ids.filter((id) => entries.some((entry) => entry.node.id === id));
    selectionAnchorRef.current = knownIds[0] ?? null;
    setSelectedIds(knownIds);
  };
  const selectEntry = (id: string) => {
    selectEntries([id]);
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

  const state: NineSliceState = {
    scene: p.scene,
    layout: p.layout,
    viewport: p.viewport,
    tab,
    setTab,
    entries,
    candidates,
    groups,
    confirmed,
    selectedIds,
    selectedEntries,
    rankedAvailableEntries,
    handledEntries,
    candidateForEntry,
    workingCandidate,
    displaySource,
    margins,
    setMargins,
    scan: p.onScan,
    selectCandidate,
    selectEntry,
    selectEntries,
    clearCandidateSelection,
    confirm,
    skip,
  };

  return <NineSliceContext.Provider value={state}>{p.children}</NineSliceContext.Provider>;
}

export function NineSliceCandidatesTool() {
  const state = useNineSliceWorkspace();
  const handledCount = state.handledEntries.length;
  return <section className="nine-slice-candidates-tool">
    <nav className="slice-tabs" aria-label="九宫格候选与结果">
      <div className="slice-tab-list">
        <button className={state.tab === "mark" ? "on" : ""} onClick={() => state.setTab("mark")}>候选图片</button>
        <button className={state.tab === "result" ? "on" : ""} disabled={!state.confirmed.length} onClick={() => state.setTab("result")}>九宫格结果</button>
      </div>
      <div className="slice-tabs-actions"><button className="btn" onClick={state.scan}>更新候选</button><span className="nine-slice-count">待处理 {state.rankedAvailableEntries.length} · 已处理 {state.entries.filter((entry) => state.candidates.some((candidate) => candidate.status === "confirmed" && candidate.memberNodeIds.includes(entry.node.id))).length} · 已跳过 {state.entries.filter((entry) => state.candidates.some((candidate) => candidate.status === "skipped" && candidate.memberNodeIds.includes(entry.node.id))).length}</span></div>
    </nav>
    {state.tab === "mark" ? <div className="slice-candidates-scroll" onPointerDown={state.clearCandidateSelection}>
      <div className="nine-slice-list-title">候选图片</div>
      {!state.rankedAvailableEntries.length && <div className="slice-empty">没有待处理候选图片。</div>}
      <div className="slice-candidate-grid">{state.rankedAvailableEntries.map((entry) => <NineSliceImageCard
        key={entry.node.id}
        entry={entry}
        candidate={state.candidateForEntry(entry.node.id)}
        selected={state.selectedIds.includes(entry.node.id)}
        onClick={(event) => state.selectCandidate(event, entry.node.id)}
      />)}</div>
      <section className="slice-handled-section">
        <div className="nine-slice-list-title">已处理 / 已跳过</div>
        {!handledCount && <div className="slice-empty">暂无已处理图片。</div>}
        <div className="slice-candidate-grid slice-handled-grid">{state.handledEntries.map((entry) => <NineSliceImageCard
          key={entry.node.id}
          entry={entry}
          candidate={state.candidateForEntry(entry.node.id)}
          handledStatus={state.candidateForEntry(entry.node.id)?.status === "skipped" ? "已跳过" : "已处理"}
        />)}</div>
      </section>
    </div> : <div className="slice-results-scroll">
      <div className="nine-slice-list-title">已生成的九宫格图片</div>
      <p className="slice-stage-hint">边距沿用标记工具；如需调整，请回到标记工具重新选择并标记。</p>
      <div className="slice-result-grid">{state.confirmed.map((candidate) => { const entry = sourceFor(candidate, state.entries); const group = groupFor(candidate, state.groups); const output = entry?.node.sliceImage ?? entry?.image; return <article className="slice-result-card" key={candidate.id}>{output && <img src={output.toDataURL("image/png")} alt="" />}<strong>{entry?.node.name ?? "图片已缺失"}</strong><small>{output ? `尺寸：${output.width} × ${output.height}` : "尺寸：未知"}{group ? ` · 边距：${group.margins.left} / ${group.margins.top} / ${group.margins.right} / ${group.margins.bottom}` : " · 等待保存生成资源"}</small><button className="btn" onClick={() => { state.selectEntries(candidate.memberNodeIds); state.setTab("mark"); }}>返回修改</button></article>; })}</div>
    </div>}
  </section>;
}

export function NineSliceMarkerTool() {
  const state = useNineSliceWorkspace();
  const { workingCandidate, displaySource } = state;
  return <section className="nine-slice-marker-tool">
    <div className="nine-slice-marker-scroll">{state.tab === "result" ? <div className="slice-empty large">请从左侧九宫格结果卡片返回标记，或切换到候选图片。</div> : workingCandidate && displaySource ? <>
      <div className="nine-slice-editor-title"><div className="nine-slice-editor-title-main"><h3>{displaySource.node.name}</h3><span>已选 {state.selectedEntries.length} 张</span></div><span className={`nine-status status-${workingCandidate.status}`}>{workingCandidate.status === "confirmed" ? "已处理" : workingCandidate.status === "skipped" ? "已跳过" : "待标记"}</span></div>
      <SliceEditor source={displaySource} slice={state.margins} onChange={state.setMargins} />
    </> : <div className="slice-empty large">请先从九宫格候选工具选择图片。</div>}</div>
    {state.tab === "mark" && workingCandidate && displaySource && <div className="nine-slice-editor-foot"><span>边距值是本组图片共用的引擎九宫格参数。</span><div><button className="btn" onClick={state.skip}>跳过处理</button><button className="btn primary" onClick={state.confirm}>转换并保存</button></div></div>}
  </section>;
}

export function NineSliceOverviewTool(p: { result: LayoutResult | null; nodes: UIScene["nodes"]; viewport: { width: number; height: number } }) {
  const state = useNineSliceWorkspace();
  return <SceneOverview result={p.result} nodes={state.scene?.nodes ?? p.nodes} viewport={p.viewport}
    selectedId={state.displaySource?.node.id ?? null} onLocate={state.selectEntry} useNineSlice={state.scene?.useNineSlicePreview} />;
}

function LegacyNineSliceWorkspace() {
  const state = useNineSliceWorkspace();
  return <section className="nine-slice-workspace">
    <div className="slice-stage mark-stage slice-merged-stage">
      <aside className="slice-candidate-list legacy-slice-candidate-list"><NineSliceCandidatesTool /></aside>
      <main className="nine-slice-editor-panel"><div className="nine-slice-overview"><NineSliceOverviewTool result={state.layout} nodes={state.scene?.nodes ?? []} viewport={state.viewport} /></div><NineSliceMarkerTool /></main>
    </div>
  </section>;
}

export default function NineSliceWorkspace(p: NineSliceWorkspaceProps) {
  return <NineSliceWorkspaceProvider {...p}>{<LegacyNineSliceWorkspace />}</NineSliceWorkspaceProvider>;
}
