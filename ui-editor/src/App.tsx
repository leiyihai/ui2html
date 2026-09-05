import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutEngine, reanchor } from "./layoutEngine";
import { importPsd } from "./psdImport";
import { renderOverlay, renderUi } from "./renderer";
import { buildExportHtml } from "./exportHtml";
import type { CtrlType, ImageBinding, InteractionTemplate, LayoutContext, ResourceSlot, ScaleMode, UINode, UIScene } from "./types";
import Appbar from "./components/Toolbar";
import Workbar, { type Workspace } from "./components/WorkspaceTabs";
import LayerPanel from "./components/LayerPanel";
import Inspector from "./components/Inspector";
import ControlsPanel from "./components/ControlsPanel";
import TypePieMenu from "./components/TypePieMenu";
import QuickActionMenu from "./components/QuickActionMenu";
import { SliceEditor, SliceList } from "./components/SlicePanel";
import { markControlType } from "./controlType";
import { hasResourceSlots, planResourceBindings, resourceSlotDefinitions } from "./resourceBinding";
import { moveLayerOrder, type LayerOrderDirection } from "./layerOrder";
import { restoreSceneSnapshot, serializeScene, type SavedProjectView } from "./scenePersistence";
import { prepareSceneAssets } from "./projectAssets";
import { openProject, projectFileName, saveProject } from "./projectApi";
import { canvasFromImageFile, createImageNode } from "./imageImport";
import { applySelection, createSelectionIntent, flattenLayerIds, type SelectionIntent } from "./selection";
import { autoControlName } from "./nodeNaming";

export const PRESETS: [string, number, number][] = [
  ["16:9 (1920 × 1080)", 1920, 1080],
  ["18:9 (2160 × 1080)", 2160, 1080],
  ["21:9 (2520 × 1080)", 2520, 1080],
  ["iPad 横屏 (1024 × 768)", 1024, 768],
  ["iPad 竖屏 (768 × 1024)", 768, 1024],
  ["iPhone 刘海屏 (390 × 844)", 390, 844],
];

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
    anchor: { ...n.anchor },
    ctrl: n.ctrl ? { ...n.ctrl } : undefined,
    text: n.text ? { ...n.text } : undefined,
    slice: n.slice ? { ...n.slice } : undefined,
    progress: n.progress ? { ...n.progress } : undefined,
    list: n.list ? { ...n.list, padding: { ...n.list.padding } } : undefined,
    resources,
    children: n.children?.map(cloneNode),
  };
}

// 撤销快照：保存完整树结构；canvas 引用保持不变，只复制节点配置。
type Snapshot = UINode[];
const snapScene = (s: UIScene): Snapshot => s.nodes.map(cloneNode);
const applySnap = (snap: Snapshot): UINode[] => snap.map(cloneNode);

const HISTORY_LIMIT = 50; // 步数不用保留太多
const STATUS_MESSAGE_DURATION_MS = 4000;

