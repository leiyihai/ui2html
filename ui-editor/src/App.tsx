import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutEngine, reanchor } from "./layoutEngine";
import { importPsd } from "./psdImport";
import { renderOverlay, renderUi } from "./renderer";
import { buildExportHtml } from "./exportHtml";
import { buildEngineJson, createEngineAssetManifest } from "./engineExport";
import type { CtrlType, ImageBinding, InteractionTemplate, LayoutContext, NineSliceCandidate, NineSliceMargins, ResourceSlot, ScaleMode, UINode, UIScene } from "./types";
import Appbar from "./components/Toolbar";
import Workbar, { type Workspace } from "./components/WorkspaceTabs";
import Inspector from "./components/Inspector";
import ControlsPanel, { type LayerNameMode } from "./components/ControlsPanel";
import TypePieMenu from "./components/TypePieMenu";
import QuickActionMenu from "./components/QuickActionMenu";
import { markControlType } from "./controlType";
import { canConfirmResourceBinding, hasResourceSlots, planResourceBindings, resourceSlotDefinitions } from "./resourceBinding";
import { moveLayerOrder, type LayerOrderDirection } from "./layerOrder";
import { createEmptyAnalysis, restoreSceneSnapshot, serializeScene, type SavedProjectView } from "./scenePersistence";
import { prepareSceneAssets } from "./projectAssets";
import { openProject, projectFileName, saveProject } from "./projectApi";
import { requestAiNaming } from "./projectApi";
import { canvasFromImageFile, createImageNode } from "./imageImport";
import { applySelection, createSelectionIntent, flattenLayerIds, type SelectionIntent } from "./selection";
import { quickControlName } from "./nodeNaming";
import { applyAiNaming, buildNamingManifest, warningNodeIds } from "./aiNaming";
import type { ProjectAnalysis } from "./types";
import { presetsForDesign, type DeviceShell } from "./devicePreview";
import ResourceBindingWorkspace from "./components/ResourceBindingWorkspace";
import SceneOverview from "./components/SceneOverview";
import NineSliceWorkspace from "./components/SlicePanel";
import { generateNineSliceImage, groupFromCandidate, scanNineSliceCandidates } from "./nineSlice";
import { syncNodeLayoutPosition } from "./layoutValues";

export interface ImportProgress {
  name: string;
  phase: string;
  progress: number;
}

// 树工具：组节点含 children，节点操作需要递归
function walkNodes(nodes: UINode[], out: UINode[] = []): UINode[] {
  for (const n of nodes) { out.push(n); if (n.children) walkNodes(n.children, out); }
  return out;
}
function mapNodes(nodes: UINode[], id: string, fn: (n: UINode) => void): UINode[] {
  return nodes.map((n) => {
    if (n.id === id) { const c = { ...n }; fn(c); return c; }
    if (n.children) return { ...n, children: mapNodes(n.children, id, fn) };
    return n;
  });
}
function mapNodesByIds(nodes: UINode[], ids: Set<string>, fn: (n: UINode) => void): UINode[] {
  return nodes.map((node) => {
    const next = ids.has(node.id) ? { ...node } : node;
    if (ids.has(node.id)) fn(next);
    const children = next.children ? mapNodesByIds(next.children, ids, fn) : next.children;
    const resources = next.resources
      ? Object.fromEntries(Object.entries(next.resources).map(([slot, binding]) => {
        if (!binding) return [slot, binding];
        const sourceNode = mapNodesByIds([binding.sourceNode], ids, fn)[0];
        return [slot, { ...binding, sourceNode, image: sourceNode.image ?? binding.image }];
      })) as UINode["resources"]
      : next.resources;
    return { ...next, ...(children ? { children } : {}), ...(resources ? { resources } : {}) };
  });
}
function findNodeIncludingResources(nodes: UINode[], id: string): UINode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children ? findNodeIncludingResources(node.children, id) : null;
    if (child) return child;
    for (const binding of Object.values(node.resources ?? {})) {
      if (!binding) continue;
      const source = findNodeIncludingResources([binding.sourceNode], id);
      if (source) return source;
    }
  }
  return null;
}
function findPath(nodes: UINode[], id: string, prefix: number[] = []): number[] | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return [...prefix, i];
    if (n.children) {
      const found = findPath(n.children, id, [...prefix, i]);
      if (found) return found;
    }
  }
  return null;
}
function findParentNode(nodes: UINode[], id: string): UINode | null {
  for (const node of nodes) {
    if (node.children?.some((child) => child.id === id)) return node;
    const nested = node.children ? findParentNode(node.children, id) : null;
    if (nested) return nested;
  }
  return null;
}

function isFixedRootNode(scene: UIScene, node: UINode, path: number[] | null): boolean {
  return Boolean(
    path?.length === 1 && path[0] === 0
      && node.ctrl?.type === "Layout"
      && node.designRect.x === 0 && node.designRect.y === 0
      && node.designRect.width === scene.designWidth && node.designRect.height === scene.designHeight,
  );
}
function nodeAtPath(nodes: UINode[], path: number[]): UINode | null {
  let current: UINode[] | undefined = nodes;
  let node: UINode | undefined;
  for (const index of path) {
    node = current?.[index];
    if (!node) return null;
    current = node.children;
  }
  return node ?? null;
}
function commonPath(paths: number[][]): number[] {
  if (!paths.length) return [];
  const out: number[] = [];
  for (let i = 0; i < paths[0].length; i++) {
    if (paths.every((path) => path[i] === paths[0][i])) out.push(paths[0][i]);
    else break;
  }
  return out;
}
function nearestBindableAncestor(nodes: UINode[], imageIds: string[]): { node: UINode; path: number[] } | null {
  const paths = imageIds.map((id) => findPath(nodes, id));
  if (paths.some((path): path is null => path === null)) return null;
  const parentPaths = (paths as number[][]).map((path) => path.slice(0, -1));
  const shared = commonPath(parentPaths);
  for (let length = shared.length; length >= 0; length--) {
    const path = shared.slice(0, length);
    const node = nodeAtPath(nodes, path);
    if (node && hasResourceSlots(node.ctrl?.type)) return { node, path };
  }
  return null;
}
function removeNodes(nodes: UINode[], ids: Set<string>): UINode[] {
  return nodes.flatMap((n) => {
    if (ids.has(n.id)) return [];
    return [{ ...n, children: n.children ? removeNodes(n.children, ids) : undefined }];
  });
}
function insertAtPath(nodes: UINode[], parentPath: number[], index: number, node: UINode): UINode[] {
  if (!parentPath.length) return [...nodes.slice(0, index), node, ...nodes.slice(index)];
  const [head, ...tail] = parentPath;
  return nodes.map((n, i) => i === head
    ? { ...n, children: insertAtPath(n.children ?? [], tail, index, node) }
    : n);
}
function insertManyAtPath(nodes: UINode[], parentPath: number[], index: number, inserted: UINode[]): UINode[] {
  if (!parentPath.length) return [...nodes.slice(0, index), ...inserted, ...nodes.slice(index)];
  const [head, ...tail] = parentPath;
  return nodes.map((n, i) => i === head
    ? { ...n, children: insertManyAtPath(n.children ?? [], tail, index, inserted) }
    : n);
}
function cloneNode(n: UINode): UINode {
  const resources = n.resources
    ? Object.fromEntries(Object.entries(n.resources).map(([slot, binding]) => [slot, binding ? {
      ...binding,
      sourceNode: cloneNode(binding.sourceNode),
    } : binding])) as UINode["resources"]
    : undefined;
  return {
    ...n,
    scale: { ...n.scale },
    designRect: { ...n.designRect },
    layout: n.layout ? {
      x: { ...n.layout.x }, y: { ...n.layout.y },
      width: { ...n.layout.width }, height: { ...n.layout.height },
    } : undefined,
    anchor: { ...n.anchor },
    ctrl: n.ctrl ? { ...n.ctrl } : undefined,
    text: n.text ? { ...n.text } : undefined,
    slice: n.slice ? { ...n.slice } : undefined,
    nineSliceGroupId: n.nineSliceGroupId,
    progress: n.progress ? { ...n.progress } : undefined,
    list: n.list ? { ...n.list, padding: { ...n.list.padding } } : undefined,
    resources,
    children: n.children?.map(cloneNode),
  };
}

