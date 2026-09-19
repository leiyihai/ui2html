import type { Workspace } from "./components/WorkspaceTabs";

/**
 * 编辑器区域树。它只描述 UI2HTML 的编辑器布局，不属于 .ui.json 工程数据，
 * 也不会参与引擎 JSON 导出。
 */
export type AreaSplitAxis = "vertical" | "horizontal";

/** 某个区域实际显示的工具；顶部 Workspace 只代表工作流程。 */
export type AreaTool =
  | "layers"
  | "canvas"
  | "properties"
  | "overview"
  | "bindings"
  | "slice"
  | "slice-candidates"
  | "slice-marker"
  | "preview"
  | "export-targets";

export interface AreaLeaf {
  kind: "area";
  id: string;
  tool: AreaTool;
}

export interface AreaSplit {
  kind: "split";
  id: string;
  axis: AreaSplitAxis;
  /** first/second 的比例，限制在 0.2 ~ 0.8。 */
  ratio: number;
  first: AreaNode;
  second: AreaNode;
}

export type AreaNode = AreaLeaf | AreaSplit;

export const AREA_RATIO_MIN = 0.2;
export const AREA_RATIO_MAX = 0.8;

export function createDefaultAreaLayout(tool: AreaTool = "canvas"): AreaLeaf {
  return { kind: "area", id: "area-1", tool };
}

function leaf(id: string, tool: AreaTool): AreaLeaf {
  return { kind: "area", id, tool };
}

function split(id: string, axis: AreaSplitAxis, ratio: number, first: AreaNode, second: AreaNode): AreaSplit {
  return { kind: "split", id, axis, ratio: clampAreaRatio(ratio), first, second };
}

/** 各顶部工作区的默认工具组合；用户调整后在各自工作区内独立保存。 */
export function createDefaultWorkspaceLayouts(customWorkspaceIds: string[] = []): Record<Workspace, AreaNode> {
  const layouts: Record<Workspace, AreaNode> = {
    controls: split("split-controls-main", "vertical", .2,
      leaf("area-controls-layers", "layers"),
      split("split-controls-right", "vertical", .78, leaf("area-controls-canvas", "canvas"), leaf("area-controls-properties", "properties"))),
    bindings: split("split-bindings-main", "vertical", .2,
      leaf("area-bindings-layers", "layers"),
      split("split-bindings-right", "vertical", .75, leaf("area-bindings-resources", "bindings"), leaf("area-bindings-overview", "overview"))),
    slice: split("split-slice-main", "vertical", .72,
      leaf("area-slice-candidates", "slice-candidates"),
      split("split-slice-right", "horizontal", .4,
        leaf("area-slice-overview", "overview"),
        leaf("area-slice-marker", "slice-marker"))),
    preview: leaf("area-preview", "preview"),
    export: leaf("area-export-targets", "export-targets"),
  };
  for (const id of customWorkspaceIds) {
    if (id && !layouts[id]) layouts[id] = leaf(`area-${id}-canvas`, "canvas");
  }
  return layouts;
}

function isLegacyDefaultSliceLayout(node: AreaNode): boolean {
  if (node.kind !== "split" || node.id !== "split-slice-main" || node.axis !== "vertical"
    || Math.abs(node.ratio - .44) > .001
    || node.first.kind !== "area" || node.first.id !== "area-slice-candidates" || node.first.tool !== "slice-candidates"
    || node.second.kind !== "split" || node.second.id !== "split-slice-right" || node.second.axis !== "vertical"
    || Math.abs(node.second.ratio - .64) > .001) return false;
  return node.second.first.kind === "area" && node.second.first.id === "area-slice-marker" && node.second.first.tool === "slice-marker"
    && node.second.second.kind === "area" && node.second.second.id === "area-slice-overview" && node.second.second.tool === "overview";
}