export default function App() {
  const [scene, setScene] = useState<UIScene | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [safeArea, setSafeArea] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [scaleMode, setScaleMode] = useState<ScaleMode>("cover");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showDesignBorder, setShowDesignBorder] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [histLen, setHistLen] = useState(0);
  const [futureLen, setFutureLen] = useState(0);
  const [psdName, setPsdName] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名.ui.json");
  const [dirty, setDirty] = useState(false);
  const [sliceApplied, setSliceApplied] = useState(false);
  const [sliceSelected, setSliceSelected] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("controls");
  const [exportMsg, setExportMsg] = useState("");
  const [typeMenu, setTypeMenu] = useState<{ x: number; y: number } | null>(null);
  const [quickActionMenu, setQuickActionMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameCaretMode, setRenameCaretMode] = useState<"all" | "prefix">("all");

  const uiRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const sceneRef = useRef<UIScene | null>(null); // 同步引用（事件中立即更新）
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);

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
    renderUi(ui.getContext("2d")!, result, sliceApplied);
    renderOverlay(ov.getContext("2d")!, result, layoutCtx, {
      selectedId, selectedIds, showGrid: false, showSafeArea, showDesignBorder,
    });
  }, [result, layoutCtx, selectedId, selectedIds, showSafeArea, showDesignBorder, sliceApplied]);

  // 画布 CSS 尺寸：contain 到窗口（切回图层 tab 时重新计算）
  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current;
      if (!wrap || !layoutCtx || wrap.style.display === "none") return;
      const s = Math.min(wrap.clientWidth / layoutCtx.viewportWidth, wrap.clientHeight / layoutCtx.viewportHeight) * 0.72;
      for (const c of [uiRef.current, ovRef.current]) {
        if (c) { c.style.width = `${layoutCtx.viewportWidth * s}px`; c.style.height = `${layoutCtx.viewportHeight * s}px`; }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [layoutCtx, workspace]);

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
    const next: UIScene = { designWidth: 1280, designHeight: 720, nodes: [], sliceSources: [], interactionTemplates: [] };
    resetHistory();
    applyScene(next);
    setProjectPath(null);
    setProjectName("未命名.ui.json");
    setPsdName(null);
    setViewport({ width: 1280, height: 720 });
    setSafeArea({ left: 0, right: 0, top: 0, bottom: 0 });
    setScaleMode("cover");
    selectionAnchorRef.current = null;
    setSelectedId(null);
    setSelectedIds([]);
    setWarnings([]);
    setDirty(false);
    setRenameCaretMode("all");
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
      setPsdName(projectFileName(opened.path));
      setViewport(view?.viewport ?? { width: restored.scene.designWidth, height: restored.scene.designHeight });
      setSafeArea(view?.safeArea ?? { left: 0, right: 0, top: 0, bottom: 0 });
      setScaleMode(view?.scaleMode ?? "cover");
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
        saveAs,
      });
      if (!nextPath) return;
      applyScene(prepared.scene);
      setProjectPath(nextPath);
      setProjectName(projectFileName(nextPath));
      setPsdName(projectFileName(nextPath));
      setDirty(false);
      setExportMsg(`已保存 ${projectFileName(nextPath)} ✓`);
    } catch (error) {
      setExportMsg(error instanceof Error ? error.message : "保存工程失败");
    }
  }, [applyScene, projectName, projectPath, safeArea, scaleMode, showDesignBorder, showSafeArea, viewport]);

  const loadPsd = useCallback(async (buffer: ArrayBuffer, name: string) => {
    try {
      const imported = importPsd(buffer);
      const current = sceneRef.current;
      if (current) {
        mutateScene((source) => ({ ...source, nodes: [...source.nodes, ...imported.scene.nodes] }));
      } else {
        resetHistory();
        applyScene(imported.scene);
        setViewport({ width: imported.scene.designWidth, height: imported.scene.designHeight });
        setProjectPath(null);
        setProjectName(`${name.replace(/\.(psd|psb)$/i, "")}.ui.json`);
      }
      setPsdName(name);
      setWarnings(imported.warnings);
      const importedIds = imported.scene.nodes.map((node) => node.id);
      selectionAnchorRef.current = importedIds.at(-1) ?? null;
      setSelectedIds(importedIds);
      setSelectedId(importedIds.at(-1) ?? null);
      setDirty(true);
      setExportMsg(`已从 ${name} 导入 ${walkNodes(imported.scene.nodes).length} 个节点`);
    } catch (error) {
      setExportMsg(error instanceof Error ? error.message : `无法导入 ${name}`);
    }
  }, [applyScene, mutateScene, resetHistory]);

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

  /** F2：让当前单选节点进入层级树内联重命名状态。 */
  const beginRenameSelected = useCallback(() => {
    const current = sceneRef.current;
    const node = current && selectedId
      ? walkNodes(current.nodes).find((item) => item.id === selectedId)
      : undefined;
    if (!node || node.locked || selectedIds.length !== 1) return;
    setRenameCaretMode("all");
    setRenamingId(node.id);
  }, [selectedId, selectedIds]);

  const commitRename = useCallback((id: string, value: string) => {
    setRenamingId(null);
    setRenameCaretMode("all");
    const nextName = value.trim();
    const current = sceneRef.current;
    const node = current ? walkNodes(current.nodes).find((item) => item.id === id) : undefined;
    if (!node || node.locked || !nextName || nextName === node.name) return;
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, id, (item) => { item.name = nextName; }) }));
    setExportMsg(`已将节点重命名为「${nextName}」`);
  }, [mutateScene]);

  /** Alt+W：关闭当前工程，避免与浏览器关闭页签的 Ctrl+W 冲突。 */
  const closeProject = useCallback(() => {
    if (!sceneRef.current) return;
    if (dirty && !window.confirm("当前工程有未保存修改，确定放弃并关闭吗？")) return;
    sceneRef.current = null;
    setScene(null);
    setPsdName(null);
    setProjectPath(null);
    setProjectName("未命名.ui.json");
    setDirty(false);
    setRenamingId(null);
    setRenameCaretMode("all");
    setSelectedId(null);
    selectionAnchorRef.current = null;
    setSelectedIds([]);
    setWarnings([]);
    setSliceSelected(null);
    setSliceApplied(false);
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

  const updateNode = useCallback((id: string, patch: (n: UINode) => void, record = true) => {
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, id, patch) }), record);
  }, [mutateScene]);

  /** 控件类型标签 */
  const setCtrl = useCallback((id: string, type: CtrlType | null) => {
    const current = sceneRef.current;
    const source = current && walkNodes(current.nodes).find((node) => node.id === id);
    if (!current || !source) return;
    const sourcePath = findPath(current.nodes, id);
    const parentPath = sourcePath?.slice(0, -1) ?? [];
    const siblings = parentPath.length ? nodeAtPath(current.nodes, parentPath)?.children ?? [] : current.nodes;
    const shouldAutoRename = source.ctrl?.type === "Layout"
      && type !== "Layout"
      && !isFixedRootNode(current, source, sourcePath);
    const generatedName = shouldAutoRename
      ? autoControlName(type, siblings.filter((node) => node.id !== id))
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
    if (generatedName) {
      setRenameCaretMode("prefix");
      setRenamingId(id);
    }
    if (stale.length) setExportMsg(`已切换类型，并恢复 ${stale.length} 个不兼容资源节点`);
  }, [mutateScene]);

  /** Ctrl+B：将选中的图片按名称/选择顺序填入共同控件祖先的空资源槽位。 */
  const bindResources = useCallback(() => {
    const current = sceneRef.current;
    if (!current || !selectedIds.length) return;
    const selected = selectedIds.map((id) => walkNodes(current.nodes).find((node) => node.id === id));
    if (selected.some((node) => !node || !node.image)) {
      setExportMsg("绑定已取消：选择中包含非图片节点");
      return;
    }
    const images = selected.filter((node): node is UINode => Boolean(node));
    const target = nearestBindableAncestor(current.nodes, selectedIds);
    if (!target) {
      setExportMsg("绑定失败：未找到共同的可绑定控件");
      return;
    }
    const plan = planResourceBindings(target.node.ctrl?.type, images, target.node.resources);
    if (!plan.assignments.length) {
      setExportMsg("绑定失败：目标控件没有空资源槽位");
      return;
    }

    const assignments = plan.assignments.map(({ slot, node }) => {
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
    const assignedIds = new Set(assignments.map((item) => item.node.id));
    const removed = removeNodes(current.nodes, assignedIds);
    const nextNodes = mapNodes(removed, target.node.id, (node) => {
      node.resources = { ...(node.resources ?? {}) };
      for (const item of assignments) node.resources[item.slot] = item.binding;
    });
    mutateScene((s) => ({ ...s, nodes: nextNodes }));
    selectionAnchorRef.current = target.node.id;
    setSelectedIds([target.node.id]);
    setSelectedId(target.node.id);
    const skipped = plan.skipped.length;
    setExportMsg(`已绑定 ${assignments.length} 个资源槽位${skipped ? `，${skipped} 张图片未绑定` : ""}`);
  }, [mutateScene, selectedIds]);

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

  // ---- 九宫格：一键替换 / 切换对比 / 还原 ----
  const replaceWithSlice = useCallback(() => {
    if (!scene || !psdName) return;
    mutateScene((s) => {
      const nodes = s.nodes.map((n) => ({ ...n }));
      const sources = s.sliceSources ?? [];
      let n = 0;
      for (const src of sources) {
        walkNodes(nodes).forEach((x) => {
          if (x.image && x.name === src.name) {
            x.sliceImage = src.canvas;
            const saved = localStorage.getItem(`ui2html.slice.${psdName}.${src.name}`);
            x.slice = saved ? JSON.parse(saved) : { left: 0, top: 0, right: 0, bottom: 0 };
            n++;
          }
        });
      }
      setExportMsg(`已替换 ${n} 个图片为九宫格版本`);
      return { ...s, nodes };
    });
    setSliceApplied(true);
  }, [scene, psdName, mutateScene]);

  const toggleSlice = useCallback(() => setSliceApplied((v) => !v), []);

  const restoreSlice = useCallback(() => {
    mutateScene((s) => {
      const nodes = s.nodes.map((n) => ({ ...n }));
      walkNodes(nodes).forEach((x) => { if (x.sliceImage) { x.sliceImage = null; x.slice = undefined; } });
      return { ...s, nodes };
    });
    setSliceApplied(false);
    setExportMsg("已还原九宫格替换前的版本");
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
    applyScene({ ...s, nodes: applySnap(snap) });
    setDirty(true);
    setHistLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, [applyScene]);

  const redo = useCallback(() => {
    const snap = futureRef.current.pop();
    if (!snap) return;
    historyRef.current.push(snapScene(sceneRef.current!));
    const s = sceneRef.current!;
    applyScene({ ...s, nodes: applySnap(snap) });
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
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
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
  }, [undo, redo, selectedId, selectedIds, typeMenu, quickActionMenu, updateSelected, saveCurrentProject, bindResources, groupSelected, ungroupSelected, moveSelectedLayer, beginRenameSelected, closeProject]);

  // 命中检测 + 拖动（文档 §17：拖动只改 offset，不碰 designRect）
  const toLogical = (clientX: number, clientY: number) => {
    const ui = uiRef.current!;
    const r = ui.getBoundingClientRect();
    const k = layoutCtx!.viewportWidth / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
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
  const pieNode = typeMenu && selectedId
    ? walkNodes(scene?.nodes ?? []).find((node) => node.id === selectedId) ?? null
    : null;

  return (
    <div className="app">
      <Appbar
        projectName={projectName} dirty={dirty}
        onNew={createNewProject} onOpenProject={openSavedProject}
        onImportPsd={loadPsd} onImportImages={importImages}
        hasScene={!!scene} canUndo={histLen > 0} canRedo={futureLen > 0} onUndo={undo} onRedo={redo}
        onSave={() => { void saveCurrentProject(); }} onSaveAs={() => { void saveCurrentProject(true); }}
        onExportHtml={exportHtml} onGlobalFont={applyGlobalFont}
      />
      <Workbar
        ws={workspace} onWs={setWorkspace} hasScene={!!scene}
        lockLayout={!!scene && walkNodes(scene.nodes).some((n) => !n.ctrl)}
        onLocked={() => setExportMsg("请先在「层级」工作区选中节点，并在右侧属性面板完成控件类型标记")}
        sliceAvailable={(scene?.sliceSources?.length ?? 0) > 0} sliceApplied={sliceApplied}
        onReplaceSlice={replaceWithSlice} onToggleSlice={toggleSlice} onRestoreSlice={restoreSlice}
        viewport={viewport} onViewport={setViewport}
        safeArea={safeArea} onSafeArea={setSafeArea}
        scaleMode={scaleMode} onScaleMode={setScaleMode}
        showSafeArea={showSafeArea} onShowSafeArea={setShowSafeArea}
        showDesignBorder={showDesignBorder} onShowDesignBorder={setShowDesignBorder}
      />
      <div className="body">
        {workspace === "controls" ? (
          <ControlsPanel nodes={scene?.nodes ?? []} selectedIds={selectedIds} onSelect={selectNode}
            renamingId={renamingId} renameCaretMode={renameCaretMode}
            onRename={commitRename} onCancelRename={() => setRenamingId(null)}
            onToggleVisible={(id) => updateNode(id, (n) => { n.visible = !n.visible; })}
            onToggleLock={(id) => updateNode(id, (n) => { n.locked = !n.locked; })}
          />
        ) : workspace === "slice" ? (
          <div className="layer-panel">
            <h3>九宫格图片</h3>
            <SliceList sources={scene?.sliceSources ?? []} selected={sliceSelected}
              onSelect={(name) => setSliceSelected(sliceSelected === name ? null : name)} />
          </div>
        ) : workspace === "layout" ? (
          <LayerPanel
            nodes={scene?.nodes ?? []} selectedId={selectedId} selectedIds={selectedIds}
            onSelect={(id, intent) => selectNode(id, intent)}
            renamingId={renamingId} renameCaretMode={renameCaretMode}
            onRename={commitRename} onCancelRename={() => setRenamingId(null)}
            onToggleVisible={(id) => updateNode(id, (n) => { n.visible = !n.visible; })}
            onToggleLock={(id) => updateNode(id, (n) => { n.locked = !n.locked; })}
          />
        ) : (
          <div className="ws-panel" />
        )}
        {workspace === "slice" && (
          sliceSelected && scene ? (
            <SliceEditor
              key={sliceSelected}
              source={scene.sliceSources?.find((s) => s.name === sliceSelected)!}
              psdName={psdName} onBack={() => setSliceSelected(null)}
            />
          ) : (
            <div className="slice-editor">
              <span className="slice-empty">从左侧列表选择一张图片进行九宫格标记</span>
            </div>
          )
        )}
        {workspace === "animation" ? (
          <div className="ws-placeholder">动画编辑器（开发中，敬请期待）</div>
        ) : workspace === "export" ? (
          <div className="ws-placeholder">导出设置（开发中）<br />目标：PSD → 自研引擎 UI 文件</div>
        ) : (
          <div className="canvas-wrap" ref={wrapRef}
            style={workspace === "slice" ? { display: "none" } : undefined}>
            <div className="canvas-stack">
              <canvas ref={uiRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
              <canvas ref={ovRef} style={{ pointerEvents: "none" }} />
            </div>
          </div>
        )}
        {workspace === "animation" || workspace === "export" ? (
          <div className="ws-panel" />
        ) : (
          <Inspector
            node={walkNodes(scene?.nodes ?? []).find((n) => n.id === selectedId) ?? null}
            rect={result?.nodes.find((n) => n.node.id === selectedId)?.rect ?? null}
            viewport={viewport}
            onUpdate={updateSelected}
            onSetCtrl={setCtrl}
            onReanchor={(a) => updateSelected((n) => {
              const r = result!.nodes.find((x) => x.node.id === n.id)!.rect;
              reanchor(n, scene!.designWidth, scene!.designHeight, r, layoutCtx!, result!, a);
            })}
            templates={scene?.interactionTemplates ?? []}
            onTemplates={setTemplates}
            onUnbindResource={unbindResource}
          />
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
          onClose={() => setQuickActionMenu(null)}
        />
      )}
      {typeMenu && pieNode && (
        <TypePieMenu
          x={typeMenu.x}
          y={typeMenu.y}
          node={pieNode}
          onChoose={(type) => { setCtrl(pieNode.id, type); setTypeMenu(null); }}
          onClose={() => setTypeMenu(null)}
        />
      )}
      <footer className="statusbar">
        {warnings.length > 0 && (
          <span className="warn" title={warnings.join("\n")}>⚠ {warnings.length} 个图层被跳过</span>
        )}
        <span className="grow" />
        {exportMsg && <span className="ok">{exportMsg}</span>}
        {!scene && <span className="hint">新建或打开工程，也可以直接导入 PSD / 图片</span>}
      </footer>
    </div>
  );
}
