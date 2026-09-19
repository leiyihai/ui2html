import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutEngine, reanchor } from "./layoutEngine";
import { importPsd } from "./psdImport";
import { renderOverlay, renderUi } from "./renderer";
import { buildExportHtml } from "./exportHtml";
import { loadUsedHtmlFonts } from "./htmlFonts";
import { buildEngineJson, createEngineAssetManifest } from "./engineExport";
import type { CtrlType, ImageBinding, InteractionTemplate, LayoutContext, NineSliceCandidate, NineSliceMargins, ResourceSlot, ScaleMode, UINode, UIScene } from "./types";
import Appbar from "./components/Toolbar";
import { WORKFLOW_OPTIONS, type Workspace, type WorkspaceOption } from "./components/WorkspaceTabs";
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
import { typeConversionNames } from "./nodeNaming";
import { prefersEngineeringNames } from "./layerNameMode";
import { applyAiNaming, buildNamingManifest, warningNodeIds } from "./aiNaming";
import type { ProjectAnalysis } from "./types";
import { type DeviceShell } from "./devicePreview";
import ResourceBindingWorkspace from "./components/ResourceBindingWorkspace";
import SceneOverview from "./components/SceneOverview";
import NineSliceWorkspace, {
  NineSliceCandidatesTool,
  NineSliceMarkerTool,
  NineSliceOverviewTool,
  NineSliceWorkspaceProvider,
} from "./components/SlicePanel";
import PreviewDeviceFrame from "./components/PreviewDeviceFrame";
import { generateNineSliceImage, groupFromCandidate, scanNineSliceCandidates } from "./nineSlice";
import { normalizeLayoutValue, syncNodeLayoutPosition } from "./layoutValues";
import { clampCanvasZoom, defaultPreviewView, findCanvasHit, panForZoomAtPoint, previewCanvasSizeForWrap } from "./canvasView";
import ExportTargetPanel, { type ExportTarget } from "./components/ExportTargetPanel";
import SettingsDialog from "./components/SettingsDialog";
import { Icon } from "./components/Icon";
import AreaLayout from "./components/AreaLayout";
import WorkspaceAreaToolbar from "./components/WorkspaceAreaToolbar";
import { CanvasZoomControl, FontPickerControl, PreviewToolActions, type PreviewToolActionsProps } from "./components/AreaToolActions";
import {
  areaLeaves,
  createDefaultAreaLayout,
  createDefaultWorkspaceLayouts,
  findArea,
  joinArea,
  joinAreaPair,
  migrateWorkspaceLayout,
  resizeAreaSplit,
  sanitizeAreaLayout,
  splitArea,
  swapAreaSplit,
  updateAreaTool,
  type AreaLeaf,
  type AreaNode,
  type AreaSplitAxis,
  type AreaTool,
} from "./areaLayout";

export interface ImportProgress {
  name: string;
  phase: string;
  progress: number;
}

type ToolbarActionIconKind = "project-name" | "ai-name" | "type-convert";

function ToolbarActionIcon({ kind }: { kind: ToolbarActionIconKind }) {
  if (kind === "project-name") return <Icon name="name-toggle" size={16} />;
  if (kind === "ai-name") return <Icon name="sparkles" size={16} />;
  return <Icon name="grid" size={16} />;
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

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type CanvasResizeDrag = {
  areaId: string;
  mode: "editor" | "preview";
  id: string;
  corner: ResizeCorner;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
  startOffsetX: number;
  startOffsetY: number;
  parentWidth: number;
  parentHeight: number;
  widthMode: "absolute" | "relative";
  heightMode: "absolute" | "relative";
};

function resizeCornerAt(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }, tolerance: number): ResizeCorner | null {
  const corners: Array<[ResizeCorner, number, number]> = [
    ["nw", rect.x, rect.y], ["ne", rect.x + rect.width, rect.y],
    ["sw", rect.x, rect.y + rect.height], ["se", rect.x + rect.width, rect.y + rect.height],
  ];
  const hit = corners.find(([, x, y]) => Math.hypot(point.x - x, point.y - y) <= tolerance);
  return hit?.[0] ?? null;
}

const RESIZE_CURSORS: Record<ResizeCorner, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
};

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
const UI_SCALE_STORAGE_KEY = "ui2html.uiScale";
const UI_SCALE_DEFAULT = 1.2;
const UI_SCALE_MIN = 1;
const UI_SCALE_MAX = 1.3;
const REDUCE_MOTION_STORAGE_KEY = "ui2html.reduceMotion";
const SHOW_SHORTCUT_HINTS_STORAGE_KEY = "ui2html.showShortcutHints";
const AREA_LAYOUT_STORAGE_PREFIX = "ui2html.area-layout:";
const WORKSPACE_OPTIONS_STORAGE_KEY = "ui2html.workspace-options";

function normalizeUiScale(value: number): number {
  const rounded = Number(value.toFixed(2));
  return Number.isFinite(rounded) && rounded >= UI_SCALE_MIN && rounded <= UI_SCALE_MAX ? rounded : UI_SCALE_MIN;
}

function readUiScale(): number {
  try {
    const raw = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
    if (raw === null) return UI_SCALE_DEFAULT;
    const saved = Number(raw);
    return normalizeUiScale(saved);
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const saved = window.localStorage.getItem(key);
    return saved === null ? fallback : saved === "true";
  } catch {
    return fallback;
  }
}