/** 将早期九宫格布局迁移到新的“左侧候选，右侧上下分栏”排版。自定义九宫格分割布局不覆盖。 */
export function migrateWorkspaceLayout(workflow: Workspace, restored: AreaNode, fallback: AreaNode): AreaNode {
  if (workflow === "slice" && restored.kind === "area" && restored.id === "area-slice" && restored.tool === "slice") {
    return fallback;
  }
  if (workflow === "slice" && isLegacyDefaultSliceLayout(restored)) return fallback;
  return restored;
}

export function areaLeaves(node: AreaNode, out: AreaLeaf[] = []): AreaLeaf[] {
  if (node.kind === "area") out.push(node);
  else {
    areaLeaves(node.first, out);
    areaLeaves(node.second, out);
  }
  return out;
}

export function areaSplits(node: AreaNode, out: AreaSplit[] = []): AreaSplit[] {
  if (node.kind === "split") {
    out.push(node);
    areaSplits(node.first, out);
    areaSplits(node.second, out);
  }
  return out;
}

export function findArea(node: AreaNode, id: string): AreaLeaf | null {
  if (node.kind === "area") return node.id === id ? node : null;
  return findArea(node.first, id) ?? findArea(node.second, id);
}

export function findSplit(node: AreaNode, id: string): AreaSplit | null {
  if (node.kind === "area") return null;
  if (node.id === id) return node;
  return findSplit(node.first, id) ?? findSplit(node.second, id);
}

export function clampAreaRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(AREA_RATIO_MIN, Math.min(AREA_RATIO_MAX, value));
}

export function updateAreaTool(node: AreaNode, areaId: string, tool: AreaTool): AreaNode {
  if (node.kind === "area") return node.id === areaId ? { ...node, tool } : node;
  return {
    ...node,
    first: updateAreaTool(node.first, areaId, tool),
    second: updateAreaTool(node.second, areaId, tool),
  };
}

export function resizeAreaSplit(node: AreaNode, splitId: string, ratio: number): AreaNode {
  if (node.kind === "area") return node;
  if (node.id === splitId) return { ...node, ratio: clampAreaRatio(ratio) };
  return {
    ...node,
    first: resizeAreaSplit(node.first, splitId, ratio),
    second: resizeAreaSplit(node.second, splitId, ratio),
  };
}

export function swapAreaSplit(node: AreaNode, splitId: string): AreaNode {
  if (node.kind === "area") return node;
  if (node.id === splitId) return { ...node, first: node.second, second: node.first, ratio: 1 - node.ratio };
  return {
    ...node,
    first: swapAreaSplit(node.first, splitId),
    second: swapAreaSplit(node.second, splitId),
  };
}

function collectIds(node: AreaNode, out = new Set<string>()): Set<string> {
  out.add(node.id);
  if (node.kind === "split") {
    collectIds(node.first, out);
    collectIds(node.second, out);
  }
  return out;
}

export function nextAreaId(node: AreaNode): string {
  const ids = collectIds(node);
  let index = 1;
  while (ids.has(`area-${index}`)) index += 1;
  return `area-${index}`;
}

export function nextSplitId(node: AreaNode): string {
  const ids = collectIds(node);
  let index = 1;
  while (ids.has(`split-${index}`)) index += 1;
  return `split-${index}`;
}

export function splitArea(node: AreaNode, areaId: string, axis: AreaSplitAxis, ratio = 0.5): AreaNode {
  const ids = collectIds(node);
  let areaIndex = 1;
  while (ids.has(`area-${areaIndex}`)) areaIndex += 1;
  let splitIndex = 1;
  while (ids.has(`split-${splitIndex}`)) splitIndex += 1;
  const newAreaId = `area-${areaIndex}`;
  const newSplitId = `split-${splitIndex}`;
  let didSplit = false;

  const visit = (candidate: AreaNode): AreaNode => {
    if (candidate.kind === "area") {
      if (candidate.id !== areaId) return candidate;
      didSplit = true;
      return {
        kind: "split",
        id: newSplitId,
        axis,
        ratio: clampAreaRatio(ratio),
        first: candidate,
        second: { kind: "area", id: newAreaId, tool: candidate.tool },
      };
    }
    const first = didSplit ? candidate.first : visit(candidate.first);
    const second = didSplit ? candidate.second : visit(candidate.second);
    return first === candidate.first && second === candidate.second
      ? candidate
      : { ...candidate, first, second };
  };

  return visit(node);
}

