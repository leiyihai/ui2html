import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
  onSwap: (splitId: string) => void;
  renderArea: (area: AreaLeaf) => ReactNode;
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
};

type ResizeDrag = {
  splitId: string;
  axis: AreaSplitAxis;
  rect: DOMRect;
  startX: number;
  startY: number;
  startRatio: number;
};

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

function AreaNodeView({
  node,
  activeAreaId,
  onActivate,
  onTool,
  onSplit,
  onResizeStart,
  onContextMenu,
  renderArea,
}: {
  node: AreaNode;
  activeAreaId: string;
  onActivate: (areaId: string) => void;
  onTool: (areaId: string, tool: AreaTool) => void;
  onSplit: (areaId: string, axis: AreaSplitAxis, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (split: AreaSplit, event: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent, areaId: string | null, splitId: string | null) => void;
  renderArea: (area: AreaLeaf) => ReactNode;
}) {
  if (node.kind === "area") {
    return <section
      className={`area-pane${activeAreaId === node.id ? " is-active" : ""}`}
      onPointerEnter={() => onActivate(node.id)}
      aria-label={`${node.tool} 工具区域`}
    >
      <button className="area-corner area-corner-tl" type="button" aria-label="从左上角分割区域"
        onPointerDown={(event) => onSplit(node.id, "horizontal", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)}>＋</button>
      <button className="area-corner area-corner-tr" type="button" aria-label="从右上角分割区域"
        onPointerDown={(event) => onSplit(node.id, "vertical", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)}>＋</button>
      <button className="area-corner area-corner-bl" type="button" aria-label="从左下角分割区域"
        onPointerDown={(event) => onSplit(node.id, "vertical", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)}>＋</button>
      <button className="area-corner area-corner-br" type="button" aria-label="从右下角分割区域"
        onPointerDown={(event) => onSplit(node.id, "horizontal", event)} onContextMenu={(event) => onContextMenu(event, node.id, null)}>＋</button>
      {renderArea(node)}
    </section>;
  }

  const template = node.axis === "vertical"
    ? { gridTemplateColumns: `${node.ratio}fr 1px ${1 - node.ratio}fr` }
    : { gridTemplateRows: `${node.ratio}fr 1px ${1 - node.ratio}fr` };
  return <div className={`area-split area-split-${node.axis}`} style={template}>
    <AreaNodeView node={node.first} activeAreaId={activeAreaId} onActivate={onActivate}
      onTool={onTool} onSplit={onSplit} onResizeStart={onResizeStart}
      onContextMenu={onContextMenu} renderArea={renderArea} />
    <div className="area-divider" role="separator" aria-label="调整区域大小"
      onPointerDown={(event) => onResizeStart(node, event)}
      onContextMenu={(event) => onContextMenu(event, firstLeaf(node.first).id, node.id)} />
    <AreaNodeView node={node.second} activeAreaId={activeAreaId} onActivate={onActivate}
      onTool={onTool} onSplit={onSplit} onResizeStart={onResizeStart}
      onContextMenu={onContextMenu} renderArea={renderArea} />
  </div>;
}

export default function AreaLayout({ layout, activeAreaId, onActivate, onTool, onSplit, onResize, onJoin, onSwap, renderArea }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<SplitDrag | null>(null);
  const resizeDragRef = useRef<ResizeDrag | null>(null);
  const [dragPreview, setDragPreview] = useState<{ axis: AreaSplitAxis; offset: number } | null>(null);
  const [menu, setMenu] = useState<AreaMenu | null>(null);

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
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
          const axis: AreaSplitAxis = Math.abs(dx) >= Math.abs(dy) ? "vertical" : "horizontal";
          const size = axis === "vertical" ? split.rect.width : split.rect.height;
          const start = axis === "vertical" ? split.rect.left : split.rect.top;
          const ratio = clampAreaRatio(((axis === "vertical" ? event.clientX : event.clientY) - start) / Math.max(1, size));
          onSplit(split.areaId, axis, ratio);
        }
        splitDragRef.current = null;
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
  }, [onResize, onSplit]);

  const handleSplitStart = (areaId: string, fallbackAxis: AreaSplitAxis, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate(areaId);
    const rect = event.currentTarget.closest<HTMLElement>(".area-pane")?.getBoundingClientRect();
    if (!rect) return;
    splitDragRef.current = { areaId, startX: event.clientX, startY: event.clientY, rect };
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
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const actualAreaId = areaId ?? activeAreaId;
    const info = actualAreaId ? parentInfo(layout, actualAreaId) : null;
    setMenu({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      areaId: actualAreaId,
      splitId: splitId ?? info?.split.id ?? null,
      parentSide: info?.side ?? null,
    });
    if (actualAreaId) onActivate(actualAreaId);
  };

  const menuInfo = menu?.areaId ? parentInfo(layout, menu.areaId) : null;
  const joinLabel = menuInfo?.split.axis === "horizontal"
    ? (menuInfo.side === "first" ? "向下合并" : "向上合并")
    : (menuInfo?.side === "first" ? "向右合并" : "向左合并");
  const canJoin = Boolean(menuInfo);

  return <div className="area-layout-root" ref={rootRef}>
    <AreaNodeView node={layout} activeAreaId={activeAreaId} onActivate={onActivate}
      onTool={onTool} onSplit={handleSplitStart} onResizeStart={handleResizeStart}
      onContextMenu={showMenu} renderArea={renderArea} />
    {dragPreview && splitDragRef.current && <div className={`area-split-preview ${dragPreview.axis}`} style={dragPreview.axis === "vertical"
      ? { left: `${Math.max(0, Math.min(splitDragRef.current.rect.width, dragPreview.offset)) + splitDragRef.current.rect.left - (rootRef.current?.getBoundingClientRect().left ?? 0)}px` }
      : { top: `${Math.max(0, Math.min(splitDragRef.current.rect.height, dragPreview.offset)) + splitDragRef.current.rect.top - (rootRef.current?.getBoundingClientRect().top ?? 0)}px` }} />}
    {menu && <div className="area-options-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="area-options-title">区域选项</div>
      <button role="menuitem" onClick={() => { if (menu.areaId) onSplit(menu.areaId, "vertical", .5); setMenu(null); }}>左右分割</button>
      <button role="menuitem" onClick={() => { if (menu.areaId) onSplit(menu.areaId, "horizontal", .5); setMenu(null); }}>上下分割</button>
      <div className="area-options-divider" />
      <button role="menuitem" disabled={!canJoin} onClick={() => { if (menu.areaId) onJoin(menu.areaId, "current"); setMenu(null); }}>{joinLabel || "合并相邻区域"}</button>
      <button role="menuitem" disabled={!canJoin} onClick={() => { if (menu.areaId) onJoin(menu.areaId, "sibling"); setMenu(null); }}>{menuInfo?.split.axis === "horizontal" ? (menuInfo.side === "first" ? "向上合并" : "向下合并") : (menuInfo?.side === "first" ? "向左合并" : "向右合并")}</button>
      <button role="menuitem" disabled={!menu.splitId} onClick={() => { if (menu.splitId) onSwap(menu.splitId); setMenu(null); }}>交换区域</button>
    </div>}
  </div>;
}