function readWorkspaceOptions(): WorkspaceOption[] {
  const defaults = WORKFLOW_OPTIONS.map((item) => ({ ...item }));
  try {
    const raw = window.localStorage.getItem(WORKSPACE_OPTIONS_STORAGE_KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as unknown;
    if (!Array.isArray(stored)) return defaults;
    const labels = new Map<string, string>();
    const custom: WorkspaceOption[] = [];
    for (const value of stored) {
      if (!value || typeof value !== "object") continue;
      const item = value as Partial<WorkspaceOption>;
      if (typeof item.value !== "string" || typeof item.label !== "string") continue;
      const label = item.label.trim().slice(0, 32);
      if (!label) continue;
      if (defaults.some((entry) => entry.value === item.value)) labels.set(item.value, label);
      else if (item.value.startsWith("custom-") && !custom.some((entry) => entry.value === item.value)) {
        custom.push({ value: item.value, label, builtIn: false });
      }
    }
    return defaults.map((item) => ({ ...item, label: labels.get(item.value) ?? item.label })).concat(custom);
  } catch {
    return defaults;
  }
}

function areaLayoutStorageKey(path: string | null, name: string): string {
  return `${AREA_LAYOUT_STORAGE_PREFIX}${path ?? `untitled:${name}`}`;
}

const WORKFLOW_KEYS: Workspace[] = ["controls", "bindings", "slice", "preview", "export"];

function readWorkspaceLayouts(path: string | null, name: string, workspaceIds: Workspace[] = WORKFLOW_KEYS): Record<Workspace, AreaNode> {
  const defaults = createDefaultWorkspaceLayouts(workspaceIds);
  try {
    const raw = window.localStorage.getItem(areaLayoutStorageKey(path, name));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // 兼容旧版单一区域树：旧布局无法可靠映射到新的“工作区→工具区域”模型，改用清晰的默认组合。
    if (parsed.kind) return defaults;
    for (const workflow of workspaceIds) {
      const restored = sanitizeAreaLayout(parsed[workflow]);
      if (restored) defaults[workflow] = migrateWorkspaceLayout(workflow, restored, defaults[workflow]);
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export default function App() {
  const [scene, setScene] = useState<UIScene | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  // 预览工作区自己的视口。在预览里换设备比例只影响预览，不能改到工程视口
  // （否则回到层集工作区画布比例也跟着变，而且会被写进工程文件）。
  const [previewViewport, setPreviewViewport] = useState<{ width: number; height: number } | null>(null);
  const [safeArea, setSafeArea] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [scaleMode, setScaleMode] = useState<ScaleMode>("cover");
  const [deviceShell, setDeviceShell] = useState<DeviceShell>("desktop");
  const [showDeviceShell, setShowDeviceShell] = useState(true);
  // 预览工作区默认只负责视觉检查；需要边看边修正时切换到编辑检查布局。
  const [previewLayoutMode, setPreviewLayoutMode] = useState<PreviewToolActionsProps["previewLayoutMode"]>("pure");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [areaCanvasZooms, setAreaCanvasZooms] = useState<Record<string, number>>({});
  const [areaCanvasPans, setAreaCanvasPans] = useState<Record<string, { x: number; y: number }>>({});
  const [areaPreviewZooms, setAreaPreviewZooms] = useState<Record<string, number>>({});
  const [areaPreviewPans, setAreaPreviewPans] = useState<Record<string, { x: number; y: number }>>({});
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [canvasPanning, setCanvasPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(false);
  // 设计画布边界是纯查看辅助线，不写入工程；每次启动/打开工程均默认关闭。
  const [showDesignBorder, setShowDesignBorder] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [histLen, setHistLen] = useState(0);
  const [futureLen, setFutureLen] = useState(0);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名.ui.json");
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [dirty, setDirty] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>("controls");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>(readWorkspaceOptions);
  const workspaceIds = workspaceOptions.map((item) => item.value);
  const [areaLayouts, setAreaLayouts] = useState<Record<Workspace, AreaNode>>(() => createDefaultWorkspaceLayouts(workspaceIds));
  const areaLayout = areaLayouts[workspace] ?? createDefaultAreaLayout("canvas");
  const [activeAreaId, setActiveAreaId] = useState("area-controls-canvas");
  const [exportTarget, setExportTarget] = useState<ExportTarget>("engine");
  const [areaExportTargets, setAreaExportTargets] = useState<Record<string, ExportTarget>>({});
  const [exportMsg, setExportMsg] = useState("");
  const [engineOutputPath, setEngineOutputPath] = useState("");
  const [typeMenu, setTypeMenu] = useState<{ x: number; y: number } | null>(null);
  const [quickActionMenu, setQuickActionMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameCaretMode, setRenameCaretMode] = useState<"all" | "prefix">("all");
  const [layerNameMode, setLayerNameMode] = useState<LayerNameMode>("original");
  const [helpDialog, setHelpDialog] = useState<"shortcuts" | "about" | null>(null);
  const [aiNamingConfirm, setAiNamingConfirm] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState(false);
  const [uiScale, setUiScale] = useState(readUiScale);
  const [reduceMotion, setReduceMotion] = useState(() => readStoredBoolean(REDUCE_MOTION_STORAGE_KEY, false));
  const [showShortcutHints, setShowShortcutHints] = useState(() => readStoredBoolean(SHOW_SHORTCUT_HINTS_STORAGE_KEY, true));

  const uiRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const areaCanvasRefs = useRef(new Map<string, { ui?: HTMLCanvasElement; ov?: HTMLCanvasElement; wrap?: HTMLDivElement; previewWrap?: HTMLDivElement }>());
  const areaLayoutRef = useRef<AreaNode>(areaLayout);
  const dragRef = useRef<{ areaId: string; mode: "editor" | "preview"; id: string; startX: number; startY: number } | null>(null);
  const resizeRef = useRef<CanvasResizeDrag | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const sceneRef = useRef<UIScene | null>(null); // 同步引用（事件中立即更新）
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const previewDragRef = useRef<{ areaId: string; x: number; y: number; panX: number; panY: number } | null>(null);
  const canvasPanRef = useRef({ x: 0, y: 0 });
  const canvasPanDragRef = useRef<{ areaId: string; x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceHeldRef = useRef(false);

  useEffect(() => { areaLayoutRef.current = areaLayout; }, [areaLayout]);

  useEffect(() => {
    if (!scene) return;
    try {
      window.localStorage.setItem(areaLayoutStorageKey(projectPath, projectName), JSON.stringify(areaLayouts));
    } catch { /* 区域布局只属于编辑器本地偏好，保存失败不影响工程 */ }
  }, [areaLayouts, projectName, projectPath, scene]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_OPTIONS_STORAGE_KEY, JSON.stringify(workspaceOptions));
    } catch { /* 工作区名称只属于编辑器偏好，保存失败不影响工程 */ }
  }, [workspaceOptions]);

  const setAreaLayout = useCallback((next: AreaNode | ((current: AreaNode) => AreaNode)) => {
    setAreaLayouts((current) => {
      const currentLayout = current[workspace] ?? createDefaultAreaLayout("canvas");
      const nextLayout = typeof next === "function" ? next(currentLayout) : next;
      return { ...current, [workspace]: nextLayout };
    });
  }, [workspace]);

  const setAreaCanvasRef = (areaId: string, key: "ui" | "ov" | "wrap" | "previewWrap", value: HTMLCanvasElement | HTMLDivElement | null) => {
    const refs = areaCanvasRefs.current.get(areaId) ?? {};
    if (value) refs[key] = value as never;
    else delete refs[key];
    areaCanvasRefs.current.set(areaId, refs);
    if (areaId === activeAreaId) {
      if (key === "ui") uiRef.current = value as HTMLCanvasElement | null;
      if (key === "ov") ovRef.current = value as HTMLCanvasElement | null;
      if (key === "wrap") wrapRef.current = value as HTMLDivElement | null;
      if (key === "previewWrap") previewWrapRef.current = value as HTMLDivElement | null;
    }
  };

  const areaRefs = (areaId: string) => areaCanvasRefs.current.get(areaId) ?? {};
  const canvasZoomFor = (areaId: string) => areaCanvasZooms[areaId] ?? (areaId === activeAreaId ? canvasZoom : 1);
  const canvasPanFor = (areaId: string) => areaCanvasPans[areaId] ?? (areaId === activeAreaId ? canvasPan : { x: 0, y: 0 });
  const previewZoomFor = (areaId: string) => areaPreviewZooms[areaId] ?? (areaId === activeAreaId ? previewZoom : 1);
  const previewPanFor = (areaId: string) => areaPreviewPans[areaId] ?? (areaId === activeAreaId ? previewPan : { x: 0, y: 0 });
  const activateArea = useCallback((areaId: string) => {
    const leaf = findArea(areaLayoutRef.current, areaId);
    if (!leaf) return;
    setActiveAreaId(areaId);
    const refs = areaRefs(areaId);
    uiRef.current = refs.ui ?? null;
    ovRef.current = refs.ov ?? null;
    wrapRef.current = refs.wrap ?? null;
    previewWrapRef.current = refs.previewWrap ?? null;
  }, []);

  useEffect(() => {
    document.title = `${projectName}${dirty ? " · 未保存" : ""} — UI2HTML`;
  }, [projectName, dirty]);

  useEffect(() => {
    try { window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(uiScale)); } catch { /* 设置持久化失败不影响编辑 */ }
  }, [uiScale]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REDUCE_MOTION_STORAGE_KEY, String(reduceMotion));
      window.localStorage.setItem(SHOW_SHORTCUT_HINTS_STORAGE_KEY, String(showShortcutHints));
    } catch { /* 设置持久化失败不影响编辑 */ }
  }, [reduceMotion, showShortcutHints]);

  // 预览工作区走独立视口，其余工作区（含保存到工程文件）都用工程视口。
  const editorLayoutCtx: LayoutContext | null = useMemo(
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
  const previewViewportValue = previewViewport ?? viewport;
  const previewLayoutCtx: LayoutContext | null = useMemo(
    () => (scene ? {
      designWidth: scene.designWidth,
      designHeight: scene.designHeight,
      viewportWidth: previewViewportValue.width,
      viewportHeight: previewViewportValue.height,
      safeArea,
      scaleMode,
    } : null),
    [scene, previewViewportValue, safeArea, scaleMode],
  );
  const activeViewport = workspace === "preview" ? previewViewportValue : viewport;
  const activeAreaTool = findArea(areaLayout, activeAreaId)?.tool;
  const layoutCtx = workspace === "preview" ? previewLayoutCtx : editorLayoutCtx;
  const editorResult = useMemo(
    () => (scene && editorLayoutCtx ? new LayoutEngine().layoutScene(scene, editorLayoutCtx) : null),
    [scene, editorLayoutCtx],
  );
  const previewResult = useMemo(
    () => (scene && previewLayoutCtx ? new LayoutEngine().layoutScene(scene, previewLayoutCtx) : null),
    [scene, previewLayoutCtx],
  );
  // 工程视口变化（新建 / 打开 / 导入）时丢弃预览视口，让它重新跟随工程。
  useEffect(() => { setPreviewViewport(null); }, [viewport]);
  const result = useMemo(
    () => workspace === "preview" ? previewResult : editorResult,
    [editorResult, previewResult, workspace],
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
    if (!scene) return;
    const dpr = window.devicePixelRatio || 1;
    for (const area of areaLeaves(areaLayout)) {
      const refs = areaRefs(area.id);
      const areaResult = area.tool === "preview" ? previewResult : editorResult;
      const areaCtx = area.tool === "preview" ? previewLayoutCtx : editorLayoutCtx;
      const ui = refs.ui;
      const ov = refs.ov;
      if (!ui || !ov || !areaResult || !areaCtx) continue;
      for (const canvas of [ui, ov]) {
        canvas.width = areaCtx.viewportWidth * dpr;
        canvas.height = areaCtx.viewportHeight * dpr;
        canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      renderUi(ui.getContext("2d")!, areaResult, scene.useNineSlicePreview ?? false);
      const isPreview = area.tool === "preview";
      const previewCanEdit = isPreview && previewLayoutMode === "edit";
      renderOverlay(ov.getContext("2d")!, areaResult, areaCtx, {
        selectedId: isPreview && !previewCanEdit ? null : selectedId,
        selectedIds: isPreview && !previewCanEdit ? [] : selectedIds,
        showGrid: false, showSafeArea, showDesignBorder,
      });
    }
  }, [areaLayout, editorLayoutCtx, editorResult, previewLayoutCtx, previewResult, previewLayoutMode, scene, selectedId, selectedIds, showSafeArea, showDesignBorder]);

  // 画布 CSS 尺寸：contain 到窗口（切回图层 tab 时重新计算）
  useEffect(() => {
    const fit = () => {
      for (const area of areaLeaves(areaLayout)) {
        const refs = areaRefs(area.id);
        const areaCtx = area.tool === "preview" ? previewLayoutCtx : editorLayoutCtx;
        const wrap = area.tool === "preview" ? refs.previewWrap : refs.wrap;
        if (!wrap || !areaCtx || wrap.style.display === "none") continue;
        const s = area.tool === "preview"
          ? previewCanvasSizeForWrap(wrap.clientWidth, wrap.clientHeight, areaCtx.viewportWidth, areaCtx.viewportHeight, showDeviceShell).scale
          : Math.min(
            Math.max(1, wrap.clientWidth) / areaCtx.viewportWidth,
            Math.max(1, wrap.clientHeight) / areaCtx.viewportHeight,
          ) * 0.72;
        for (const canvas of [refs.ui, refs.ov]) {
          if (canvas) {
            canvas.style.width = `${areaCtx.viewportWidth * s}px`;
            canvas.style.height = `${areaCtx.viewportHeight * s}px`;
          }
        }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [areaLayout, editorLayoutCtx, previewLayoutCtx, previewLayoutMode, showDeviceShell]);

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
    setAreaLayouts(createDefaultWorkspaceLayouts(workspaceIds));
    setActiveAreaId("area-controls-canvas");
    setWorkspace("controls");
    setAnalysis(null);
    setViewport({ width: 1280, height: 720 });
    setSafeArea({ left: 0, right: 0, top: 0, bottom: 0 });
    setScaleMode("cover");
    setDeviceShell("desktop");
    setShowDeviceShell(true);
    setShowDesignBorder(false);
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
    setAreaCanvasZooms({});
    setAreaCanvasPans({});
    setAreaPreviewZooms({});
    setAreaPreviewPans({});
    selectionAnchorRef.current = null;
    setSelectedId(null);
    setSelectedIds([]);
    setWarnings([]);
    setDirty(false);
    setRenameCaretMode("all");
    setLayerNameMode("original");
    setExportMsg("已新建空白工程");
  }, [applyScene, dirty, resetHistory, workspaceIds]);

  const openSavedProject = useCallback(async () => {
    if (dirty && !window.confirm("当前工程有未保存修改，确定放弃并打开其他工程吗？")) return;
    try {
      const opened = await openProject();
      if (!opened) return;
      const restored = restoreSceneSnapshot(opened.project, opened.assets);
      const view = opened.project.view;
      const restoredAreaLayouts = readWorkspaceLayouts(opened.path, projectFileName(opened.path), workspaceIds);
      const restoredActiveArea = areaLeaves(restoredAreaLayouts.controls)[0] ?? { id: "area-controls-canvas", tool: "canvas" as AreaTool };
      resetHistory();
      applyScene(restored.scene);
      setProjectPath(opened.path);
      setProjectName(projectFileName(opened.path));
      setAreaLayouts(restoredAreaLayouts);
      setActiveAreaId(restoredActiveArea.id);
      setWorkspace("controls");
      setAnalysis(opened.analysis);
      setLayerNameMode(prefersEngineeringNames(opened.analysis) ? "ai" : "original");
      setViewport(view?.viewport ?? { width: restored.scene.designWidth, height: restored.scene.designHeight });
      setSafeArea(view?.safeArea ?? { left: 0, right: 0, top: 0, bottom: 0 });
      setScaleMode(view?.scaleMode ?? "cover");
      setDeviceShell("desktop");
      setShowDeviceShell(true);
      setAreaCanvasZooms({});
      setAreaCanvasPans({});
      setAreaPreviewZooms({});
      setAreaPreviewPans({});
      setShowSafeArea(view?.showSafeArea ?? false);
      setShowDesignBorder(false);
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
  }, [applyScene, dirty, resetHistory, workspaceIds]);

  const saveCurrentProject = useCallback(async (saveAs = false) => {
    const current = sceneRef.current;
    if (!current) return;
    try {
      const prepared = prepareSceneAssets(current);
      const view: SavedProjectView = { viewport, safeArea, scaleMode, showSafeArea };
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
  }, [analysis, applyScene, projectName, projectPath, safeArea, scaleMode, showSafeArea, viewport]);

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
      setShowDeviceShell(true);
      // 导入完成后直接进入层级工作区；效果检查统一从“预览”页签进入。
      setShowDesignBorder(false);
      setPreviewZoom(1);
      setPreviewPan({ x: 0, y: 0 });
      setAreaCanvasZooms({});
      setAreaCanvasPans({});
      setAreaPreviewZooms({});
      setAreaPreviewPans({});
      setProjectPath(null);
      setProjectName(`${name.replace(/\.(psd|psb)$/i, "")}.ui.json`);
      setAreaLayouts(createDefaultWorkspaceLayouts(workspaceIds));
      setActiveAreaId("area-controls-canvas");
      setWorkspace("controls");
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
  }, [applyScene, dirty, resetHistory, workspaceIds]);

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

  const requestAiNamingConfirmation = useCallback(() => {
    if (!sceneRef.current || importAbortRef.current) return;
    setAiNamingConfirm(true);
  }, []);

  const confirmAiNaming = useCallback(() => {
    setAiNamingConfirm(false);
    void rerunAiNaming();
  }, [rerunAiNaming]);

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

  /** Ctrl+W：独立软件内关闭当前工程。 */
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
    setWorkspace("controls");
    setAreaLayouts(createDefaultWorkspaceLayouts(workspaceIds));
    setActiveAreaId("area-controls-canvas");
    setAreaCanvasZooms({});
    setAreaCanvasPans({});
    setAreaPreviewZooms({});
    setAreaPreviewPans({});
    setShowDeviceShell(true);
    setShowDesignBorder(false);
    setSelectedId(null);
    selectionAnchorRef.current = null;
    setSelectedIds([]);
    setWarnings([]);
    setTypeMenu(null);
    setQuickActionMenu(null);
    historyRef.current = [];
    futureRef.current = [];
    setHistLen(0);
    setFutureLen(0);
    setExportMsg("已关闭当前工程");
  }, [dirty, workspaceIds]);

  const exportHtml = useCallback(async () => {
    if (!scene) return;
    const loadedFonts = await loadUsedHtmlFonts(scene);
    const missingFonts = loadedFonts.unavailable.length
      ? `；未内嵌字体：${loadedFonts.unavailable.join("、")}（将使用浏览器回退字体）`
      : "";
    const html = buildExportHtml(scene, scaleMode, safeArea, loadedFonts.assets);
    const base = projectName.replace(/\.ui\.json$/i, "");
    try {
      const r = await fetch("/save-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: base, html }),
      });
      if (!r.ok) throw 0;
      setExportMsg(`已导出 export/${base}.html ✓${missingFonts}`);
      return;
    } catch {
      // dev server 不可用（file:// 打开）时回退浏览器下载
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.html`;
      a.click();
      setExportMsg(`已下载（未通过 start.bat 启动，无法写入 export 文件夹）${missingFonts}`);
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
    const generatedNames = namingMode === "quick" && type && !isFixedRootNode(current, source, sourcePath)
      ? typeConversionNames(source, type, siblings)
      : null;

    const supported = new Set(resourceSlotDefinitions(type ?? undefined).map((slot) => slot.key));
    const stale = Object.entries(source.resources ?? {})
      .filter(([slot, binding]) => Boolean(binding) && !supported.has(slot as ResourceSlot)) as [ResourceSlot, ImageBinding][];
    let nextNodes = mapNodes(current.nodes, id, (node) => {
      const converted = markControlType(node, type);
      Object.assign(node, converted);
      if (generatedNames) {
        node.originalName = generatedNames.originalName;
        node.name = generatedNames.projectName;
      }
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
    else if (generatedNames && generatedNames.projectName !== source.name) setExportMsg(`已完成控件类型转换：${generatedNames.projectName}`);
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

  const skipNineSlice = useCallback((candidate: NineSliceCandidate) => {
    mutateScene((s) => {
      const nextCandidate = { ...candidate, memberNodeIds: [...candidate.memberNodeIds], status: "skipped" as const };
      const previous = s.nineSliceCandidates ?? [];
      const found = previous.some((item) => item.id === candidate.id);
      return {
        ...s,
        nineSliceCandidates: found
          ? previous.map((item) => item.id === candidate.id ? nextCandidate : item)
          : [...previous, nextCandidate],
      };
    });
    setExportMsg(`已跳过 ${candidate.memberNodeIds.length} 张图片的九宫格处理`);
  }, [mutateScene]);

  const toggleNineSlicePreview = useCallback(() => {
    mutateScene((s) => ({ ...s, useNineSlicePreview: !s.useNineSlicePreview }));
  }, [mutateScene]);

  const resetPreviewViewport = useCallback(() => {
    const view = defaultPreviewView();
    setPreviewZoom(view.zoom);
    setPreviewPan(view.pan);
    setAreaPreviewZooms({});
    setAreaPreviewPans({});
  }, []);

  const togglePreviewLayout = useCallback(() => {
    resetPreviewViewport();
    setPreviewLayoutMode((current) => current === "pure" ? "edit" : "pure");
  }, [resetPreviewViewport]);

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

  /** 切换指定区域的工具；工程数据、节点选中状态和顶部工作区仍然共享。 */
  const changeAreaTool = useCallback((areaId: string, nextTool: AreaTool) => {
    const previousTool = findArea(areaLayoutRef.current, areaId)?.tool ?? "canvas";
    if (previousTool === nextTool) {
      activateArea(areaId);
      return;
    }
    if (nextTool === "preview") {
      // 预览工具是只读检查区；共享选择状态不清空，切回编辑工具仍能继续工作。
      setRenamingId(null);
      setTypeMenu(null);
      setQuickActionMenu(null);
      setPreviewZoom(1);
      setPreviewPan({ x: 0, y: 0 });
      setAreaPreviewZooms((current) => ({ ...current, [areaId]: 1 }));
      setAreaPreviewPans((current) => ({ ...current, [areaId]: { x: 0, y: 0 } }));
    }
    setAreaLayout((current) => updateAreaTool(current, areaId, nextTool));
    setActiveAreaId(areaId);
  }, [activateArea, setAreaLayout]);

  /** 顶部工作区入口切换流程，并显示该流程自己保存的区域组合。 */
  const changeWorkspace = useCallback((nextWorkspace: Workspace) => {
    if (nextWorkspace === workspace) return;
    const nextLayout = areaLayouts[nextWorkspace] ?? createDefaultAreaLayout("canvas");
    setWorkspace(nextWorkspace);
    setActiveAreaId(areaLeaves(nextLayout)[0]?.id ?? "area-1");
  }, [areaLayouts, workspace]);

  const addWorkspace = useCallback(() => {
    let index = workspaceOptions.filter((item) => !item.builtIn).length + 1;
    let id = `custom-${index}`;
    while (workspaceOptions.some((item) => item.value === id)) {
      index += 1;
      id = `custom-${index}`;
    }
    const label = `工作区 ${index}`;
    setWorkspaceOptions((current) => [...current, { value: id, label, builtIn: false }]);
    setAreaLayouts((current) => ({ ...current, [id]: createDefaultAreaLayout("canvas") }));
    setWorkspace(id);
    setActiveAreaId(`area-${id}-canvas`);
    setExportMsg(`已新建${label}`);
  }, [workspaceOptions]);

  const renameWorkspace = useCallback((workspaceId: Workspace, label: string) => {
    const nextLabel = label.trim().slice(0, 32);
    if (!nextLabel) return;
    setWorkspaceOptions((current) => current.map((item) => item.value === workspaceId ? { ...item, label: nextLabel } : item));
    setExportMsg(`已将工作区重命名为「${nextLabel}」`);
  }, []);

  const splitEditorArea = useCallback((areaId: string, axis: AreaSplitAxis, ratio: number) => {
    setAreaLayout((current) => splitArea(current, areaId, axis, ratio));
    setExportMsg("已创建新的工具区域，可在区域工具栏中独立切换工具");
  }, [setAreaLayout]);

  const resizeEditorArea = useCallback((splitId: string, ratio: number) => {
    setAreaLayout((current) => resizeAreaSplit(current, splitId, ratio));
  }, [setAreaLayout]);

  const joinEditorArea = useCallback((areaId: string, keep: "current" | "sibling") => {
    const next = joinArea(areaLayoutRef.current, areaId, keep);
    const nextActive = findArea(next, areaId) ?? areaLeaves(next)[0] ?? null;
    setAreaLayout(next);
    if (nextActive) {
      setActiveAreaId(nextActive.id);
    }
    setExportMsg("已合并工具区域");
  }, [setAreaLayout]);

  const joinEditorAreas = useCallback((removeId: string, keepId: string) => {
    const next = joinAreaPair(areaLayoutRef.current, removeId, keepId);
    const nextActive = findArea(next, keepId) ?? areaLeaves(next)[0] ?? null;
    setAreaLayout(next);
    if (nextActive) setActiveAreaId(nextActive.id);
    setExportMsg("已合并工具区域");
  }, [setAreaLayout]);

  const swapEditorAreas = useCallback((splitId: string) => {
    setAreaLayout((current) => swapAreaSplit(current, splitId));
    setExportMsg("已交换工具区域");
  }, [setAreaLayout]);

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
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA"
        || element.tagName === "SELECT" || element.isContentEditable));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditableTarget(event.target)) return;
      event.preventDefault();
      if (spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    const onBlur = () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
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
      if (importProgress) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "w" || e.key === "W")) {
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
        else if (e.key === "0" && activeAreaTool === "canvas") {
          e.preventDefault();
          canvasPanRef.current = { x: 0, y: 0 };
          canvasPanDragRef.current = null;
          setCanvasPanning(false);
          setCanvasPan({ x: 0, y: 0 });
          setCanvasZoom(1);
          setAreaCanvasPans((current) => ({ ...current, [activeAreaId]: { x: 0, y: 0 } }));
          setAreaCanvasZooms((current) => ({ ...current, [activeAreaId]: 1 }));
        }
        else if (e.key === "0" && activeAreaTool === "preview") {
          e.preventDefault();
          setPreviewPan({ x: 0, y: 0 });
          setPreviewZoom(1);
          setAreaPreviewPans((current) => ({ ...current, [activeAreaId]: { x: 0, y: 0 } }));
          setAreaPreviewZooms((current) => ({ ...current, [activeAreaId]: 1 }));
        }
        else if (e.key === "o" || e.key === "O") { e.preventDefault(); void openSavedProject(); }
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
  }, [importProgress, undo, redo, selectedId, selectedIds, typeMenu, quickActionMenu, updateSelected, saveCurrentProject, openSavedProject, bindResources, groupSelected, ungroupSelected, moveSelectedLayer, beginRenameSelected, closeProject, activeAreaTool]);

  // 命中检测 + 拖动；普通拖动只改 offset，四角拖动用于调整控件尺寸。
  const toLogical = (clientX: number, clientY: number, areaId = activeAreaId, mode: "editor" | "preview" = "editor") => {
    const ui = areaRefs(areaId).ui ?? uiRef.current;
    const interactionCtx = mode === "preview" ? previewLayoutCtx : editorLayoutCtx;
    if (!ui || !interactionCtx) return { x: Number.NaN, y: Number.NaN };
    const r = ui.getBoundingClientRect();
    const k = interactionCtx.viewportWidth / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };

  const onPointerDown = (e: React.PointerEvent, areaId = activeAreaId, mode: "editor" | "preview" = "editor") => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    if (mode === "editor" && spaceHeldRef.current && e.button === 0) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const currentPan = canvasPanFor(areaId);
      canvasPanDragRef.current = { areaId, x: e.clientX, y: e.clientY, panX: currentPan.x, panY: currentPan.y };
      setCanvasPanning(true);
      return;
    }
    const interactionResult = mode === "preview" ? previewResult : editorResult;
    const interactionCtx = mode === "preview" ? previewLayoutCtx : editorLayoutCtx;
    if (!interactionResult || !interactionCtx) return;
    // 事件绑定在整个中间编辑区，而不是只有画布本体：画布居中、缩放或平移后，
    // 画布外的空白也应视为“背景点击”，用于取消选择。下面的命中检测会把
    // 画布外坐标自然判定为未命中；这里只清空选中状态，不动工程和画布视图。
    const p = toLogical(e.clientX, e.clientY, areaId, mode);
    const selected = selectedId ? interactionResult.nodes.find((item) => item.node.id === selectedId) : null;
    const selectedNode = selectedId ? walkNodes(sceneRef.current?.nodes ?? []).find((node) => node.id === selectedId) : null;
    const handleTolerance = Math.max(8, 12 / Math.max(interactionResult.scaleX, interactionResult.scaleY));
    const corner = selected && selectedNode && !selectedNode.locked ? resizeCornerAt(p, selected.rect, handleTolerance) : null;
    if (corner && selected && selectedNode) {
      const parent = findParentNode(sceneRef.current?.nodes ?? [], selectedNode.id);
      pushHistory(sceneRef.current!);
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = {
        areaId,
        mode,
        id: selectedNode.id,
        corner,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWidth: selectedNode.designRect.width,
        startHeight: selectedNode.designRect.height,
        startOffsetX: selectedNode.anchor.offsetX,
        startOffsetY: selectedNode.anchor.offsetY,
        parentWidth: parent?.designRect.width ?? sceneRef.current!.designWidth,
        parentHeight: parent?.designRect.height ?? sceneRef.current!.designHeight,
        widthMode: selectedNode.layout?.width?.mode ?? "absolute",
        heightMode: selectedNode.layout?.height?.mode ?? "absolute",
      };
      (e.currentTarget as HTMLElement).style.cursor = RESIZE_CURSORS[corner];
      return;
    }
    const hit = findCanvasHit(interactionResult.nodes, p);
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
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { areaId, mode, id: hit.node.id, startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent, areaId = activeAreaId) => {
    const panDrag = canvasPanDragRef.current;
    if (panDrag) {
      const nextPan = { x: panDrag.panX + e.clientX - panDrag.x, y: panDrag.panY + e.clientY - panDrag.y };
      canvasPanRef.current = nextPan;
      setCanvasPan(nextPan);
      setAreaCanvasPans((current) => ({ ...current, [panDrag.areaId]: nextPan }));
      (e.currentTarget as HTMLElement).style.cursor = "grabbing";
      return;
    }
    const resize = resizeRef.current;
    const resizeResult = resize?.mode === "preview" ? previewResult : editorResult;
    const resizeCtx = resize?.mode === "preview" ? previewLayoutCtx : editorLayoutCtx;
    if (resize && resizeCtx && resizeResult) {
      const canvas = areaRefs(resize.areaId).ui ?? uiRef.current;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
       const unitX = resizeCtx.viewportWidth / canvasRect.width / (resizeResult.scaleX || 1);
       const unitY = resizeCtx.viewportHeight / canvasRect.height / (resizeResult.scaleY || 1);
      const dx = (e.clientX - resize.startClientX) * unitX;
      const dy = (e.clientY - resize.startClientY) * unitY;
      const left = resize.corner === "nw" || resize.corner === "sw";
      const top = resize.corner === "nw" || resize.corner === "ne";
      const nextWidth = Math.max(1, resize.startWidth + (left ? -dx : dx));
      const nextHeight = Math.max(1, resize.startHeight + (top ? -dy : dy));
      const nextOffsetX = resize.startOffsetX + (left ? dx : 0);
      const nextOffsetY = resize.startOffsetY + (top ? dy : 0);
      updateNode(resize.id, (node) => {
        node.designRect.width = nextWidth;
        node.designRect.height = nextHeight;
        node.anchor.offsetX = nextOffsetX;
        node.anchor.offsetY = nextOffsetY;
        node.layout = {
          ...(node.layout ?? {
            x: normalizeLayoutValue("absolute", nextOffsetX, resize.parentWidth),
            y: normalizeLayoutValue("absolute", nextOffsetY, resize.parentHeight),
            width: normalizeLayoutValue(resize.widthMode, resize.startWidth, resize.parentWidth),
            height: normalizeLayoutValue(resize.heightMode, resize.startHeight, resize.parentHeight),
          }),
          width: normalizeLayoutValue(resize.widthMode, nextWidth, resize.parentWidth),
          height: normalizeLayoutValue(resize.heightMode, nextHeight, resize.parentHeight),
        };
        if (node.list && node.list.sizeConfirmed === false) node.list = { ...node.list, sizeConfirmed: true };
      }, false);
      (e.currentTarget as HTMLElement).style.cursor = RESIZE_CURSORS[resize.corner];
      return;
    }
    const d = dragRef.current;
    const dragResult = d?.mode === "preview" ? previewResult : editorResult;
    const dragCtx = d?.mode === "preview" ? previewLayoutCtx : editorLayoutCtx;
    if (!d || !dragCtx || !dragResult) {
      const hoverArea = findArea(areaLayoutRef.current, areaId);
      const hoverMode = hoverArea?.tool === "preview" ? "preview" : "editor";
      const hoverResult = hoverMode === "preview" ? previewResult : editorResult;
      const selected = selectedId ? hoverResult?.nodes.find((item) => item.node.id === selectedId) : null;
      const tolerance = hoverResult ? Math.max(8, 12 / Math.max(hoverResult.scaleX, hoverResult.scaleY)) : 8;
      const corner = selected ? resizeCornerAt(toLogical(e.clientX, e.clientY, areaId, hoverMode), selected.rect, tolerance) : null;
      (e.currentTarget as HTMLElement).style.cursor = corner ? RESIZE_CURSORS[corner] : "";
      return;
    }
    const dragCanvas = areaRefs(d.areaId).ui ?? uiRef.current;
    if (!dragCanvas) return;
    const dragRect = dragCanvas.getBoundingClientRect();
    const start = { x: (d.startX - dragRect.left) * (dragCtx.viewportWidth / dragRect.width), y: (d.startY - dragRect.top) * (dragCtx.viewportHeight / dragRect.height) };
    const p = toLogical(e.clientX, e.clientY, d.areaId, d.mode);
    const dx = p.x - start.x, dy = p.y - start.y;
    updateNode(d.id, (n) => {
      if (n.adaptation.mode !== "anchor") n.adaptation.mode = "anchor"; // 拖动 → 锚点模式
       n.anchor.offsetX += dx / dragResult.scaleX;   // 预览位移 → 设计 offset（÷scale 等比）
       n.anchor.offsetY += dy / dragResult.scaleY;
    }, false); // 拖动中不记录（按下时已记录一次）
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY };
  };
  const onPointerUp = (e?: React.PointerEvent) => {
    const target = e?.currentTarget as HTMLElement | undefined;
    if (e && target?.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    resizeRef.current = null;
    canvasPanDragRef.current = null;
    setCanvasPanning(false);
    if (e) (e.currentTarget as HTMLElement).style.cursor = "";
  };
  const onCanvasWheel = (e: React.WheelEvent<HTMLDivElement>, areaId = activeAreaId) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const canvas = areaRefs(areaId).ui ?? uiRef.current;
    if (!canvas) return;
    const currentZoom = canvasZoomFor(areaId);
    const nextZoom = clampCanvasZoom(currentZoom * (e.deltaY < 0 ? 1.1 : 0.9));
    if (nextZoom === currentZoom) return;
    const rect = canvas.getBoundingClientRect();
    const currentPan = canvasPanFor(areaId);
    const transformedCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const center = { x: transformedCenter.x - currentPan.x, y: transformedCenter.y - currentPan.y };
    const nextPan = panForZoomAtPoint(currentPan, currentZoom, nextZoom,
      { x: e.clientX, y: e.clientY }, center);
    canvasPanRef.current = nextPan;
    setCanvasPan(nextPan);
    setCanvasZoom(nextZoom);
    setAreaCanvasPans((current) => ({ ...current, [areaId]: nextPan }));
    setAreaCanvasZooms((current) => ({ ...current, [areaId]: nextZoom }));
  };
  const adjustCanvasZoom = (direction: 1 | -1, areaId = activeAreaId) => {
    setAreaCanvasZooms((current) => {
      const nextZoom = clampCanvasZoom((current[areaId] ?? 1) * (direction > 0 ? 1.1 : 0.9));
      if (areaId === activeAreaId) setCanvasZoom(nextZoom);
      return { ...current, [areaId]: nextZoom };
    });
  };
  const adjustPreviewZoom = (direction: 1 | -1, areaId = activeAreaId) => {
    setAreaPreviewZooms((current) => {
      const nextZoom = Math.max(0.4, Math.min(3, (current[areaId] ?? 1) * (direction > 0 ? 1.1 : 0.9)));
      if (areaId === activeAreaId) setPreviewZoom(nextZoom);
      return { ...current, [areaId]: nextZoom };
    });
  };
  const onPreviewWheel = (e: React.WheelEvent, areaId = activeAreaId) => {
    e.preventDefault();
    adjustPreviewZoom(e.deltaY < 0 ? 1 : -1, areaId);
  };
  const onPreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>, areaId = activeAreaId) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const currentPan = previewPanFor(areaId);
    previewDragRef.current = { areaId, x: e.clientX, y: e.clientY, panX: currentPan.x, panY: currentPan.y };
  };
  const onPreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag) return;
    const nextPan = { x: drag.panX + e.clientX - drag.x, y: drag.panY + e.clientY - drag.y };
    setPreviewPan(nextPan);
    setAreaPreviewPans((current) => ({ ...current, [drag.areaId]: nextPan }));
  };
  const onPreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    previewDragRef.current = null;
  };
  const onPreviewEditPointerDown = (e: React.PointerEvent<HTMLDivElement>, areaId: string) => {
    if (spaceHeldRef.current && e.button === 0) onPreviewPointerDown(e, areaId);
    else onPointerDown(e, areaId, "preview");
  };
  const onPreviewEditPointerMove = (e: React.PointerEvent<HTMLDivElement>, areaId: string) => {
    if (previewDragRef.current) onPreviewPointerMove(e);
    else onPointerMove(e, areaId);
  };
  const onPreviewEditPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (previewDragRef.current) onPreviewPointerUp(e);
    else onPointerUp(e);
  };
  const pieNode = typeMenu && selectedId
    ? walkNodes(scene?.nodes ?? []).find((node) => node.id === selectedId) ?? null
    : null;
  const canvasStack = (areaId: string, tool: AreaTool) => scene && (tool === "canvas" || tool === "preview") ? (
    <div className={`canvas-stack${tool === "canvas" ? " editor-canvas-stack" : ""}${spaceHeld && tool === "canvas" ? " space-ready" : ""}${canvasPanning && tool === "canvas" ? " is-panning" : ""}`}
      style={tool === "canvas" ? { transform: `translate(${canvasPanFor(areaId).x}px, ${canvasPanFor(areaId).y}px) scale(${canvasZoomFor(areaId)})` } : undefined}>
      <canvas ref={(value) => setAreaCanvasRef(areaId, "ui", value)} />
      <canvas ref={(value) => setAreaCanvasRef(areaId, "ov", value)} style={{ pointerEvents: "none" }} />
    </div>
  ) : null;
  const previewCanvas = (areaId: string) => scene ? (
    <PreviewDeviceFrame deviceShell={deviceShell} showDeviceShell={showDeviceShell}
      portrait={scene.designHeight > scene.designWidth}>
      {canvasStack(areaId, "preview")}
    </PreviewDeviceFrame>
  ) : null;

  const renderInspector = (areaResult: typeof editorResult, areaCtx: LayoutContext | null) => <Inspector
    node={walkNodes(scene?.nodes ?? []).find((n) => n.id === selectedId) ?? null}
    rect={areaResult?.nodes.find((n) => n.node.id === selectedId)?.rect ?? null}
    parentDesignSize={(() => {
      const selected = selectedId ? findNodeIncludingResources(scene?.nodes ?? [], selectedId) : null;
      const parent = selected ? findParentNode(scene?.nodes ?? [], selected.id) : null;
      return { width: parent?.designRect.width ?? scene?.designWidth ?? 1280, height: parent?.designRect.height ?? scene?.designHeight ?? 720 };
    })()}
    onUpdate={updateSelected} onSetCtrl={setCtrl}
    onReanchor={(a) => updateSelected((n) => {
      const r = areaResult?.nodes.find((x) => x.node.id === n.id)?.rect;
      if (r && areaCtx) reanchor(n, scene!.designWidth, scene!.designHeight, r, areaCtx, areaResult!, a);
    })}
    templates={scene?.interactionTemplates ?? []} onTemplates={setTemplates} onUnbindResource={unbindResource} />;

  const renderArea = (area: AreaLeaf) => {
    const tool = area.tool;
    const areaCtx = tool === "preview" ? previewLayoutCtx : editorLayoutCtx;
    const areaResult = tool === "preview" ? previewResult : editorResult;
    const exportAreaTarget = areaExportTargets[area.id] ?? exportTarget;
    const setExportAreaTarget = (target: ExportTarget) => {
      setAreaExportTargets((current) => ({ ...current, [area.id]: target }));
      if (area.id === activeAreaId) setExportTarget(target);
    };
    const exportDetails = exportAreaTarget === "engine" ? (
          <section className="export-panel">
            <div className="export-panel-card">
              <span className="export-kicker">FINAL OUTPUT</span>
              <h2>导出自研引擎 JSON</h2>
              <p>当前工程会转换为 <code>Dialog → Window</code> 结构。位置、尺寸使用当前视觉结果，图片统一进入引擎可识别的 imageset，字体统一映射为引擎预设。</p>
              <div className={`export-check ${engineExport?.errors.length ? "has-errors" : "ready"}`}>
                <strong>{engineExport?.errors.length ? "暂不能导出" : "可以导出"}</strong>
                <span>{engineExport?.errors.length ? `发现 ${engineExport.errors.length} 个错误` : "基础字段校验通过"}</span>
              </div>
              {engineExport?.errors.length ? <div className="export-diagnostics error">{engineExport.errors.map((item) => <div key={item}><Icon name="close" size={13} /> {item}</div>)}</div> : null}
              {engineExport?.warnings.length ? <div className="export-diagnostics">{engineExport.warnings.map((item) => <div key={item}><Icon name="alert" size={13} /> {item}</div>)}</div> : null}
              <div className="engine-export-path">
                <label htmlFor={`engine-output-path-${area.id}`}>引擎测试包输出目录</label>
                <input id={`engine-output-path-${area.id}`} type="text" value={engineOutputPath}
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
        ) : (
          <section className="export-panel export-target-placeholder">
            <div className="export-target-placeholder-card">
              <span className="export-kicker">TARGET ADAPTER</span>
              <h2>{exportAreaTarget === "figma" ? "Figma" : exportAreaTarget === "godot" ? "Godot" : "Unity"}</h2>
              <p>这个目标格式的转换器尚未接入。当前工程数据已经与 PSD 解耦，后续可以在这里增加对应的导出规则。</p>
              <span className="export-target-placeholder-badge">计划支持 · 暂不导出</span>
            </div>
          </section>
        );
    let toolContent: React.ReactNode;
    if (tool === "layers") {
      toolContent = <ControlsPanel nodes={scene?.nodes ?? []} selectedIds={selectedIds} onSelect={selectNode} focusNodeId={focusNodeId}
        nameMode={layerNameMode} warningIds={warningIds} renamingId={renamingId} renameCaretMode={renameCaretMode}
        onRename={commitRename} onCancelRename={() => setRenamingId(null)}
        onToggleVisible={(id) => updateNode(id, (n) => { n.visible = !n.visible; })}
        onToggleLock={(id) => updateNode(id, (n) => { n.locked = !n.locked; })} />;
    } else if (tool === "canvas") {
      toolContent = <section className="editor-workspace">
        <div className={`canvas-wrap editor-canvas-viewport${spaceHeld ? " space-ready" : ""}${canvasPanning ? " is-panning" : ""}`} ref={(value) => setAreaCanvasRef(area.id, "wrap", value)}
          onPointerDown={(event) => onPointerDown(event, area.id)} onPointerMove={(event) => onPointerMove(event, area.id)} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={(event) => onCanvasWheel(event, area.id)}
          onDoubleClick={() => { if (!scene && !importProgress) void openSavedProject(); }}>
          {canvasStack(area.id, "canvas")}
        </div>
      </section>;
    } else if (tool === "properties") {
      toolContent = <aside className="right-panel area-tool-panel">
        {renderInspector(areaResult, areaCtx)}
      </aside>;
    } else if (tool === "overview") {
      const overviewProps = {
        result: areaResult,
        nodes: scene?.nodes ?? [],
        viewport: { width: areaCtx?.viewportWidth ?? viewport.width, height: areaCtx?.viewportHeight ?? viewport.height },
      };
      toolContent = workspace === "slice"
        ? <NineSliceOverviewTool {...overviewProps} />
        : <SceneOverview {...overviewProps} selectedId={selectedId} onLocate={locateNode} useNineSlice={scene?.useNineSlicePreview} />;
    } else if (tool === "bindings") {
      toolContent = <ResourceBindingWorkspace nodes={scene?.nodes ?? []} layout={areaResult}
        viewport={{ width: areaCtx?.viewportWidth ?? viewport.width, height: areaCtx?.viewportHeight ?? viewport.height }}
        selectedIds={selectedIds}
        onSelectImage={(id, event) => selectNode(id, createSelectionIntent(event, flattenLayerIds(scene?.nodes ?? [])))}
        onLocate={locateNode} onBind={bindResources} onUnbind={unbindResource} onResetComplete={resetBindingComplete} />;
    } else if (tool === "slice") {
      toolContent = <NineSliceWorkspace scene={scene ?? { designWidth: 1280, designHeight: 720, nodes: [] }} layout={areaResult}
        viewport={{ width: areaCtx?.viewportWidth ?? viewport.width, height: areaCtx?.viewportHeight ?? viewport.height }}
        onScan={scanNineSlice} onConfirm={confirmNineSlice} onSkip={skipNineSlice} />;
    } else if (tool === "slice-candidates") {
      toolContent = <NineSliceCandidatesTool />;
    } else if (tool === "slice-marker") {
      toolContent = <NineSliceMarkerTool />;
    } else if (tool === "preview") {
      const previewCanvasArea = <div className="preview-canvas-wrap preview-workspace-canvas" ref={(value) => setAreaCanvasRef(area.id, "previewWrap", value)} onWheel={(event) => onPreviewWheel(event, area.id)}
        onPointerDown={(event) => previewLayoutMode === "edit" ? onPreviewEditPointerDown(event, area.id) : onPreviewPointerDown(event, area.id)}
        onPointerMove={(event) => previewLayoutMode === "edit" ? onPreviewEditPointerMove(event, area.id) : onPreviewPointerMove(event)}
        onPointerUp={(event) => previewLayoutMode === "edit" ? onPreviewEditPointerUp(event) : onPreviewPointerUp(event)}
        onPointerCancel={(event) => previewLayoutMode === "edit" ? onPreviewEditPointerUp(event) : onPreviewPointerUp(event)}>
        <div className="preview-canvas-transform" style={{ transform: `translate(${previewPanFor(area.id).x}px, ${previewPanFor(area.id).y}px) scale(${previewZoomFor(area.id)})` }}>
          {previewCanvas(area.id)}
        </div>
      </div>;
      const previewFoot = <footer className="preview-workspace-foot">
        <span>预览视口：{areaCtx?.viewportWidth ?? viewport.width} × {areaCtx?.viewportHeight ?? viewport.height}</span>
        <span className="preview-zoom-value">{Math.round(previewZoomFor(area.id) * 100)}%</span>
        <button className="btn" onClick={() => adjustPreviewZoom(-1, area.id)} aria-label="缩小预览"><Icon name="minus" size={14} /></button>
        <button className="btn" onClick={() => { setAreaPreviewZooms((current) => ({ ...current, [area.id]: 1 })); setAreaPreviewPans((current) => ({ ...current, [area.id]: { x: 0, y: 0 } })); }}>居中</button>
        <button className="btn" onClick={() => adjustPreviewZoom(1, area.id)} aria-label="放大预览"><Icon name="plus" size={14} /></button>
      </footer>;
      toolContent = <section className={`preview-workspace${previewLayoutMode === "edit" ? " preview-workspace-edit" : ""}`}>
        {previewLayoutMode === "edit" ? <div className="preview-edit-layout">
          <div className="preview-edit-layers">
            <ControlsPanel nodes={scene?.nodes ?? []} selectedIds={selectedIds} onSelect={selectNode} focusNodeId={focusNodeId}
              nameMode={layerNameMode} warningIds={warningIds} renamingId={renamingId} renameCaretMode={renameCaretMode}
              onRename={commitRename} onCancelRename={() => setRenamingId(null)}
              onToggleVisible={(id) => updateNode(id, (n) => { n.visible = !n.visible; })}
              onToggleLock={(id) => updateNode(id, (n) => { n.locked = !n.locked; })} />
          </div>
          <div className="preview-edit-center">{previewCanvasArea}{previewFoot}</div>
          <aside className="right-panel preview-edit-properties">{renderInspector(previewResult, previewLayoutCtx)}</aside>
        </div> : <>{previewCanvasArea}{previewFoot}</>}
      </section>;
    } else if (tool === "export-targets") {
      toolContent = <section className="export-combined-workspace">
        <ExportTargetPanel target={exportAreaTarget} onTarget={setExportAreaTarget} />
        {exportDetails}
      </section>;
    }

    let toolbarActions: React.ReactNode = null;
    if (tool === "layers") {
      toolbarActions = <>
        <button className="btn tool-button icon-tool-button" disabled={!scene} onClick={() => { setLayerNameMode((current) => current === "original" ? "ai" : "original"); if (layerNameMode === "original") setRenamingId(null); }}
          aria-label={layerNameMode === "original" ? "切换到工程名称" : "切换到 PSD 原名"}
          title={layerNameMode === "original" ? "切换到工程名称" : "切换到 PSD 原名"}>
          <span className="toolbar-action-icon"><ToolbarActionIcon kind="project-name" /></span>
        </button>
        <button className="btn tool-button icon-tool-button" disabled={!scene || !!importProgress} onClick={requestAiNamingConfirmation} aria-label="AI 命名" title="调用 AI 为节点和图片资源统一命名">
          <span className="toolbar-action-icon"><ToolbarActionIcon kind="ai-name" /></span>
        </button>
        <button className="btn tool-button icon-tool-button" disabled={!scene} onClick={() => {
          if (!selectedId || selectedIds.length !== 1) { setExportMsg("请先选中一个节点，再进行类型转换"); return; }
          setTypeMenu(pointerRef.current);
        }} aria-label="类型转换" title="打开控件类型选择菜单（T）">
          <span className="toolbar-action-icon"><ToolbarActionIcon kind="type-convert" /></span>
        </button>
        <FontPickerControl hasScene={!!scene} onFont={applyGlobalFont} />
      </>;
    } else if (tool === "canvas" && scene) {
      toolbarActions = <CanvasZoomControl zoom={canvasZoomFor(area.id)} onAdjust={(direction) => adjustCanvasZoom(direction, area.id)} />;
    } else if (tool === "preview") {
      toolbarActions = <PreviewToolActions
        hasScene={!!scene} viewport={activeViewport} onViewport={setPreviewViewport}
        safeArea={safeArea} onSafeArea={setSafeArea} scaleMode={scaleMode} onScaleMode={setScaleMode}
        showSafeArea={showSafeArea} designWidth={scene?.designWidth ?? 1280} designHeight={scene?.designHeight ?? 720}
        deviceShell={deviceShell} onDeviceShell={setDeviceShell} showDeviceShell={showDeviceShell}
        onToggleDeviceShell={() => setShowDeviceShell((value) => !value)}
        useNineSlicePreview={scene?.useNineSlicePreview ?? false} onToggleNineSlicePreview={toggleNineSlicePreview}
        previewLayoutMode={previewLayoutMode} onTogglePreviewLayout={togglePreviewLayout} />;
    }

    return <div className={`area-instance area-tool-${tool}`}>
      <WorkspaceAreaToolbar tool={tool} onTool={(next) => changeAreaTool(area.id, next)}>{toolbarActions}</WorkspaceAreaToolbar>
      <div className="area-inner-body">{toolContent}</div>
    </div>;
  };

  return (
    <div className={`app${reduceMotion ? " reduce-motion" : ""}`} style={{ "--ui-scale": uiScale } as CSSProperties} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { void handleDrop(event); }}>
      <Appbar
        projectName={projectName} dirty={dirty}
        onNew={createNewProject} onOpenProject={openSavedProject}
        onImportPsd={loadPsd} onImportImages={importImages}
        hasScene={!!scene} canUndo={histLen > 0} canRedo={futureLen > 0} onUndo={undo} onRedo={redo}
        onSave={() => { void saveCurrentProject(); }} onSaveAs={() => { void saveCurrentProject(true); }}
        onExportHtml={exportHtml} onExportEngineJson={exportEngineJson} onGlobalFont={applyGlobalFont}
        nameMode={layerNameMode} onNameModeChange={(mode) => { setLayerNameMode(mode); if (mode === "original") setRenamingId(null); }}
        onAiRename={requestAiNamingConfirmation}
        onTypeConvert={() => {
          if (!selectedId || selectedIds.length !== 1) { setExportMsg("请先选中一个节点，再进行类型转换"); return; }
          setTypeMenu(pointerRef.current);
        }}
        useNineSlicePreview={scene?.useNineSlicePreview ?? false} onToggleNineSlicePreview={toggleNineSlicePreview}
        workspace={workspace} workspaces={workspaceOptions} onWorkspace={changeWorkspace}
        onAddWorkspace={addWorkspace} onRenameWorkspace={renameWorkspace} onCloseProject={closeProject}
        onRename={beginRenameSelected} onGroup={groupSelected} onUngroup={ungroupSelected}
        onMoveLayer={moveSelectedLayer} onShowShortcuts={() => setHelpDialog("shortcuts")}
        onShowAbout={() => setHelpDialog("about")}
        onShowSettings={() => setSettingsDialog(true)}
        showSafeArea={showSafeArea} onToggleSafeArea={() => setShowSafeArea((value) => !value)}
        showDesignBorder={showDesignBorder} onToggleDesignBorder={() => setShowDesignBorder((value) => !value)}
        preview={{
          viewport: activeViewport, onViewport: setPreviewViewport, safeArea, onSafeArea: setSafeArea,
          scaleMode, onScaleMode: setScaleMode, showSafeArea,
          designWidth: scene?.designWidth ?? 1280, designHeight: scene?.designHeight ?? 720,
          deviceShell, onDeviceShell: setDeviceShell,
          showDeviceShell, onToggleDeviceShell: () => setShowDeviceShell((value) => !value),
        }}
      />
      <div className="body area-layout-body">
        <NineSliceWorkspaceProvider scene={scene} layout={editorResult}
          viewport={{ width: editorLayoutCtx?.viewportWidth ?? viewport.width, height: editorLayoutCtx?.viewportHeight ?? viewport.height }}
          onScan={scanNineSlice} onConfirm={confirmNineSlice} onSkip={skipNineSlice}>
          <AreaLayout layout={areaLayout} activeAreaId={activeAreaId} onActivate={activateArea}
            onTool={changeAreaTool} onSplit={splitEditorArea} onResize={resizeEditorArea}
            onJoin={joinEditorArea} onJoinAreas={joinEditorAreas} onSwap={swapEditorAreas} renderArea={renderArea} uiScale={uiScale} />
        </NineSliceWorkspaceProvider>
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
          uiScale={uiScale}
          onChoose={(type) => { setCtrl(pieNode.id, type, "quick"); setTypeMenu(null); }}
          onClose={() => setTypeMenu(null)}
        />
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
            <header className="help-dialog-head"><div><span className="workspace-kicker">UI2HTML</span><h2>{helpDialog === "shortcuts" ? "快捷键说明" : "关于 UI2HTML"}</h2></div><button className="icon-btn" onClick={() => setHelpDialog(null)} aria-label="关闭"><Icon name="close" size={16} /></button></header>
            {helpDialog === "shortcuts" ? <div className="shortcut-grid">
              {["Ctrl+S|打开工程操作菜单", "Ctrl+O|打开工程", "Ctrl+W|关闭当前工程", "Ctrl+Z|撤销", "Ctrl+X|重做", "F2|重命名节点", "T|转换控件类型", "Ctrl+G|打组", "Alt+G|取消打组", "Ctrl+[ / Ctrl+]|调整层级", "Ctrl+B|绑定资源 / 确认完成", "Ctrl+0|恢复最佳窗口预览大小"].map((item) => { const [key, label] = item.split("|"); return <div className="shortcut-row" key={key}><kbd>{key}</kbd><span>{label}</span></div>; })}
            </div> : <div className="about-copy"><strong>UI2HTML</strong><p>面向 UI 美术的 PSD 导入、工程整理、视觉检查与自研引擎 JSON 转换工具。</p><small>工程与 PSD 解耦 · 资源可追溯 · 预览优先</small></div>}
            <footer className="help-dialog-foot"><button className="btn primary" onClick={() => setHelpDialog(null)}>知道了</button></footer>
          </section>
        </div>
      )}
      {aiNamingConfirm && (
        <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setAiNamingConfirm(false); }}>
          <section className="ai-naming-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-naming-confirm-title">
            <header className="ai-naming-confirm-head">
              <div><span className="workspace-kicker">AI 命名</span><h2 id="ai-naming-confirm-title">确认重新命名？</h2></div>
              <button className="icon-btn" type="button" onClick={() => setAiNamingConfirm(false)} aria-label="取消 AI 命名"><Icon name="close" size={16} /></button>
            </header>
            <div className="ai-naming-confirm-body">
              <p>AI 将统一更新当前工程中的节点名称和图片资源名称。</p>
              <p className="ai-naming-confirm-warning">这会覆盖现有的 AI 命名结果，以及本次明确允许覆盖的手动命名。</p>
              <small>确认后会进入分析等待状态，期间编辑器将暂时禁止操作。</small>
            </div>
            <footer className="ai-naming-confirm-foot">
              <button className="btn" type="button" onClick={() => setAiNamingConfirm(false)}>取消</button>
              <button className="btn primary" type="button" onClick={confirmAiNaming}>确认命名</button>
            </footer>
          </section>
        </div>
      )}
      {settingsDialog && <SettingsDialog uiScale={uiScale} onUiScale={(value) => setUiScale(normalizeUiScale(value))}
        onReset={() => setUiScale(UI_SCALE_DEFAULT)} reduceMotion={reduceMotion} onReduceMotion={setReduceMotion}
        showShortcutHints={showShortcutHints} onShowShortcutHints={setShowShortcutHints}
        onClose={() => setSettingsDialog(false)} />}
      <footer className="statusbar">
        {warnings.length > 0 && (
          <span className="warn" title={warnings.join("\n")}><Icon name="alert" size={14} /> {warnings.length} 个导入/分析提示</span>
        )}
        {showShortcutHints && <span className="status-shortcuts">
          {workspace === "controls" && <><span>Ctrl/⌘ 多选</span><span>Ctrl+G 打组</span><span>Alt+G 取消打组</span><span>F2 重命名</span><span>T 转换类型</span><span>Ctrl+[ / ] 调整层级</span><span>Ctrl+滚轮 缩放</span><span>Space+拖拽 平移</span></>}
          {workspace === "bindings" && <><span>Ctrl+B 图片绑定资源</span><span>再按一次 确认控件绑定完成</span></>}
          {workspace === "slice" && <><span>选择图片后拖动边界标记</span><span>确认后可在预览工作区切换对比</span></>}
          {workspace === "preview" && <><span>拖动平移</span><span>滚轮缩放</span><span>设备预设用于适配检查</span></>}
          {workspace === "export" && <span>导出前检查资源、布局和引擎字段</span>}
        </span>}
        <span className="grow" />
        {exportMsg && <span className="ok">{exportMsg}</span>}
        {!scene && <span className="hint">新建或打开工程，也可以直接导入 PSD / 图片</span>}
      </footer>
    </div>
  );
}
