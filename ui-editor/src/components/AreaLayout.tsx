import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  areaLeaves,
  clampAreaRatio,
  directParentSplit,
  type AreaLeaf,
  type AreaNode,
  type AreaSplit,
  type AreaSplitAxis,
  type AreaTool,
} from "../areaLayout";

interface Props {
  layout: AreaNode;
  activeAreaId: string;
  onActivate: (areaId: string) => void;
  onTool: (areaId: string, tool: AreaTool) => void;
  onSplit: (areaId: string, axis: AreaSplitAxis, ratio: number) => void;
  onResize: (splitId: string, ratio: number) => void;
  onJoin: (areaId: string, keep: "current" | "sibling") => void;
  /** removeId 是高亮的待合并区域，keepId 是拖拽发起的保留区域。 */
  onJoinAreas: (removeId: string, keepId: string) => void;
  onSwap: (splitId: string) => void;
  renderArea: (area: AreaLeaf) => ReactNode;
  uiScale?: number;
}

type AreaMenu = {
  x: number;
  y: number;
  areaId: string | null;
  splitId: string | null;
  parentSide: "first" | "second" | null;
};

type SplitDrag = {
  areaId: string;
  startX: number;
  startY: number;
  rect: DOMRect;
  joinTargetId: string | null;
};

type ResizeDrag = {
  splitId: string;
  axis: AreaSplitAxis;
  rect: DOMRect;
  startX: number;
  startY: number;
  startRatio: number;
};

const AREA_MENU_GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Prefer the mouse's lower-right side, then flip independently at each viewport edge. */
export function areaMenuPosition(
  anchor: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const maxLeft = Math.max(AREA_MENU_GAP, viewport.width - menu.width - AREA_MENU_GAP);
  const maxTop = Math.max(AREA_MENU_GAP, viewport.height - menu.height - AREA_MENU_GAP);
  const left = anchor.x + AREA_MENU_GAP + menu.width <= viewport.width - AREA_MENU_GAP
    ? anchor.x + AREA_MENU_GAP
    : anchor.x - menu.width - AREA_MENU_GAP;
  const top = anchor.y + AREA_MENU_GAP + menu.height <= viewport.height - AREA_MENU_GAP
    ? anchor.y + AREA_MENU_GAP
    : anchor.y - menu.height - AREA_MENU_GAP;
  return { left: clamp(left, AREA_MENU_GAP, maxLeft), top: clamp(top, AREA_MENU_GAP, maxTop) };
}

function parentInfo(layout: AreaNode, areaId: string): { split: AreaSplit; side: "first" | "second" } | null {
  const split = directParentSplit(layout, areaId);
  if (!split) return null;
  return split.first.kind === "area" && split.first.id === areaId
    ? { split, side: "first" }
    : split.second.kind === "area" && split.second.id === areaId
      ? { split, side: "second" }
      : null;
}

function firstLeaf(node: AreaNode): AreaLeaf {
  return areaLeaves(node)[0];
}

function areaElementsAreAdjacent(sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return false;
  const elements = [...document.querySelectorAll<HTMLElement>("[data-area-id]")];
  const source = elements.find((element) => element.dataset.areaId === sourceId);
  const target = elements.find((element) => element.dataset.areaId === targetId);
  if (!source || !target) return false;
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const overlapX = Math.min(sourceRect.right, targetRect.right) - Math.max(sourceRect.left, targetRect.left);
  const overlapY = Math.min(sourceRect.bottom, targetRect.bottom) - Math.max(sourceRect.top, targetRect.top);
  const edgeTolerance = 12;
  const overlapTolerance = 16;
  const verticalTouch = Math.abs(sourceRect.right - targetRect.left) <= edgeTolerance
    || Math.abs(targetRect.right - sourceRect.left) <= edgeTolerance;
  const horizontalTouch = Math.abs(sourceRect.bottom - targetRect.top) <= edgeTolerance
    || Math.abs(targetRect.bottom - sourceRect.top) <= edgeTolerance;
  return (verticalTouch && overlapY > overlapTolerance) || (horizontalTouch && overlapX > overlapTolerance);
}

