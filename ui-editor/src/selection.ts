import type { UINode } from "./types";

export interface SelectionIntent {
  additive: boolean;
  range: boolean;
  /** 当前层级树的完整顺序，折叠节点的后代也应包含在内。 */
  orderedIds: string[];
}

export interface SelectionModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function createSelectionIntent(event: SelectionModifiers, orderedIds: string[]): SelectionIntent {
  return {
    additive: Boolean(event.ctrlKey || event.metaKey),
    range: Boolean(event.shiftKey),
    orderedIds,
  };
}

/** 返回层级面板从上到下的完整顺序；折叠状态不影响 Shift 范围锚点计算。 */
export function flattenLayerIds(nodes: UINode[]): string[] {
  return [...nodes]
    .sort((a, b) => b.zIndex - a.zIndex)
    .flatMap((node) => [node.id, ...flattenLayerIds(node.children ?? [])]);
}

export interface SelectionResult {
  ids: string[];
  primaryId: string | null;
  anchorId: string | null;
}

/** 统一实现层级树的普通点选、加选/减选和连选规则。 */
export function applySelection(
  currentIds: string[],
  clickedId: string,
  anchorId: string | null,
  intent: SelectionIntent,
): SelectionResult {
  if (!intent.range) {
    if (!intent.additive) return { ids: [clickedId], primaryId: clickedId, anchorId: clickedId };
    const ids = currentIds.includes(clickedId)
      ? currentIds.filter((id) => id !== clickedId)
      : [...currentIds, clickedId];
    return { ids, primaryId: ids.includes(clickedId) ? clickedId : ids.at(-1) ?? null, anchorId };
  }

  const order = intent.orderedIds;
  const start = order.indexOf(anchorId ?? clickedId);
  const end = order.indexOf(clickedId);
  if (start < 0 || end < 0) {
    return intent.additive
      ? { ids: currentIds, primaryId: currentIds.at(-1) ?? null, anchorId }
      : { ids: [clickedId], primaryId: clickedId, anchorId: anchorId ?? clickedId };
  }
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rangeIds = order.slice(from, to + 1);
  const ids = intent.additive
    ? currentIds.filter((id) => !rangeIds.includes(id))
    : rangeIds;
  return {
    ids,
    primaryId: ids.includes(clickedId) ? clickedId : ids.at(-1) ?? null,
    anchorId: anchorId ?? clickedId,
  };
}