/** 返回包含指定叶子区域的直接父分割节点。 */
export function directParentSplit(node: AreaNode, areaId: string): AreaSplit | null {
  if (node.kind === "area") return null;
  if ((node.first.kind === "area" && node.first.id === areaId)
    || (node.second.kind === "area" && node.second.id === areaId)) return node;
  return directParentSplit(node.first, areaId) ?? directParentSplit(node.second, areaId);
}

/**
 * 合并当前叶子与其直接兄弟。keep=current 时保留当前区域，keep=sibling 时保留兄弟区域。
 * 只允许合并直接相邻的叶子，避免简化实现误伤嵌套布局。
 */
export function joinArea(node: AreaNode, areaId: string, keep: "current" | "sibling"): AreaNode {
  if (node.kind === "area") return node;
  if (node.first.kind === "area" && node.first.id === areaId) return keep === "current" ? node.first : node.second;
  if (node.second.kind === "area" && node.second.id === areaId) return keep === "current" ? node.second : node.first;
  const first = joinArea(node.first, areaId, keep);
  if (first !== node.first) return { ...node, first };
  return { ...node, second: joinArea(node.second, areaId, keep) };
}

/**
 * 移除一个相邻叶子区域，并让另一个叶子区域占据合并后的空间。
 *
 * 与右键菜单的“直接兄弟合并”不同，角落拖拽可以跨过嵌套分割，
 * 因此需要移除任意叶子并沿途折叠只剩一个分支的 split 节点。
 * keepId 区域本身会被保留，便于继续使用它当前的工具。
 */
export function joinAreaPair(node: AreaNode, removeId: string, keepId: string): AreaNode {
  if (removeId === keepId || !findArea(node, removeId) || !findArea(node, keepId)) return node;

  const remove = (candidate: AreaNode): { node: AreaNode | null; removed: boolean } => {
    if (candidate.kind === "area") {
      return candidate.id === removeId ? { node: null, removed: true } : { node: candidate, removed: false };
    }
    const first = remove(candidate.first);
    const second = remove(candidate.second);
    if (!first.removed && !second.removed) return { node: candidate, removed: false };
    if (!first.node) return { node: second.node, removed: true };
    if (!second.node) return { node: first.node, removed: true };
    return { node: { ...candidate, first: first.node, second: second.node }, removed: true };
  };

  const result = remove(node).node;
  return result && findArea(result, keepId) ? result : node;
}

export function isAreaNode(value: unknown): value is AreaNode {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AreaNode>;
  if (candidate.kind === "area") return typeof candidate.id === "string" && isAreaTool(candidate.tool);
  if (candidate.kind !== "split") return false;
  const split = candidate as Partial<AreaSplit>;
  return typeof split.id === "string" && (split.axis === "vertical" || split.axis === "horizontal")
    && typeof split.ratio === "number" && isAreaNode(split.first) && isAreaNode(split.second);
}

function isAreaTool(value: unknown): value is AreaTool {
  return value === "layers" || value === "canvas" || value === "properties" || value === "overview"
    || value === "bindings" || value === "slice" || value === "slice-candidates" || value === "slice-marker" || value === "preview"
    || value === "export-targets";
}

/** 从 localStorage 等不可信来源读取时进行结构校验和比例归一化。 */
export function sanitizeAreaLayout(value: unknown): AreaNode | null {
  if (!isAreaNode(value)) return null;
  const seen = new Set<string>();
  const visit = (candidate: AreaNode): AreaNode | null => {
    if (seen.has(candidate.id)) return null;
    seen.add(candidate.id);
    if (candidate.kind === "area") return { ...candidate };
    const first = visit(candidate.first);
    const second = visit(candidate.second);
    if (!first || !second) return null;
    return { ...candidate, ratio: clampAreaRatio(candidate.ratio), first, second };
  };
  return visit(value);
}