function AreaNodeView({
  node,
  activeAreaId,
  onActivate,
  onTool,
  onSplit,
  onResizeStart,
  onContextMenu,
  renderArea,
  joinTargetId,
}: {
  node: AreaNode;
  activeAreaId: string;
  onActivate: (areaId: string) => void;
  onTool: (areaId: string, tool: AreaTool) => void;
  onSplit: (areaId: string, axis: AreaSplitAxis, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (split: AreaSplit, event: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent, areaId: string | null, splitId: string | null) => void;
  renderArea: (area: AreaLeaf) => ReactNode;
  joinTargetId: string | null;
}) {
  if (node.kind === "area") {
    return <section
      className={`area-pane${activeAreaId === node.id ? " is-active" : ""}${joinTargetId === node.id ? " is-join-target" : ""}`}
      data-area-id={node.id}
      onPointerEnter={() => onActivate(node.id)}
      aria-label={`${node.tool} 工具区域`}
    >
      <button className="area-corner area-corner-tl" type="button" aria-label="从左上角分割区域"
        onPointerDown={(event) => onSplit(node.id, "horizontal", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)} />
      <button className="area-corner area-corner-tr" type="button" aria-label="从右上角分割区域"
        onPointerDown={(event) => onSplit(node.id, "vertical", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)} />
      <button className="area-corner area-corner-bl" type="button" aria-label="从左下角分割区域"
        onPointerDown={(event) => onSplit(node.id, "vertical", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)} />
      <button className="area-corner area-corner-br" type="button" aria-label="从右下角分割区域"
        onPointerDown={(event) => onSplit(node.id, "horizontal", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)} />
      {renderArea(node)}
    </section>;
  }

  const template = node.axis === "vertical"
    ? { gridTemplateColumns: `${node.ratio}fr 1px ${1 - node.ratio}fr` }
    : { gridTemplateRows: `${node.ratio}fr 1px ${1 - node.ratio}fr` };
  return <div className={`area-split area-split-${node.axis}`} style={template}>
    <AreaNodeView node={node.first} activeAreaId={activeAreaId} onActivate={onActivate}
      onTool={onTool} onSplit={onSplit} onResizeStart={onResizeStart}
      onContextMenu={onContextMenu} renderArea={renderArea} joinTargetId={joinTargetId} />
    <div className="area-divider" role="separator" aria-label="调整区域大小"
      onPointerDown={(event) => onResizeStart(node, event)}
      onContextMenu={(event) => onContextMenu(event, firstLeaf(node.first).id, node.id)} />
    <AreaNodeView node={node.second} activeAreaId={activeAreaId} onActivate={onActivate}
      onTool={onTool} onSplit={onSplit} onResizeStart={onResizeStart}
      onContextMenu={onContextMenu} renderArea={renderArea} joinTargetId={joinTargetId} />
  </div>;
}

export default function AreaLayout({ layout, activeAreaId, onActivate, onTool, onSplit, onResize, onJoin, onJoinAreas, onSwap, renderArea, uiScale = 1 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<SplitDrag | null>(null);
  const resizeDragRef = useRef<ResizeDrag | null>(null);
  const [dragPreview, setDragPreview] = useState<{ axis: AreaSplitAxis; offset: number } | null>(null);
  const [joinTargetId, setJoinTargetId] = useState<string | null>(null);
  const [menu, setMenu] = useState<AreaMenu | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const safeUiScale = Math.max(0.5, Math.min(2, uiScale));
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const split = splitDragRef.current;
      if (split) {
        const dx = event.clientX - split.startX;
        const dy = event.clientY - split.startY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        const hoveredArea = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-area-id]");
        const hoveredId = hoveredArea?.dataset.areaId ?? null;
        const nextJoinTarget = hoveredId && areaElementsAreAdjacent(split.areaId, hoveredId) ? hoveredId : null;
        split.joinTargetId = nextJoinTarget;
        setJoinTargetId(nextJoinTarget);
        if (nextJoinTarget) {
          setDragPreview(null);
          return;
        }
        const axis: AreaSplitAxis = Math.abs(dx) >= Math.abs(dy) ? "vertical" : "horizontal";
        const size = axis === "vertical" ? split.rect.width : split.rect.height;
        const start = axis === "vertical" ? split.rect.left : split.rect.top;
        setDragPreview({ axis, offset: Math.max(0, Math.min(size, (axis === "vertical" ? event.clientX : event.clientY) - start)) });
        return;
      }
      const resize = resizeDragRef.current;
      if (!resize) return;
      const size = resize.axis === "vertical" ? resize.rect.width : resize.rect.height;
      const delta = resize.axis === "vertical" ? event.clientX - resize.startX : event.clientY - resize.startY;
      onResize(resize.splitId, resize.startRatio + delta / Math.max(1, size));
    };
    const onUp = (event: globalThis.PointerEvent) => {
      const split = splitDragRef.current;
      if (split) {
        const dx = event.clientX - split.startX;
        const dy = event.clientY - split.startY;
        if (split.joinTargetId) {
          // 高亮的是将被并入并移除的区域，拖拽发起的区域保留。
          onJoinAreas(split.joinTargetId, split.areaId);
        } else if (Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
          const axis: AreaSplitAxis = Math.abs(dx) >= Math.abs(dy) ? "vertical" : "horizontal";
          const size = axis === "vertical" ? split.rect.width : split.rect.height;
          const start = axis === "vertical" ? split.rect.left : split.rect.top;
          const ratio = clampAreaRatio(((axis === "vertical" ? event.clientX : event.clientY) - start) / Math.max(1, size));
          onSplit(split.areaId, axis, ratio);
        }
        splitDragRef.current = null;
        setJoinTargetId(null);
        setDragPreview(null);
      }
      if (resizeDragRef.current) resizeDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [layout, onJoinAreas, onResize, onSplit]);

  const handleSplitStart = (areaId: string, fallbackAxis: AreaSplitAxis, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate(areaId);
    const rect = event.currentTarget.closest<HTMLElement>(".area-pane")?.getBoundingClientRect();
    if (!rect) return;
    splitDragRef.current = { areaId, startX: event.clientX, startY: event.clientY, rect, joinTargetId: null };
    setJoinTargetId(null);
    // 记录角落的默认方向只用于拖动尚未移动时的视觉提示；实际方向由拖动主轴决定。
    setDragPreview({ axis: fallbackAxis, offset: fallbackAxis === "vertical" ? rect.width / 2 : rect.height / 2 });
  };

  const handleResizeStart = (split: AreaSplit, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    resizeDragRef.current = {
      splitId: split.id,
      axis: split.axis,
      rect,
      startX: event.clientX,
      startY: event.clientY,
      startRatio: split.ratio,
    };
  };

  const showMenu = (event: React.MouseEvent, areaId: string | null, splitId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const actualAreaId = areaId ?? activeAreaId;
    const info = actualAreaId ? parentInfo(layout, actualAreaId) : null;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      areaId: actualAreaId,
      splitId: splitId ?? info?.split.id ?? null,
      parentSide: info?.side ?? null,
    });
    setMenuPosition(null);
    if (actualAreaId) onActivate(actualAreaId);
  };

  const menuInfo = menu?.areaId ? parentInfo(layout, menu.areaId) : null;
  const joinLabel = menuInfo?.split.axis === "horizontal"
    ? (menuInfo.side === "first" ? "向下合并" : "向上合并")
    : (menuInfo?.side === "first" ? "向右合并" : "向左合并");
  const canJoin = Boolean(menuInfo);

  useIsoLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setMenuPosition(areaMenuPosition(menu, { width: rect.width, height: rect.height }, {
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }, [menu, safeUiScale, joinLabel, canJoin]);

  const menuContent = menu && <div
    ref={menuRef}
    className="area-options-menu"
    role="menu"
    style={{
      left: menuPosition?.left ?? 0,
      top: menuPosition?.top ?? 0,
      transform: `scale(${safeUiScale})`,
      transformOrigin: "top left",
      visibility: menuPosition ? "visible" : "hidden",
    }}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <div className="area-options-title">区域选项</div>
    <button role="menuitem" onClick={() => { if (menu.areaId) onSplit(menu.areaId, "vertical", .5); setMenu(null); }}>左右分割</button>
    <button role="menuitem" onClick={() => { if (menu.areaId) onSplit(menu.areaId, "horizontal", .5); setMenu(null); }}>上下分割</button>
    <div className="area-options-divider" />
    <button role="menuitem" disabled={!canJoin} onClick={() => { if (menu.areaId) onJoin(menu.areaId, "current"); setMenu(null); }}>{joinLabel || "合并相邻区域"}</button>
    <button role="menuitem" disabled={!canJoin} onClick={() => { if (menu.areaId) onJoin(menu.areaId, "sibling"); setMenu(null); }}>{menuInfo?.split.axis === "horizontal" ? (menuInfo.side === "first" ? "向上合并" : "向下合并") : (menuInfo?.side === "first" ? "向左合并" : "向右合并")}</button>
    <button role="menuitem" disabled={!menu.splitId} onClick={() => { if (menu.splitId) onSwap(menu.splitId); setMenu(null); }}>交换区域</button>
  </div>;

  const splitPreviewStyle = (() => {
    const split = splitDragRef.current;
    const root = rootRef.current;
    if (!dragPreview || !split || !root) return null;
    const rootRect = root.getBoundingClientRect();
    const scaleX = rootRect.width / Math.max(1, root.clientWidth);
    const scaleY = rootRect.height / Math.max(1, root.clientHeight);
    const localLeft = (split.rect.left - rootRect.left) / scaleX;
    const localTop = (split.rect.top - rootRect.top) / scaleY;
    if (dragPreview.axis === "vertical") {
      return {
        left: `${localLeft + dragPreview.offset / scaleX}px`,
        top: `${localTop}px`,
        width: "1px",
        height: `${split.rect.height / scaleY}px`,
      };
    }
    return {
      left: `${localLeft}px`,
      top: `${localTop + dragPreview.offset / scaleY}px`,
      width: `${split.rect.width / scaleX}px`,
      height: "1px",
    };
  })();

  return <div className="area-layout-root" ref={rootRef}>
    <AreaNodeView node={layout} activeAreaId={activeAreaId} onActivate={onActivate}
      onTool={onTool} onSplit={handleSplitStart} onResizeStart={handleResizeStart}
      onContextMenu={showMenu} renderArea={renderArea} joinTargetId={joinTargetId} />
    {splitPreviewStyle && <div className={`area-split-preview ${dragPreview?.axis ?? ""}`} style={splitPreviewStyle} />}
    {typeof document === "undefined" ? menuContent : null}
    {typeof document !== "undefined" && menuContent ? createPortal(menuContent, document.body) : null}
  </div>;
}