function buildNamingReference(scene: UIScene, manifest: ReturnType<typeof buildNamingManifest>): string | undefined {
  if (typeof document === "undefined") return undefined;
  const width = Math.max(1, scene.designWidth);
  const height = Math.max(1, scene.designHeight);
  const maxWidth = 1200;
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement("canvas");
  const contactColumns = 6;
  const contactCell = 112;
  const contactRows = Math.ceil(manifest.assets.length / contactColumns);
  const stageHeight = Math.max(1, Math.round(height * scale));
  canvas.width = Math.max(1, Math.round(width * scale), contactColumns * contactCell);
  canvas.height = stageHeight + (contactRows ? contactRows * contactCell + 28 : 0);
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#15181d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const layout = new LayoutEngine().layoutScene(scene, {
    designWidth: width,
    designHeight: height,
    viewportWidth: width,
    viewportHeight: height,
    safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
    scaleMode: "contain",
  });
  const preview = document.createElement("canvas");
  preview.width = width;
  preview.height = height;
  renderUi(preview.getContext("2d")!, layout);
  context.drawImage(preview, 0, 0, Math.round(width * scale), stageHeight);
  if (contactRows) {
    context.fillStyle = "#202a34";
    context.fillRect(0, stageHeight, canvas.width, canvas.height - stageHeight);
    context.fillStyle = "#a8bed0";
    context.font = "12px sans-serif";
    context.fillText("Unique image references", 10, stageHeight + 18);
    manifest.assets.forEach((asset, index) => {
      // 资源槽位中的图片已经不在普通层级树里，必须从 resources 递归查找，
      // 否则 AI 看到的联系表会漏掉这些资源的视觉缩略图。
      const node = findNodeIncludingResources(scene.nodes, asset.nodeIds[0]);
      if (!node?.image) return;
      const col = index % contactColumns;
      const row = Math.floor(index / contactColumns);
      const x = col * contactCell + 8;
      const y = stageHeight + 25 + row * contactCell;
      context.fillStyle = "#11171d";
      context.fillRect(x, y, 96, 82);
      const ratio = Math.min(84 / Math.max(1, node.image.width), 66 / Math.max(1, node.image.height));
      const w = Math.max(1, node.image.width * ratio);
      const h = Math.max(1, node.image.height * ratio);
      context.drawImage(node.image, x + (96 - w) / 2, y + (66 - h) / 2, w, h);
      context.fillStyle = "#b8cbd9";
      context.font = "9px monospace";
      context.fillText(asset.key, x + 3, y + 78);
    });
  }
  return canvas.toDataURL("image/png");
}

// 撤销快照：保存九宫格配置和完整树结构；canvas 引用保持不变，只复制节点配置。
type Snapshot = Pick<UIScene, "nodes" | "nineSliceCandidates" | "nineSliceGroups" | "useNineSlicePreview">;
const snapScene = (s: UIScene): Snapshot => ({
  nodes: s.nodes.map(cloneNode),
  nineSliceCandidates: s.nineSliceCandidates?.map((candidate) => ({ ...candidate, memberNodeIds: [...candidate.memberNodeIds], suggestedMargins: { ...candidate.suggestedMargins } })),
  nineSliceGroups: s.nineSliceGroups?.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds], margins: { ...group.margins } })),
  useNineSlicePreview: s.useNineSlicePreview,
});
const applySnap = (snap: Snapshot): Snapshot => ({
  nodes: snap.nodes.map(cloneNode),
  nineSliceCandidates: snap.nineSliceCandidates?.map((candidate) => ({ ...candidate, memberNodeIds: [...candidate.memberNodeIds], suggestedMargins: { ...candidate.suggestedMargins } })),
  nineSliceGroups: snap.nineSliceGroups?.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds], margins: { ...group.margins } })),
  useNineSlicePreview: snap.useNineSlicePreview,
});

const HISTORY_LIMIT = 50; // 步数不用保留太多
const STATUS_MESSAGE_DURATION_MS = 4000;

