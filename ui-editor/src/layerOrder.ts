import type { UINode } from "./types";

export type LayerOrderDirection = "up" | "down";

export interface LayerOrderResult {
  nodes: UINode[];
  changed: boolean;
  /** 选中节点移动后的父节点；null 表示场景根级。 */
  newParentId: string | null;
}

function findPath(nodes: UINode[], id: string, prefix: number[] = []): number[] | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.id === id) return [...prefix, i];
    if (node.children) {
      const found = findPath(node.children, id, [...prefix, i]);
      if (found) return found;
    }
  }
  return null;
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

function replaceChildrenAtPath(nodes: UINode[], path: number[], children: UINode[]): UINode[] {
  if (!path.length) return children;
  const [head, ...tail] = path;
  return nodes.map((node, index) => index === head
    ? { ...node, children: replaceChildrenAtPath(node.children ?? [], tail, children) }
    : node);
}

function insertAtPath(nodes: UINode[], parentPath: number[], index: number, inserted: UINode[]): UINode[] {
  if (!parentPath.length) return [...nodes.slice(0, index), ...inserted, ...nodes.slice(index)];
  const [head, ...tail] = parentPath;
  return nodes.map((node, i) => i === head
    ? { ...node, children: insertAtPath(node.children ?? [], tail, index, inserted) }
    : node);
}

function sortTreeByStack(nodes: UINode[]): UINode[] {
  return [...nodes]
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((node) => ({ ...node, children: node.children ? sortTreeByStack(node.children) : node.children }));
}

function reindexStack(nodes: UINode[]): UINode[] {
  let count = 0;
  const countNodes = (items: UINode[]) => items.forEach((node) => { count++; if (node.children) countNodes(node.children); });
  countNodes(nodes);
  let cursor = 0;
  const assign = (items: UINode[]): UINode[] => items.map((node) => ({
    ...node,
    zIndex: count - cursor++,
    children: node.children ? assign(node.children) : node.children,
  }));
  return assign(nodes);
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * 按层级面板的堆叠顺序移动节点。移动到当前父级边界后跨出父级，根级不再继续跨出。
 * 返回的新树已经把 zIndex 与层级面板顺序重新对齐。
 */
export function moveLayerOrder(nodes: UINode[], selectedIds: string[], direction: LayerOrderDirection): LayerOrderResult {
  if (!selectedIds.length) return { nodes, changed: false, newParentId: null };
  const normalized = sortTreeByStack(nodes);
  const paths = selectedIds.map((id) => findPath(normalized, id));
  if (paths.some((path): path is null => path === null)) return { nodes, changed: false, newParentId: null };
  const validPaths = paths as number[][];
  if (validPaths.some((path, i) => validPaths.some((other, j) => i !== j
    && path.length < other.length && path.every((value, k) => value === other[k])))) {
    return { nodes, changed: false, newParentId: null };
  }
  const parentPaths = validPaths.map((path) => path.slice(0, -1));
  if (!parentPaths.every((path) => samePath(path, parentPaths[0]))) {
    return { nodes, changed: false, newParentId: null };
  }

  const parentPath = parentPaths[0];
  const siblings = parentPath.length ? nodeAtPath(normalized, parentPath)?.children ?? [] : normalized;
  const selectedSet = new Set(selectedIds);
  const selected = siblings.filter((node) => selectedSet.has(node.id));
  const selectedIndexes = siblings.map((node, index) => selectedSet.has(node.id) ? index : -1).filter((index) => index >= 0);
  if (!selected.length) return { nodes, changed: false, newParentId: null };

  const remaining = siblings.filter((node) => !selectedSet.has(node.id));
  let nextNodes = normalized;
  let newParentPath = parentPath;
  const minIndex = Math.min(...selectedIndexes);
  const maxIndex = Math.max(...selectedIndexes);

  if (direction === "up" && minIndex > 0) {
    const beforeSelected = siblings.slice(0, minIndex).filter((node) => !selectedSet.has(node.id)).length;
    remaining.splice(Math.max(0, beforeSelected - 1), 0, ...selected);
    nextNodes = replaceChildrenAtPath(normalized, parentPath, remaining);
  } else if (direction === "down" && maxIndex < siblings.length - 1) {
    const beforeOrAtSelectedEnd = siblings.slice(0, maxIndex + 1).filter((node) => !selectedSet.has(node.id)).length;
    remaining.splice(beforeOrAtSelectedEnd + 1, 0, ...selected);
    nextNodes = replaceChildrenAtPath(normalized, parentPath, remaining);
  } else if (parentPath.length) {
    // 到达文件夹边界：整体移到父文件夹的外侧。根级没有更高层级，因此在根边界无效。
    const outerPath = parentPath.slice(0, -1);
    const folderIndex = parentPath[parentPath.length - 1];
    nextNodes = replaceChildrenAtPath(normalized, parentPath, remaining);
    const insertIndex = direction === "up" ? folderIndex : folderIndex + 1;
    nextNodes = insertAtPath(nextNodes, outerPath, insertIndex, selected);
    newParentPath = outerPath;
  } else {
    return { nodes, changed: false, newParentId: null };
  }

  const finalNodes = reindexStack(nextNodes);
  return {
    nodes: finalNodes,
    changed: true,
    newParentId: newParentPath.length ? nodeAtPath(finalNodes, newParentPath)?.id ?? null : null,
  };
}