export default function App() {
  const [scene, setScene] = useState<UIScene | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [safeArea, setSafeArea] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [scaleMode, setScaleMode] = useState<ScaleMode>("cover");
  const [deviceShell, setDeviceShell] = useState<DeviceShell>("desktop");
  const [showPreview, setShowPreview] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showDesignBorder, setShowDesignBorder] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [histLen, setHistLen] = useState(0);
  const [futureLen, setFutureLen] = useState(0);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名.ui.json");
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [dirty, setDirty] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>("controls");
  const [rightPanelTab, setRightPanelTab] = useState<"properties" | "overview">("properties");
  const [exportMsg, setExportMsg] = useState("");
  const [engineOutputPath, setEngineOutputPath] = useState("");
  const [typeMenu, setTypeMenu] = useState<{ x: number; y: number } | null>(null);
  const [quickActionMenu, setQuickActionMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameCaretMode, setRenameCaretMode] = useState<"all" | "prefix">("all");
  const [layerNameMode, setLayerNameMode] = useState<LayerNameMode>("original");
  const [helpDialog, setHelpDialog] = useState<"shortcuts" | "about" | null>(null);

  const uiRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const sceneRef = useRef<UIScene | null>(null); // 同步引用（事件中立即更新）
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const previewDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const layoutCtx: LayoutContext | null = useMemo(
    () => (scene ? {
      designWidth: scene.designWidth,
      designHeight: scene.designHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      safeArea,
      scaleMode,
    } : null),
    [scene, viewport, safeArea, scaleMode],
  );
  const result = useMemo(
    () => (scene && layoutCtx ? new LayoutEngine().layoutScene(scene, layoutCtx) : null),
    [scene, layoutCtx],
  );
  // 预览、下载和测试包都使用同一份资源映射，避免 JSON 与 imageset 的 frame 名不一致。
  const preparedEngineProject = useMemo(
    () => (scene ? prepareSceneAssets(scene, { scaleSceneBackground: true }) : null),
    [scene],
  );
  const engineExportName = useMemo(() => {
    const base = projectName.replace(/\.ui\.json$/i, "").trim();
    return base.replace(/[^0-9A-Za-z_-]+/g, "_") || "ui-project";
  }, [projectName]);
  const engineAssetManifest = useMemo(
    () => (preparedEngineProject ? createEngineAssetManifest(Object.keys(preparedEngineProject.assets), engineExportName) : []),
    [preparedEngineProject, engineExportName],
  );
  const engineExport = useMemo(
    () => (preparedEngineProject ? buildEngineJson(preparedEngineProject.scene, {
      atlasName: engineExportName,
      assetReferences: Object.fromEntries(engineAssetManifest.map((item) => [item.assetPath, item.reference])),
    }) : null),
    [preparedEngineProject, engineAssetManifest, engineExportName],
  );
  const warningIds = useMemo(
    () => warningNodeIds(analysis),
    [analysis],
  );

  // 右下角操作结果只作短暂反馈；新消息出现时重新计时。
  useEffect(() => {
    if (!exportMsg) return;
    const timer = window.setTimeout(() => setExportMsg(""), STATUS_MESSAGE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [exportMsg]);

  // 画布尺寸（含 devicePixelRatio）与渲染
  useEffect(() => {
    if (!result) return;
    const ui = uiRef.current, ov = ovRef.current;
    if (!ui || !ov || !layoutCtx) return;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [ui, ov]) {
      c.width = layoutCtx.viewportWidth * dpr;
      c.height = layoutCtx.viewportHeight * dpr;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    renderUi(ui.getContext("2d")!, result, scene?.useNineSlicePreview ?? false);
    renderOverlay(ov.getContext("2d")!, result, layoutCtx, {
      selectedId, selectedIds, showGrid: false, showSafeArea, showDesignBorder,
    });
  }, [result, layoutCtx, selectedId, selectedIds, showSafeArea, showDesignBorder, scene?.useNineSlicePreview]);

  // 画布 CSS 尺寸：contain 到窗口（切回图层 tab 时重新计算）
  useEffect(() => {
    const fit = () => {
      const wrap = showPreview ? previewWrapRef.current : wrapRef.current;
      if (!wrap || !layoutCtx || wrap.style.display === "none") return;
      const s = Math.min(wrap.clientWidth / layoutCtx.viewportWidth, wrap.clientHeight / layoutCtx.viewportHeight) * 0.72;
      for (const c of [uiRef.current, ovRef.current]) {
        if (c) { c.style.width = `${layoutCtx.viewportWidth * s}px`; c.style.height = `${layoutCtx.viewportHeight * s}px`; }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [layoutCtx, workspace, showPreview]);

  // ---- 状态变更统一入口（record=true 时压入历史）----
  const applyScene = useCallback((next: UIScene) => { sceneRef.current = next; setScene(next); }, []);
  const pushHistory = useCallback((s: UIScene) => {
    historyRef.current.push(snapScene(s));
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    setHistLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  // 连续数值微调合并：500ms 操作窗口内只压一条快照（拖动/滚轮/步进连改后一次撤销回窗口开始）
  const lastHistoryRef = useRef(0);
  const hasHistoryRef = useRef(false);
  const mutateScene = useCallback((mutator: (s: UIScene) => UIScene, record = true) => {
    const prev = sceneRef.current;
    if (!prev) return;
    const now = Date.now();
    if (record) {
      if (!hasHistoryRef.current || now - lastHistoryRef.current > 500) {
        pushHistory(prev); // 首次或新操作窗口
        hasHistoryRef.current = true;
      }
      lastHistoryRef.current = now;
    }
    applyScene(mutator(prev));
    setDirty(true);
  }, [applyScene, pushHistory]);

  const resetHistory = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
    hasHistoryRef.current = false;
    setHistLen(0);
    setFutureLen(0);
  }, []);

  const createNewProject = useCallback(() => {
    if (dirty && !window.confirm("当前工程有未保存修改，确定放弃并新建工程吗？")) return;
    const next: UIScene = { designWidth: 1280, designHeight: 720, nodes: [], sliceSources: [], interactionTemplates: [], nineSliceCandidates: [], nineSliceGroups: [], useNineSlicePreview: false };
    resetHistory();
    applyScene(next);
    setProjectPath(null);
    setProjectName("未命名.ui.json");
    setAnalysis(null);
    setViewport({ width: 1280, height: 720 });
    setSafeArea({ left: 0, right: 0, top: 0, bottom: 0 });
    setScaleMode("cover");
    setDeviceShell("desktop");
    setShowPreview(false);
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
    selectionAnchorRef.current = null;
    setSelectedId(null);
    setSelectedIds([]);
    setWarnings([]);
    setDirty(false);
    setRenameCaretMode("all");
    setLayerNameMode("original");
    setExportMsg("已新建空白工程");
  }, [applyScene, dirty, resetHistory]);

  const openSavedProject = useCallback(async () => {
    if (dirty && !window.confirm("当前工程有未保存修改，确定放弃并打开其他工程吗？")) return;
    try {
      const opened = await openProject();
      if (!opened) return;
      const restored = restoreSceneSnapshot(opened.project, opened.assets);
      const view = opened.project.view;
      resetHistory();
      applyScene(restored.scene);
      setProjectPath(opened.path);
      setProjectName(projectFileName(opened.path));
      setAnalysis(opened.analysis);
      setLayerNameMode("original");
      setViewport(view?.viewport ?? { width: restored.scene.designWidth, height: restored.scene.designHeight });
      setSafeArea(view?.safeArea ?? { left: 0, right: 0, top: 0, bottom: 0 });
      setScaleMode(view?.scaleMode ?? "cover");
      setDeviceShell("desktop");
      setShowPreview(false);
      setShowSafeArea(view?.showSafeArea ?? false);
      setShowDesignBorder(view?.showDesignBorder ?? true);
      selectionAnchorRef.current = null;
      setSelectedId(null);
      setSelectedIds([]);
      setWarnings(restored.missingAssets.map((asset) => `资源缺失：${asset}`));
      setDirty(false);
      setExportMsg(restored.missingAssets.length
        ? `工程已打开，${restored.missingAssets.length} 个资源缺失`
        : `已打开 ${projectFileName(opened.path)}`);
    } catch (error) {
      setExportMsg(error instanceof Error ? error.message : "打开工程失败");
    }
  }, [applyScene, dirty, resetHistory]);

  const saveCurrentProject = useCallback(async (saveAs = false) => {
    const current = sceneRef.current;
    if (!current) return;
    try {
      const prepared = prepareSceneAssets(current);
      const view: SavedProjectView = { viewport, safeArea, scaleMode, showSafeArea, showDesignBorder };
      const saved = serializeScene(prepared.scene, view);
      const nextPath = await saveProject({
        path: projectPath,
        suggestedName: projectName,
        project: saved,
        assets: prepared.assets,
        analysis,
        saveAs,
      });
      if (!nextPath) return;
      applyScene(prepared.scene);
      setProjectPath(nextPath);
      setProjectName(projectFileName(nextPath));
      setDirty(false);
      setExportMsg(`已保存 ${projectFileName(nextPath)} ✓`);
    } catch (error) {
      setExportMsg(error instanceof Error ? error.message : "保存工程失败");
    }
  }, [analysis, applyScene, projectName, projectPath, safeArea, scaleMode, showDesignBorder, showSafeArea, viewport]);

  const cancelPsdImport = useCallback(() => {
    importAbortRef.current?.abort();
  }, []);

  const loadPsd = useCallback(async (buffer: ArrayBuffer, name: string) => {
    if (importAbortRef.current) return;
    if (dirty && !window.confirm("当前工程有未保存修改，导入 PSD 将创建新工程，确定继续吗？")) return;
    const controller = new AbortController();
    importAbortRef.current = controller;
    const checkpoint = async (phase: string, progress: number) => {
      if (controller.signal.aborted) throw new DOMException("导入已取消", "AbortError");
      setImportProgress({ name, phase, progress });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      if (controller.signal.aborted) throw new DOMException("导入已取消", "AbortError");
    };
    try {
      await checkpoint("正在读取 PSD 图层……", 0.12);
      const imported = importPsd(buffer);
      await checkpoint("正在整理层级和控件类型……", 0.34);
      await checkpoint("正在整理图片资源……", 0.58);
      await checkpoint("正在校验并保存导入结果……", 0.88);
      // PSD 导入只保留原始图层名称；中文控件文件夹的类型识别在 importPsd 内完成。
      // AI 命名由用户在资源绑定完成后通过层级面板主动触发，避免导入后丢失 PSD 语义线索。
      const currentScene = imported.scene;
      const currentAnalysis = createEmptyAnalysis("local");
      if (controller.signal.aborted) throw new DOMException("导入已取消", "AbortError");

      // PSD 导入总是创建新的独立工程，不追加到当前工程。
      resetHistory();
      applyScene(currentScene);
      setAnalysis(currentAnalysis);
      setViewport({ width: currentScene.designWidth, height: currentScene.designHeight });
      setSafeArea({ left: 0, right: 0, top: 0, bottom: 0 });
      setDeviceShell("desktop");
      // 导入完成后直接进入层级工作区；效果检查统一从“预览”页签进入。
      setShowPreview(false);
      setPreviewZoom(1);
      setPreviewPan({ x: 0, y: 0 });
      setProjectPath(null);
      setProjectName(`${name.replace(/\.(psd|psb)$/i, "")}.ui.json`);
      setLayerNameMode("original");
      const importedIds = currentScene.nodes.map((node) => node.id);
      selectionAnchorRef.current = importedIds.at(-1) ?? null;
      setSelectedIds(importedIds);
      setSelectedId(importedIds.at(-1) ?? null);
      setWarnings([...imported.warnings, ...currentAnalysis.warnings]);
      setDirty(true);
      setExportMsg(`已从 ${name} 导入 ${walkNodes(currentScene.nodes).length} 个节点，已保留 PSD 原名，请在资源绑定页签中手动绑定`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setExportMsg("已取消 PSD 导入");
      else setExportMsg(error instanceof Error ? error.message : `无法导入 ${name}`);
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setImportProgress(null);
    }
  }, [applyScene, dirty, resetHistory]);

  const rerunAiNaming = useCallback(async () => {
    const current = sceneRef.current;
    if (!current || importAbortRef.current) return;
    const controller = new AbortController();
    importAbortRef.current = controller;
    try {
      setImportProgress({ name: projectName, phase: "正在重新生成命名分析……", progress: 0.3 });
      const manifest = buildNamingManifest(current);
      const referenceDataUrl = buildNamingReference(current, manifest);
      const ai = await requestAiNaming(manifest, referenceDataUrl, controller.signal);
      if (controller.signal.aborted) throw new DOMException("命名已取消", "AbortError");
      if (!ai.available || !ai.result) {
        setExportMsg(`AI 命名不可用${ai.message ? `：${ai.message}` : ""}，已保留当前名称`);
        return;
      }
      setImportProgress({ name: projectName, phase: "正在应用 AI 命名（统一生成工程名称）……", progress: 0.85 });
      const named = applyAiNaming(current, ai.result, { overwriteManual: true });
      applyScene(named.scene);
      setLayerNameMode("ai");
      setAnalysis(named.analysis);
      setWarnings(named.analysis.warnings);
      setDirty(true);
      setExportMsg("AI 命名已更新");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setExportMsg(error instanceof Error ? error.message : "AI 命名失败");
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setImportProgress(null);
    }
  }, [applyScene, projectName]);

  const importImages = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const baseScene = sceneRef.current ?? {
      designWidth: 1280,
      designHeight: 720,
      nodes: [],
      sliceSources: [],
      interactionTemplates: [],
    } satisfies UIScene;
    const target = selectedId ? walkNodes(baseScene.nodes).find((node) => node.id === selectedId && node.ctrl?.type === "Layout") : undefined;
    const width = target?.designRect.width || baseScene.designWidth;
    const height = target?.designRect.height || baseScene.designHeight;
    const imported: UINode[] = [];
    const failed: string[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      try {
        const cropped = await canvasFromImageFile(file);
        if (!cropped) { failed.push(`${file.name}（图片完全透明）`); continue; }
        const offset = index * 18;
        const x = (width - cropped.sourceWidth) / 2 + cropped.offsetX + offset;
        const y = (height - cropped.sourceHeight) / 2 + cropped.offsetY + offset;
        imported.push(createImageNode(file.name, cropped, x, y, index));
      } catch {
        failed.push(file.name);
      }
    }
    if (!imported.length) {
      setExportMsg(`没有可导入的图片${failed.length ? `：${failed.join("、")}` : ""}`);
      return;
    }
    if (!sceneRef.current) {
      resetHistory();
      const next = { ...baseScene, nodes: imported };
      applyScene(next);
      setProjectPath(null);
      setProjectName(`${files[0].name.replace(/\.[^.]+$/, "")}.ui.json`);
      setViewport({ width: next.designWidth, height: next.designHeight });
    } else if (target) {
      mutateScene((source) => ({
        ...source,
        nodes: mapNodes(source.nodes, target.id, (node) => { node.children = [...(node.children ?? []), ...imported]; }),
      }));
    } else {
      mutateScene((source) => ({ ...source, nodes: [...source.nodes, ...imported] }));
    }
    const importedIds = imported.map((node) => node.id);
    selectionAnchorRef.current = importedIds.at(-1) ?? null;
    setSelectedIds(importedIds);
    setSelectedId(importedIds.at(-1) ?? null);
    setWarnings(failed.map((item) => `图片导入失败：${item}`));
    setDirty(true);
    setExportMsg(`已导入 ${imported.length} 张图片${failed.length ? `，${failed.length} 张失败` : ""}`);
  }, [applyScene, mutateScene, resetHistory, selectedId]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (importProgress) return;
    const files = [...event.dataTransfer.files];
    const psd = files.find((file) => /\.(psd|psb)$/i.test(file.name));
    if (psd) {
      await loadPsd(await psd.arrayBuffer(), psd.name);
      return;
    }
    const images = files.filter((file) => /^image\//i.test(file.type) || /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(file.name));
    if (images.length) await importImages(images);
  }, [importImages, importProgress, loadPsd]);

  /** F2：让当前单选节点进入层级树内联重命名状态。 */
  const beginRenameSelected = useCallback(() => {
    if (layerNameMode === "original") {
      setExportMsg("当前显示 PSD 原名，切换到“AI 名称”后才能重命名");
      return;
    }
    const current = sceneRef.current;
    const node = current && selectedId
      ? walkNodes(current.nodes).find((item) => item.id === selectedId)
      : undefined;
    if (!node || node.locked || selectedIds.length !== 1) return;
    setRenameCaretMode("all");
    setRenamingId(node.id);
  }, [layerNameMode, selectedId, selectedIds]);

  const commitRename = useCallback((id: string, value: string) => {
    setRenamingId(null);
    setRenameCaretMode("all");
    const nextName = value.trim();
    const current = sceneRef.current;
    const node = current ? walkNodes(current.nodes).find((item) => item.id === id) : undefined;
    if (!node || node.locked || !nextName || nextName === node.name) return;
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, id, (item) => {
      item.name = nextName;
      // 手动名称是用户的明确决策；后续“AI 命名”只能补充其他节点，不能覆盖它。
      item.naming = {
        ...item.naming,
        source: "manual",
        confidence: 1,
        suffix: nextName.replace(/^[a-z0-9]+_/i, "") || nextName,
      };
    }) }));
    setAnalysis((current) => {
      const base = current ?? createEmptyAnalysis("local");
      return {
        ...base,
        nodes: {
          ...base.nodes,
          [id]: {
            ...(base.nodes[id] ?? {}),
            source: "manual",
            confidence: 1,
            suffix: nextName.replace(/^[a-z0-9]+_/i, "") || nextName,
          },
        },
      };
    });
    setExportMsg(`已将节点重命名为「${nextName}」`);
  }, [mutateScene]);

  /** Alt+W：关闭当前工程，避免与浏览器关闭页签的 Ctrl+W 冲突。 */
  const closeProject = useCallback(() => {
    if (!sceneRef.current) return;
    if (dirty && !window.confirm("当前工程有未保存修改，确定放弃并关闭吗？")) return;
    sceneRef.current = null;
    setScene(null);
    setProjectPath(null);
    setProjectName("未命名.ui.json");
    setAnalysis(null);
    setDirty(false);
    setRenamingId(null);
    setRenameCaretMode("all");
    setLayerNameMode("original");
    setSelectedId(null);
    selectionAnchorRef.current = null;
    setSelectedIds([]);
    setWarnings([]);
    setTypeMenu(null);
    historyRef.current = [];
    futureRef.current = [];
    setHistLen(0);
    setFutureLen(0);
    setExportMsg("已关闭当前工程");
  }, [dirty]);

  const exportHtml = useCallback(async () => {
    if (!scene) return;
    const html = buildExportHtml(scene, scaleMode, safeArea);
    const base = projectName.replace(/\.ui\.json$/i, "");
    try {
      const r = await fetch("/save-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: base, html }),
      });
      if (!r.ok) throw 0;
      setExportMsg(`已导出 export/${base}.html ✓`);
      return;
    } catch {
      // dev server 不可用（file:// 打开）时回退浏览器下载
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.html`;
      a.click();
      setExportMsg("已下载（未通过 start.bat 启动，无法写入 export 文件夹）");
    }
  }, [scene, scaleMode, safeArea, projectName]);

  const exportEngineJson = useCallback(() => {
    if (!preparedEngineProject) return;
    const output = engineExport;
    if (!output) return;
    if (output.errors.length) {
      setExportMsg(`导出已阻止：${output.errors[0]}`);
      setWarnings(output.errors.map((error) => `导出错误：${error}`));
      return;
    }
    const base = engineExportName;
    const blob = new Blob([output.json], { type: "application/json;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${base}.engine.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
    setWarnings(output.warnings.map((warning) => `导出提示：${warning}`));
    setExportMsg(`已导出 ${base}.engine.json ✓`);
  }, [engineExport, engineExportName, preparedEngineProject]);

  const exportEnginePackage = useCallback(async () => {
    if (!preparedEngineProject || !engineExport || engineExport.errors.length) return;
    const outputPath = engineOutputPath.trim();
    if (!outputPath) {
      setExportMsg("请先填写引擎测试包输出目录");
      return;
    }
    try {
      const response = await fetch("/api/export-engine-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputPath,
          packageName: engineExportName,
          engineJson: engineExport.json,
          assets: preparedEngineProject.assets,
          manifest: engineAssetManifest,
        }),
      });
      const result = await response.json().catch(() => ({})) as { path?: string; layoutPath?: string; imagesetPath?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? "测试包生成失败");
      setExportMsg(`已生成引擎测试包：${result.path ?? outputPath} ✓`);
    } catch (error) {
      setExportMsg(`测试包生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [engineAssetManifest, engineExport, engineExportName, engineOutputPath, preparedEngineProject]);

  const updateNode = useCallback((id: string, patch: (n: UINode) => void, record = true) => {
    mutateScene((s) => {
      const nodes = mapNodes(s.nodes, id, patch);
      const target = walkNodes(nodes).find((node) => node.id === id);
      if (target?.layout) {
        const parent = findParentNode(nodes, id);
        syncNodeLayoutPosition(target, parent?.designRect.width ?? s.designWidth, parent?.designRect.height ?? s.designHeight);
      }
      return { ...s, nodes };
    }, record);
  }, [mutateScene]);

  /** 控件类型标签 */
  const setCtrl = useCallback((id: string, type: CtrlType | null, namingMode: "plain" | "quick" = "plain") => {
    const current = sceneRef.current;
    const source = current && walkNodes(current.nodes).find((node) => node.id === id);
    if (!current || !source) return;
    const sourcePath = findPath(current.nodes, id);
    const parentPath = sourcePath?.slice(0, -1) ?? [];
    const siblings = parentPath.length ? nodeAtPath(current.nodes, parentPath)?.children ?? [] : current.nodes;
    const generatedName = namingMode === "quick" && type && !isFixedRootNode(current, source, sourcePath)
      ? quickControlName(source, type, siblings)
      : null;

    const supported = new Set(resourceSlotDefinitions(type ?? undefined).map((slot) => slot.key));
    const stale = Object.entries(source.resources ?? {})
      .filter(([slot, binding]) => Boolean(binding) && !supported.has(slot as ResourceSlot)) as [ResourceSlot, ImageBinding][];
    let nextNodes = mapNodes(current.nodes, id, (node) => {
      const converted = markControlType(node, type);
      Object.assign(node, converted);
      if (generatedName) node.name = generatedName;
      if (node.resources) {
        const kept = Object.fromEntries(Object.entries(node.resources).filter(([slot]) => supported.has(slot as ResourceSlot)));
        node.resources = Object.keys(kept).length ? kept : undefined;
      }
    });

    // 目标类型没有对应槽位时，先解除这些资源，再按原父级/顺序恢复图片节点。
    for (const [, binding] of stale.sort((a, b) => a[1].sourceIndex - b[1].sourceIndex)) {
      const parentPath = binding.sourceParentId
        ? findPath(nextNodes, binding.sourceParentId) ?? findPath(nextNodes, id) ?? []
        : [];
      const parent = nodeAtPath(nextNodes, parentPath);
      const maxIndex = parent?.children?.length ?? nextNodes.length;
      nextNodes = insertAtPath(nextNodes, parentPath, Math.min(binding.sourceIndex, maxIndex), cloneNode(binding.sourceNode));
    }
    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    if (stale.length) setExportMsg(`已切换类型，并恢复 ${stale.length} 个不兼容资源节点`);
    else if (generatedName && generatedName !== source.name) setExportMsg(`已完成中文命名和控件类型转换：${generatedName}`);
  }, [mutateScene]);

  /** Ctrl+B / 资源绑定工作区：将图片手动填入目标控件的资源槽位。 */
  const bindResources = useCallback((requestedTargetId?: string, requestedImageIds?: string[], preferredSlot?: ResourceSlot) => {
    const current = sceneRef.current;
    const sourceIds = requestedImageIds ?? selectedIds;
    if (!current || !sourceIds.length) return;

    const confirmBindingComplete = (targetId: string, allowPartial = false): boolean => {
      const control = walkNodes(current.nodes).find((node) => node.id === targetId);
      const slots = resourceSlotDefinitions(control?.ctrl?.type);
      if (!control || !canConfirmResourceBinding(control) || !slots.length || (!allowPartial && !slots.every((slot) => Boolean(control.resources?.[slot.key])))) return false;
      if (!control.resourceBindingComplete) {
        const nextNodes = mapNodes(current.nodes, targetId, (node) => {
          node.resourceBindingComplete = true;
        });
        mutateScene((s) => ({ ...s, nodes: nextNodes }));
      }
      selectionAnchorRef.current = targetId;
      setSelectedIds([targetId]);
      setSelectedId(targetId);
      setExportMsg("已确认该控件的资源绑定完成");
      return true;
    };

    // 重开工程后通常选中的是控件节点本身；槽位已满时 Ctrl+B 直接确认完成，
    // 不把控件节点误判为待绑定图片。
    if (requestedImageIds === undefined && selectedIds.length === 1 && confirmBindingComplete(selectedIds[0], true)) return;

    const selected = sourceIds.map((id) => walkNodes(current.nodes).find((node) => node.id === id));
    if (selected.some((node) => !node || !node.image)) {
      setExportMsg("绑定已取消：选择中包含非图片节点");
      return;
    }
    const images = selected.filter((node): node is UINode => Boolean(node));
    const requestedPath = requestedTargetId ? findPath(current.nodes, requestedTargetId) : null;
    const requestedNode = requestedPath ? nodeAtPath(current.nodes, requestedPath) : null;
    const target = requestedNode && requestedPath
      ? { node: requestedNode, path: requestedPath }
      : nearestBindableAncestor(current.nodes, sourceIds);
    if (!target) {
      setExportMsg("绑定失败：未找到共同的可绑定控件");
      return;
    }
    let assignments: { slot: ResourceSlot; node: UINode }[];
    let skipped = 0;
    if (preferredSlot) {
      const supported = resourceSlotDefinitions(target.node.ctrl?.type).some((slot) => slot.key === preferredSlot);
      if (!supported) { setExportMsg("绑定失败：目标控件不支持该资源槽位"); return; }
      if (target.node.resources?.[preferredSlot]) { setExportMsg("绑定失败：该资源槽位已经绑定"); return; }
      assignments = images.length ? [{ slot: preferredSlot, node: images[0] }] : [];
      skipped = Math.max(0, images.length - 1);
    } else {
      const plan = planResourceBindings(target.node.ctrl?.type, images, target.node.resources);
      if (!plan.assignments.length) {
        const slots = resourceSlotDefinitions(target.node.ctrl?.type);
        const allSlotsFilled = slots.length > 0 && slots.every((slot) => Boolean(target.node.resources?.[slot.key]));
        if (allSlotsFilled) {
          confirmBindingComplete(target.node.id);
          return;
        }
        setExportMsg("绑定失败：目标控件没有空资源槽位");
        return;
      }
      assignments = plan.assignments;
      skipped = plan.skipped.length;
    }
    if (!assignments.length) return;

    const detailedAssignments = assignments.map(({ slot, node }) => {
      const path = findPath(current.nodes, node.id)!;
      const parent = path.length > 1 ? nodeAtPath(current.nodes, path.slice(0, -1)) : null;
      const binding: ImageBinding = {
        id: node.id,
        name: node.name,
        image: node.image!,
        sourceNode: cloneNode(node),
        sourceParentId: parent?.id ?? null,
        sourceIndex: path[path.length - 1],
      };
      return { slot, node, binding };
    });
    const assignedIds = new Set(detailedAssignments.map((item) => item.node.id));
    const removed = removeNodes(current.nodes, assignedIds);
    const nextNodes = mapNodes(removed, target.node.id, (node) => {
      node.resources = { ...(node.resources ?? {}) };
      node.resourceBindingComplete = false;
      for (const item of detailedAssignments) node.resources[item.slot] = item.binding;
    });
    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    selectionAnchorRef.current = target.node.id;
    setSelectedIds([target.node.id]);
    setSelectedId(target.node.id);
    setExportMsg(`已绑定 ${detailedAssignments.length} 个资源槽位${skipped ? `，${skipped} 张图片未绑定` : ""}`);
  }, [mutateScene, selectedIds]);

  const resetBindingComplete = useCallback((controlId: string) => {
    const current = sceneRef.current;
    const control = current && walkNodes(current.nodes).find((node) => node.id === controlId);
    if (!current || !control?.resourceBindingComplete) return;
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, controlId, (node) => { node.resourceBindingComplete = false; }) }));
    setExportMsg("已恢复该控件的待处理状态");
  }, [mutateScene]);

  /** 解除控件资源槽位绑定，并按绑定时保存的父级与顺序恢复图片节点。 */
  const unbindResource = useCallback((controlId: string, slot: ResourceSlot) => {
    const current = sceneRef.current;
    const control = current && walkNodes(current.nodes).find((node) => node.id === controlId);
    const binding = control?.resources?.[slot];
    if (!current || !control || !binding) return;
    const controlPath = findPath(current.nodes, controlId);
    if (!controlPath) return;
    const parentPath = binding.sourceParentId
      ? findPath(current.nodes, binding.sourceParentId) ?? controlPath
      : [];
    let nextNodes = mapNodes(current.nodes, controlId, (node) => {
      const resources = { ...(node.resources ?? {}) };
      delete resources[slot];
      node.resources = Object.keys(resources).length ? resources : undefined;
    });
    const parent = nodeAtPath(nextNodes, parentPath);
    const maxIndex = parent?.children?.length ?? nextNodes.length;
    nextNodes = insertAtPath(nextNodes, parentPath, Math.min(binding.sourceIndex, maxIndex), cloneNode(binding.sourceNode));
    nextNodes = mapNodes(nextNodes, controlId, (node) => { node.resourceBindingComplete = false; });
    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    selectionAnchorRef.current = binding.id;
    setSelectedIds([binding.id]);
    setSelectedId(binding.id);
    setExportMsg(`已解除「${binding.name}」的资源绑定`);
  }, [mutateScene]);

  /** 交互模板（随场景 json 导出） */
  const setTemplates = useCallback((t: InteractionTemplate[]) => {
    mutateScene((s) => ({ ...s, interactionTemplates: t }));
  }, [mutateScene]);

  const scanNineSlice = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    const candidates = scanNineSliceCandidates(current, current.nineSliceCandidates ?? []);
    mutateScene((s) => ({ ...s, nineSliceCandidates: candidates }));
    setExportMsg(candidates.length ? `已发现 ${candidates.length} 组九宫格候选` : "没有发现适合九宫格的候选图片");
  }, [mutateScene]);

  const confirmNineSlice = useCallback((candidate: NineSliceCandidate, margins: NineSliceMargins) => {
    const current = sceneRef.current;
    if (!current) return;
    const source = findNodeIncludingResources(current.nodes, candidate.sourceNodeId);
    if (!source?.image) { setExportMsg("九宫格确认失败：公共源图已缺失"); return; }
    const group = groupFromCandidate(candidate, margins);
    const generated = generateNineSliceImage(source.image, margins);
    const memberIds = new Set(candidate.memberNodeIds);
    mutateScene((s) => ({
      ...s,
      nodes: mapNodesByIds(s.nodes, memberIds, (node) => {
        node.nineSliceGroupId = group.id;
        node.slice = { ...margins };
        node.sliceImage = generated ?? source.image;
      }),
      nineSliceCandidates: (s.nineSliceCandidates ?? []).some((item) => item.id === candidate.id)
        ? (s.nineSliceCandidates ?? []).map((item) => item.id === candidate.id
          ? { ...item, status: "confirmed", suggestedMargins: { ...margins } }
          : item)
        : [...(s.nineSliceCandidates ?? []), { ...candidate, status: "confirmed", suggestedMargins: { ...margins } }],
      nineSliceGroups: [...(s.nineSliceGroups ?? []).filter((item) => item.id !== group.id), group],
    }));
    setExportMsg(`已确认九宫格：${source.name}`);
  }, [mutateScene]);

  const toggleNineSlicePreview = useCallback(() => {
    mutateScene((s) => ({ ...s, useNineSlicePreview: !s.useNineSlicePreview }));
  }, [mutateScene]);

  /** 全局字体：一次性替换场景内所有文本节点的字体 */
  const applyGlobalFont = useCallback((font: string) => {
    mutateScene((s) => {
      const nodes = s.nodes.map((n) => ({ ...n }));
      let n = 0;
      walkNodes(nodes).forEach((x) => { if (x.text) { x.text = { ...x.text, font }; n++; } });
      setExportMsg(`已将全部 ${n} 个文本的字体替换为「${font}」`);
      return { ...s, nodes };
    });
  }, [mutateScene]);

  const updateSelected = useCallback((patch: (n: UINode) => void, record = true) => {
    const prev = sceneRef.current;
    if (!prev) return;
    if (!walkNodes(prev.nodes).some((x) => x.id === selectedId)) return;
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, selectedId!, patch) }), record);
  }, [selectedId, mutateScene]);

  const selectNode = useCallback((id: string, intent?: SelectionIntent) => {
    setSelectedIds((current) => {
      const next = applySelection(current, id, selectionAnchorRef.current, intent ?? {
        additive: false, range: false, orderedIds: current,
      });
      selectionAnchorRef.current = next.anchorId;
      setSelectedId(next.primaryId);
      return next.ids;
    });
  }, []);

  /** 资源绑定工作区的定位：同步选择、展开并滚动层级树，让目标节点进入明显视野。 */
  const locateNode = useCallback((id: string) => {
    selectNode(id);
    setFocusNodeId(id);
  }, [selectNode]);

  /** Ctrl+G：在最近共同父级下创建 Layout，并将一个或多个选中节点移动进去。 */
  const groupSelected = useCallback(() => {
    const current = sceneRef.current;
    if (!current || selectedIds.length < 1 || !result) return;
    const paths = selectedIds.map((id) => findPath(current.nodes, id));
    if (paths.some((path): path is null => path === null)) return;
    const validPaths = paths as number[][];
    if (validPaths.some((path, i) => validPaths.some((other, j) => i !== j
      && path.length < other.length && path.every((value, k) => value === other[k])))) {
      setExportMsg("无法打组：不能同时选中父节点和它的子节点");
      return;
    }

    const parentPath = commonPath(validPaths.map((path) => path.slice(0, -1)));
    const targetParent = nodeAtPath(current.nodes, parentPath);
    const selectedSet = new Set(selectedIds);
    const entries = selectedIds.map((id) => ({
      id,
      node: walkNodes(current.nodes).find((n) => n.id === id)!,
      rect: result.nodes.find((r) => r.node.id === id)?.rect,
      path: validPaths[selectedIds.indexOf(id)],
    }));
    if (entries.some((entry) => !entry.rect)) {
      setExportMsg("无法打组：选中节点没有可用布局位置");
      return;
    }
    const rects = entries.map((entry) => entry.rect!);
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    const scaleX = result.scaleX || 1;
    const scaleY = result.scaleY || 1;
    const groupWidth = Math.max(1, (maxX - minX) / scaleX);
    const groupHeight = Math.max(1, (maxY - minY) / scaleY);
    const parentRect = parentPath.length
      ? result.nodes.find((r) => r.node.id === targetParent?.id)?.rect
      : null;
    const baseX = parentRect?.x ?? (layoutCtx && layoutCtx.scaleMode === "cover" ? 0 : result.letterbox.x);
    const baseY = parentRect?.y ?? (layoutCtx && layoutCtx.scaleMode === "cover" ? 0 : result.letterbox.y);
    const names = new Set(walkNodes(current.nodes).map((n) => n.name));
    let groupName = "Layout";
    let suffix = 2;
    while (names.has(groupName)) groupName = `Layout ${suffix++}`;

    const children = [...entries]
      .sort((a, b) => a.path.join(".").localeCompare(b.path.join("."), undefined, { numeric: true }))
      .map((entry) => {
        const child = cloneNode(entry.node);
        child.anchor = {
          ...child.anchor,
          parentX: 0, parentY: 0, selfX: 0, selfY: 0,
          offsetX: (entry.rect!.x - minX) / scaleX,
          offsetY: (entry.rect!.y - minY) / scaleY,
          safeArea: false,
        };
        child.adaptation = { mode: "anchor" };
        syncNodeLayoutPosition(child, groupWidth, groupHeight);
        return child;
      });
    const group: UINode = {
      id: `group-${Date.now()}`,
      name: groupName,
      image: null,
      children,
      ctrl: { type: "Layout" },
      designRect: { x: 0, y: 0, width: groupWidth, height: groupHeight },
      anchor: {
        parentX: 0, parentY: 0, selfX: 0, selfY: 0,
        offsetX: (minX - baseX) / scaleX,
        offsetY: (minY - baseY) / scaleY,
        safeArea: false,
      },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: Math.min(...entries.map((entry) => entry.node.zIndex)) - 0.01,
      adaptation: { mode: "anchor" },
      psd: { layerId: -Date.now(), originalX: minX, originalY: minY, originalWidth: groupWidth, originalHeight: groupHeight },
    };
    const originalSiblings = targetParent?.children ?? current.nodes;
    const commonLength = parentPath.length;
    const insertionAt = Math.min(...validPaths.map((path) => path[commonLength]));
    const removedBefore = validPaths.filter((path) => path.length === commonLength + 1
      && path[commonLength] < insertionAt).length;
    const nextNodes = insertAtPath(
      removeNodes(current.nodes, selectedSet),
      parentPath,
      Math.max(0, insertionAt - removedBefore),
      group,
    );
    if (!originalSiblings) return;
    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    selectionAnchorRef.current = group.id;
    setSelectedIds([group.id]);
    setSelectedId(group.id);
    setExportMsg(`已将 ${children.length} 个节点整理到「${group.name}」`);
  }, [layoutCtx, mutateScene, result, selectedIds]);

  /** Alt+G：释放当前分组的直接子节点，并保持它们当前画面位置。 */
  const ungroupSelected = useCallback(() => {
    const current = sceneRef.current;
    if (!current || !selectedId || !result) return;
    const paths = findPath(current.nodes, selectedId);
    const group = walkNodes(current.nodes).find((node) => node.id === selectedId);
    if (!paths || !group?.children?.length) return;
    if (group.locked) {
      setExportMsg("节点已锁定，无法取消打组");
      return;
    }

    const parentPath = paths.slice(0, -1);
    const groupIndex = paths[paths.length - 1];
    const parent = nodeAtPath(current.nodes, parentPath);
    const scaleX = result.scaleX || 1;
    const scaleY = result.scaleY || 1;
    const parentRect = parentPath.length
      ? result.nodes.find((entry) => entry.node.id === parent?.id)?.rect
      : null;
    const baseX = parentRect?.x ?? (layoutCtx && layoutCtx.scaleMode === "cover" ? 0 : result.letterbox.x);
    const baseY = parentRect?.y ?? (layoutCtx && layoutCtx.scaleMode === "cover" ? 0 : result.letterbox.y);
    const children = group.children.map((source) => {
      const child = cloneNode(source);
      const rect = result.nodes.find((entry) => entry.node.id === source.id)?.rect;
      if (rect) {
        child.anchor = {
          ...child.anchor,
          parentX: 0, parentY: 0, selfX: 0, selfY: 0,
          offsetX: (rect.x - baseX) / scaleX,
          offsetY: (rect.y - baseY) / scaleY,
          safeArea: false,
        };
        child.adaptation = { mode: "anchor" };
        syncNodeLayoutPosition(child, parent?.designRect.width ?? current.designWidth, parent?.designRect.height ?? current.designHeight);
      }
      return child;
    });
    const removed = removeNodes(current.nodes, new Set([selectedId]));
    const nextNodes = insertManyAtPath(removed, parentPath, groupIndex, children);
    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    const first = children[0];
    selectionAnchorRef.current = first?.id ?? null;
    setSelectedIds(first ? [first.id] : []);
    setSelectedId(first?.id ?? null);
    setExportMsg(`已取消「${group.name}」打组`);
  }, [layoutCtx, mutateScene, result, selectedId]);

  /** Photoshop 风格的层级调整：Ctrl+] 向上，Ctrl+[ 向下；到文件夹边界时跨出文件夹。 */
  const moveSelectedLayer = useCallback((direction: LayerOrderDirection) => {
    const current = sceneRef.current;
    if (!current || !result || !layoutCtx || !selectedIds.length) return;
    const firstPath = findPath(current.nodes, selectedIds[0]);
    if (!firstPath) return;
    const oldParent = firstPath.length > 1 ? nodeAtPath(current.nodes, firstPath.slice(0, -1)) : null;
    const selectedNodes = walkNodes(current.nodes).filter((node) => selectedIds.includes(node.id));
    if (selectedNodes.some((node) => node.locked)) {
      setExportMsg("节点已锁定，无法调整层级");
      return;
    }

    const moved = moveLayerOrder(current.nodes, selectedIds, direction);
    if (!moved.changed) {
      setExportMsg("已到达当前方向的层级边界");
      return;
    }

    let nextNodes = moved.nodes;
    if ((oldParent?.id ?? null) !== moved.newParentId) {
      const newParentRect = moved.newParentId
        ? result.nodes.find((entry) => entry.node.id === moved.newParentId)?.rect
        : null;
      const baseX = newParentRect?.x ?? (layoutCtx.scaleMode === "cover" ? 0 : result.letterbox.x);
      const baseY = newParentRect?.y ?? (layoutCtx.scaleMode === "cover" ? 0 : result.letterbox.y);
      const scaleX = result.scaleX || 1;
      const scaleY = result.scaleY || 1;
      for (const id of selectedIds) {
        const rect = result.nodes.find((entry) => entry.node.id === id)?.rect;
        if (!rect) continue;
        nextNodes = mapNodes(nextNodes, id, (node) => {
          node.anchor = {
            ...node.anchor,
            parentX: 0, parentY: 0, selfX: 0, selfY: 0,
            offsetX: (rect.x - baseX) / scaleX,
            offsetY: (rect.y - baseY) / scaleY,
            safeArea: false,
          };
          node.adaptation = { mode: "anchor" };
          const newParent = moved.newParentId ? walkNodes(nextNodes).find((entry) => entry.id === moved.newParentId) : null;
          syncNodeLayoutPosition(node, newParent?.designRect.width ?? current.designWidth, newParent?.designRect.height ?? current.designHeight);
        });
      }
    }

    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    const directionLabel = direction === "up" ? "向上" : "向下";
    const crossedFolder = (oldParent?.id ?? null) !== moved.newParentId;
    setExportMsg(crossedFolder ? `已${directionLabel}调整层级并移出当前文件夹` : `已${directionLabel}调整层级`);
  }, [layoutCtx, mutateScene, result, selectedIds]);

  // ---- 撤销 / 重做（Ctrl+Z 后退，Ctrl+X 前进）----
  const undo = useCallback(() => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    futureRef.current.push(snapScene(sceneRef.current!));
    const s = sceneRef.current!;
    applyScene({ ...s, ...applySnap(snap) });
    setDirty(true);
    setHistLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, [applyScene]);

  const redo = useCallback(() => {
    const snap = futureRef.current.pop();
    if (!snap) return;
    historyRef.current.push(snapScene(sceneRef.current!));
    const s = sceneRef.current!;
    applyScene({ ...s, ...applySnap(snap) });
    setDirty(true);
    setHistLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, [applyScene]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  useEffect(() => {
    setTypeMenu(null);
  }, [selectedId, selectedIds]);

  useEffect(() => {
    setRenamingId(null);
  }, [workspace]);

  useEffect(() => {
    setRightPanelTab(workspace === "bindings" || workspace === "preview" ? "overview" : "properties");
  }, [workspace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (importProgress) {
        e.preventDefault();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && e.altKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        closeProject();
        return;
      }
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape" && typeMenu) {
        e.preventDefault();
        setTypeMenu(null);
        return;
      }
      if (e.key === "Escape" && quickActionMenu) {
        e.preventDefault();
        setQuickActionMenu(null);
        return;
      }
      if (e.altKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        ungroupSelected();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "F2") {
        e.preventDefault();
        beginRenameSelected();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          setTypeMenu(null);
          setQuickActionMenu(pointerRef.current);
        }
        else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
        else if (e.key === "x" || e.key === "X") { e.preventDefault(); redo(); }
        else if (e.key === "]") { e.preventDefault(); moveSelectedLayer("up"); }
        else if (e.key === "[") { e.preventDefault(); moveSelectedLayer("down"); }
        else if (e.key === "b" || e.key === "B") { e.preventDefault(); bindResources(); }
        else if (e.key === "g" || e.key === "G") { e.preventDefault(); groupSelected(); }
        return;
      }
      if (!e.altKey && (e.key === "t" || e.key === "T") && selectedIds.length === 1 && selectedId) {
        const selected = sceneRef.current && walkNodes(sceneRef.current.nodes).find((node) => node.id === selectedId);
        if (selected && !selected.locked) {
          e.preventDefault();
          setTypeMenu(pointerRef.current);
        }
        return;
      }
      // 方向键微调选中图层位置（Shift=10px，默认1px）
      if (!selectedId) return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      if (!dx && !dy) return;
      e.preventDefault();
      updateSelected((n) => { n.anchor.offsetX += dx; n.anchor.offsetY += dy; });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [importProgress, undo, redo, selectedId, selectedIds, typeMenu, quickActionMenu, updateSelected, saveCurrentProject, bindResources, groupSelected, ungroupSelected, moveSelectedLayer, beginRenameSelected, closeProject]);

  // 命中检测 + 拖动（文档 §17：拖动只改 offset，不碰 designRect）
  const toLogical = (clientX: number, clientY: number) => {
    const ui = uiRef.current!;
    const r = ui.getBoundingClientRect();
    const k = layoutCtx!.viewportWidth / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    if (showPreview) return;
    if (!result || !layoutCtx) return;
    const p = toLogical(e.clientX, e.clientY);
    const hit = [...result.nodes]
      .sort((a, b) => b.node.zIndex - a.node.zIndex)
      .find((n) => n.visible && p.x >= n.rect.x && p.x <= n.rect.x + n.rect.width
        && p.y >= n.rect.y && p.y <= n.rect.y + n.rect.height);
    const additive = e.ctrlKey || e.metaKey;
    const current = sceneRef.current;
    if (!hit) {
      if (!additive) {
        selectionAnchorRef.current = null;
        setSelectedId(null);
        setSelectedIds([]);
      }
      return;
    }
    selectNode(hit.node.id, createSelectionIntent(e, flattenLayerIds(current?.nodes ?? [])));
    if (additive || e.shiftKey) return;
    if (hit.node.locked) return;
    pushHistory(sceneRef.current!); // 拖动前记录一次，撤销回退整个拖动
    dragRef.current = { id: hit.node.id, startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !layoutCtx || !result) return;
    const start = { x: (d.startX - (uiRef.current!.getBoundingClientRect().left)) * (layoutCtx.viewportWidth / uiRef.current!.getBoundingClientRect().width), y: (d.startY - uiRef.current!.getBoundingClientRect().top) * (layoutCtx.viewportHeight / uiRef.current!.getBoundingClientRect().height) };
    const p = toLogical(e.clientX, e.clientY);
    const dx = p.x - start.x, dy = p.y - start.y;
    updateNode(d.id, (n) => {
      if (n.adaptation.mode !== "anchor") n.adaptation.mode = "anchor"; // 拖动 → 锚点模式
      n.anchor.offsetX += dx / result.scaleX;   // 预览位移 → 设计 offset（÷scale 等比）
      n.anchor.offsetY += dy / result.scaleY;
    }, false); // 拖动中不记录（按下时已记录一次）
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY };
  };
  const onPointerUp = () => { dragRef.current = null; };
  const onPreviewWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setPreviewZoom((value) => Math.max(0.4, Math.min(3, value * (e.deltaY < 0 ? 1.1 : 0.9))));
  };
  const onPreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    previewDragRef.current = { x: e.clientX, y: e.clientY, panX: previewPan.x, panY: previewPan.y };
  };
  const onPreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag) return;
    setPreviewPan({ x: drag.panX + e.clientX - drag.x, y: drag.panY + e.clientY - drag.y });
  };
  const onPreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const drag = previewDragRef.current;
    if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5 && result && layoutCtx && uiRef.current) {
      const point = toLogical(e.clientX, e.clientY);
      const hit = [...result.nodes].sort((a, b) => b.node.zIndex - a.node.zIndex).find((item) => item.visible
        && point.x >= item.rect.x && point.x <= item.rect.x + item.rect.width
        && point.y >= item.rect.y && point.y <= item.rect.y + item.rect.height);
      if (hit) selectNode(hit.node.id, createSelectionIntent(e, flattenLayerIds(scene?.nodes ?? [])));
    }
    previewDragRef.current = null;
  };
  const pieNode = typeMenu && selectedId
    ? walkNodes(scene?.nodes ?? []).find((node) => node.id === selectedId) ?? null
    : null;
  const previewPresets = scene ? presetsForDesign(scene.designWidth, scene.designHeight) : [];
  const canvasStack = (
    <div className="canvas-stack">
      <canvas ref={uiRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
      <canvas ref={ovRef} style={{ pointerEvents: "none" }} />
      {deviceShell !== "desktop" && (
        <div className={`device-shell device-shell-${deviceShell} ${scene && scene.designHeight > scene.designWidth ? "portrait" : "landscape"}`} aria-hidden="true">
          <span className="device-cutout" />
          <span className="device-home-indicator" />
        </div>
      )}
    </div>
  );

  return (
    <div className="app" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { void handleDrop(event); }}>
      <Appbar
        projectName={projectName} dirty={dirty}
        onNew={createNewProject} onOpenProject={openSavedProject}
        onImportPsd={loadPsd} onImportImages={importImages}
        hasScene={!!scene} canUndo={histLen > 0} canRedo={futureLen > 0} onUndo={undo} onRedo={redo}
        onSave={() => { void saveCurrentProject(); }} onSaveAs={() => { void saveCurrentProject(true); }}
        onExportHtml={exportHtml} onExportEngineJson={exportEngineJson} onGlobalFont={applyGlobalFont}
        workspace={workspace} onWorkspace={setWorkspace} onCloseProject={closeProject}
        onRename={beginRenameSelected} onGroup={groupSelected} onUngroup={ungroupSelected}
        onMoveLayer={moveSelectedLayer} onShowShortcuts={() => setHelpDialog("shortcuts")}
        onShowAbout={() => setHelpDialog("about")}
      />
      <Workbar ws={workspace} onWs={setWorkspace} hasScene={!!scene}
        viewport={viewport} onViewport={setViewport}
        safeArea={safeArea} onSafeArea={setSafeArea}
        scaleMode={scaleMode} onScaleMode={setScaleMode}
        showSafeArea={showSafeArea} onShowSafeArea={setShowSafeArea}
        showDesignBorder={showDesignBorder} onShowDesignBorder={setShowDesignBorder}
        designWidth={scene?.designWidth ?? 1280} designHeight={scene?.designHeight ?? 720}
        deviceShell={deviceShell} onDeviceShell={setDeviceShell}
      />
      <div className="body">
        {workspace !== "slice" && <ControlsPanel nodes={scene?.nodes ?? []} selectedIds={selectedIds} onSelect={selectNode} focusNodeId={focusNodeId}
          onAiRename={() => { void rerunAiNaming(); }}
          nameMode={layerNameMode} onNameModeChange={(mode) => { setLayerNameMode(mode); if (mode === "original") setRenamingId(null); }}
          warningIds={warningIds}
          renamingId={renamingId} renameCaretMode={renameCaretMode}
          onRename={commitRename} onCancelRename={() => setRenamingId(null)}
          onToggleVisible={(id) => updateNode(id, (n) => { n.visible = !n.visible; })}
          onToggleLock={(id) => updateNode(id, (n) => { n.locked = !n.locked; })}
        />}
        {workspace === "export" ? (
          <section className="export-panel">
            <div className="export-panel-card">
              <span className="export-kicker">FINAL OUTPUT</span>
              <h2>导出自研引擎 JSON</h2>
              <p>当前工程会转换为 <code>Dialog → Window</code> 结构。位置、尺寸使用当前视觉结果，图片统一进入引擎可识别的 imageset，字体统一映射为引擎预设。</p>
              <div className={`export-check ${engineExport?.errors.length ? "has-errors" : "ready"}`}>
                <strong>{engineExport?.errors.length ? "暂不能导出" : "可以导出"}</strong>
                <span>{engineExport?.errors.length ? `发现 ${engineExport.errors.length} 个错误` : "基础字段校验通过"}</span>
              </div>
              {engineExport?.errors.length ? <div className="export-diagnostics error">{engineExport.errors.map((item) => <div key={item}>✕ {item}</div>)}</div> : null}
              {engineExport?.warnings.length ? <div className="export-diagnostics">{engineExport.warnings.map((item) => <div key={item}>⚠ {item}</div>)}</div> : null}
              <div className="engine-export-path">
                <label htmlFor="engine-output-path">引擎测试包输出目录</label>
                <input id="engine-output-path" type="text" value={engineOutputPath}
                  onChange={(event) => setEngineOutputPath(event.target.value)}
                  placeholder="例如：C:\\Users\\你的用户名\\Desktop\\ui-engine-output" />
                <p>填写本机目录。生成后会创建 <code>res/layout</code> 和 <code>res/imageset</code>；再将它们复制到引擎已登记的资源目录，用“引擎 UIEditor”打开。这里不是引擎源码路径，也不会修改真实引擎工程。</p>
                <p className="export-note">图集优化：仅场景级氛围背景会生成 50% 尺寸的导出副本；引擎 JSON 仍按原设计范围显示，视觉尺寸不变。控件底图和普通图片不受影响。</p>
              </div>
              <div className="export-actions">
                <button className="btn primary export-action" disabled={!engineExport || engineExport.errors.length > 0 || !engineOutputPath.trim()}
                  onClick={() => { void exportEnginePackage(); }}>生成引擎测试包</button>
                <button className="btn export-action" disabled={!engineExport || engineExport.errors.length > 0}
                  onClick={exportEngineJson}>下载最终 JSON</button>
              </div>
              <details className="export-preview">
                <summary>查看 JSON 预览</summary>
                <pre>{engineExport?.json ?? ""}</pre>
              </details>
            </div>
          </section>
        ) : workspace === "bindings" ? (
          <ResourceBindingWorkspace
            nodes={scene?.nodes ?? []}
            layout={result}
            viewport={{ width: layoutCtx?.viewportWidth ?? viewport.width, height: layoutCtx?.viewportHeight ?? viewport.height }}
            selectedIds={selectedIds}
            onSelectImage={(id, event) => selectNode(id, createSelectionIntent(event, flattenLayerIds(scene?.nodes ?? [])))}
            onLocate={locateNode}
            onBind={bindResources}
            onUnbind={unbindResource}
            onResetComplete={resetBindingComplete}
          />
        ) : workspace === "slice" ? (
          <NineSliceWorkspace scene={scene ?? { designWidth: 1280, designHeight: 720, nodes: [] }}
            onScan={scanNineSlice}
            onConfirm={confirmNineSlice}
          />
        ) : workspace === "preview" ? (
          <section className="preview-workspace">
            <header className="preview-workspace-head"><div><span className="workspace-kicker">VISUAL CHECK</span><h2>预览</h2><p>设备比例、安全区和九宫格效果只影响检查显示，不改变节点数据。</p></div>
              <label className="preview-slice-toggle"><input type="checkbox" checked={scene?.useNineSlicePreview ?? false} onChange={toggleNineSlicePreview} />使用已确认的九宫格图</label></header>
            <div className="canvas-wrap preview-workspace-canvas" ref={wrapRef}>{canvasStack}</div>
          </section>
        ) : (
          <div className="canvas-wrap" ref={wrapRef}>
            {!showPreview && canvasStack}
          </div>
        )}
        {workspace === "export" ? <div className="ws-panel" /> : workspace === "slice" ? null : (
          <aside className="right-panel">
            <nav className="right-panel-tabs" aria-label="右侧面板">
              <button className={rightPanelTab === "properties" ? "on" : ""} onClick={() => setRightPanelTab("properties")}>属性</button>
              <button className={rightPanelTab === "overview" ? "on" : ""} onClick={() => setRightPanelTab("overview")}>场景总览</button>
            </nav>
            {rightPanelTab === "overview" ? <SceneOverview
              result={result}
              nodes={scene?.nodes ?? []}
              viewport={{ width: layoutCtx?.viewportWidth ?? viewport.width, height: layoutCtx?.viewportHeight ?? viewport.height }}
              selectedId={selectedId}
              onLocate={locateNode}
              useNineSlice={scene?.useNineSlicePreview}
            /> : <Inspector
              node={walkNodes(scene?.nodes ?? []).find((n) => n.id === selectedId) ?? null}
              rect={result?.nodes.find((n) => n.node.id === selectedId)?.rect ?? null}
              parentDesignSize={(() => {
                const selected = selectedId ? findNodeIncludingResources(scene?.nodes ?? [], selectedId) : null;
                const parent = selected ? findParentNode(scene?.nodes ?? [], selected.id) : null;
                return { width: parent?.designRect.width ?? scene?.designWidth ?? 1280, height: parent?.designRect.height ?? scene?.designHeight ?? 720 };
              })()}
              onUpdate={updateSelected}
              onSetCtrl={setCtrl}
              onReanchor={(a) => updateSelected((n) => {
                const r = result?.nodes.find((x) => x.node.id === n.id)?.rect;
                if (r && layoutCtx) reanchor(n, scene!.designWidth, scene!.designHeight, r, layoutCtx, result!, a);
              })}
              templates={scene?.interactionTemplates ?? []}
              onTemplates={setTemplates}
              onUnbindResource={unbindResource}
            />}
          </aside>
        )}
      </div>
      {quickActionMenu && (
        <QuickActionMenu
          x={quickActionMenu.x}
          y={quickActionMenu.y}
          hasScene={!!scene}
          onNew={createNewProject}
          onOpenProject={openSavedProject}
          onImportPsd={loadPsd}
          onImportImages={importImages}
          onSave={() => { void saveCurrentProject(); }}
          onSaveAs={() => { void saveCurrentProject(true); }}
          onCloseProject={closeProject}
          onClose={() => setQuickActionMenu(null)}
        />
      )}
      {typeMenu && pieNode && (
        <TypePieMenu
          x={typeMenu.x}
          y={typeMenu.y}
          node={pieNode}
          onChoose={(type) => { setCtrl(pieNode.id, type, "quick"); setTypeMenu(null); }}
          onClose={() => setTypeMenu(null)}
        />
      )}
      {showPreview && scene && (
        <div className="preview-overlay">
          <section className="preview-dialog" aria-label="效果预览">
            <header className="preview-dialog-head">
              <div><span className="preview-kicker">IMPORT CHECK</span><h2>效果预览</h2></div>
              <button className="btn" onClick={() => setShowPreview(false)}>进入 UI Editor 修改</button>
            </header>
            <nav className="preview-device-tabs" aria-label="设备预设">
              {previewPresets.map((preset) => (
                <button key={preset.id} className={deviceShell === preset.shell && viewport.width === preset.width && viewport.height === preset.height ? "on" : ""}
                  onClick={() => { setViewport({ width: preset.width, height: preset.height }); setDeviceShell(preset.shell); setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); }}>
                  {preset.label}
                </button>
              ))}
            </nav>
            <div className="preview-canvas-wrap" ref={previewWrapRef} onWheel={onPreviewWheel}
              onPointerDown={onPreviewPointerDown} onPointerMove={onPreviewPointerMove} onPointerUp={onPreviewPointerUp}>
              <div className="preview-canvas-transform" style={{ transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})` }}>
                {canvasStack}
              </div>
              <div className="preview-tip">拖动平移 · 滚轮缩放 · CSS 设备外观仅用于视觉检查</div>
            </div>
            <footer className="preview-dialog-foot">
              <span>当前预览：{viewport.width} × {viewport.height} · {deviceShell}</span>
              <button className="btn" onClick={() => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); }}>居中</button>
            </footer>
          </section>
        </div>
      )}
      {importProgress && (
        <div className="import-overlay" role="status" aria-live="polite">
          <div className="import-progress-card">
            <div className="import-spinner" aria-hidden="true" />
            <strong>正在导入 {importProgress.name}</strong>
            <span>{importProgress.phase}</span>
            <div className="import-progress-track"><i style={{ width: `${Math.round(importProgress.progress * 100)}%` }} /></div>
            <small>{Math.round(importProgress.progress * 100)}% · 导入期间编辑器已锁定</small>
            <button className="btn" onClick={cancelPsdImport}>取消导入</button>
          </div>
        </div>
      )}
      {helpDialog && (
        <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setHelpDialog(null); }}>
          <section className="help-dialog" role="dialog" aria-modal="true" aria-label={helpDialog === "shortcuts" ? "快捷键说明" : "关于 UI2HTML"}>
            <header className="help-dialog-head"><div><span className="workspace-kicker">UI2HTML</span><h2>{helpDialog === "shortcuts" ? "快捷键说明" : "关于 UI2HTML"}</h2></div><button className="icon-btn" onClick={() => setHelpDialog(null)} aria-label="关闭">×</button></header>
            {helpDialog === "shortcuts" ? <div className="shortcut-grid">
              {["Ctrl+S|打开工程操作菜单", "Ctrl+Z|撤销", "Ctrl+X|重做", "F2|重命名节点", "T|转换控件类型", "Ctrl+G|打组", "Alt+G|取消打组", "Ctrl+[ / Ctrl+]|调整层级", "Ctrl+B|绑定资源 / 确认完成", "Alt+W|关闭当前工程"].map((item) => { const [key, label] = item.split("|"); return <div className="shortcut-row" key={key}><kbd>{key}</kbd><span>{label}</span></div>; })}
            </div> : <div className="about-copy"><strong>UI2HTML</strong><p>面向 UI 美术的 PSD 导入、工程整理、视觉检查与自研引擎 JSON 转换工具。</p><small>工程与 PSD 解耦 · 资源可追溯 · 预览优先</small></div>}
            <footer className="help-dialog-foot"><button className="btn primary" onClick={() => setHelpDialog(null)}>知道了</button></footer>
          </section>
        </div>
      )}
      <footer className="statusbar">
        {warnings.length > 0 && (
          <span className="warn" title={warnings.join("\n")}>⚠ {warnings.length} 个导入/分析提示</span>
        )}
        <span className="grow" />
        {exportMsg && <span className="ok">{exportMsg}</span>}
        {!scene && <span className="hint">新建或打开工程，也可以直接导入 PSD / 图片</span>}
      </footer>
    </div>
  );
}
