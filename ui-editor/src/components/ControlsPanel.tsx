import { useEffect, useRef, useState } from "react";
import type { CtrlType, UINode } from "../types";
import { createSelectionIntent, flattenLayerIds, type SelectionIntent } from "../selection";
import InlineRename from "./InlineRename";

interface Props {
  nodes: UINode[];
  selectedIds: string[];
  nameMode: LayerNameMode;
  onSelect: (id: string, intent: SelectionIntent) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  renamingId: string | null;
  renameCaretMode: "all" | "prefix";
  onRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  warningIds?: string[];
  focusNodeId?: string | null;
}

export type LayerNameMode = "original" | "ai";

function displayName(node: UINode, mode: LayerNameMode): string {
  return mode === "original" ? (node.originalName ?? node.name) : node.name;
}

export const TYPE_LABELS: Record<CtrlType, string> = {
  Layout: "布局",
  StaticImage: "静态图片",
  StaticText: "静态文本",
  Button: "按钮",
  CheckBox: "复选框",
  RadioButton: "单选框",
  ProgressBar: "进度条",
  Slider: "滑动条",
  Edit: "输入框",
  List: "列表",
  ListHorizontal: "横向列表",
  GridView: "网格",
  empty: "空节点",
};

export function TypeIcon({ type }: { type?: CtrlType }) {
  const key = (type ?? "empty").toLowerCase();
  const label = type ? TYPE_LABELS[type] : "未标记";

  let glyph;
  switch (type) {
    case "StaticImage":
      glyph = <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 3-3 5 5" /></>;
      break;
    case "StaticText":
      glyph = <><path d="M4 5h16M12 5v14M8 19h8" /><path d="M7 5 4 19M17 5l3 14" /></>;
      break;
    case "Button":
      glyph = <rect x="3" y="6" width="18" height="12" rx="3" />;
      break;
    case "CheckBox":
      glyph = <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 3 3 6-7" /></>;
      break;
    case "RadioButton":
      glyph = <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>;
      break;
    case "ProgressBar":
      glyph = <><rect x="3" y="8" width="18" height="8" rx="2" /><path d="M5 10h8v4H5z" /></>;
      break;
    case "Slider":
      glyph = <><path d="M4 12h16" /><circle cx="15" cy="12" r="3" /></>;
      break;
    case "Edit":
      glyph = <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 9v6M11 12h6" /></>;
      break;
    case "List":
    case "ListHorizontal":
      glyph = <><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="3" cy="6" r=".7" fill="currentColor" /><circle cx="3" cy="12" r=".7" fill="currentColor" /><circle cx="3" cy="18" r=".7" fill="currentColor" /></>;
      break;
    case "GridView":
      glyph = <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>;
      break;
    case "Layout":
      glyph = <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></>;
      break;
    default:
      glyph = <><circle cx="12" cy="12" r="7" /><path d="M9 12h6" /></>;
      break;
  }

  return (
    <span className={`type-ic ctrl-type-icon ctrl-${key}`} title={label} aria-label={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{glyph}</svg>
    </span>
  );
}

function branchHasWarning(node: UINode, warningIds: string[] | undefined): boolean {
  if (!warningIds?.length) return false;
  return warningIds.includes(node.id) || Boolean(node.children?.some((child) => branchHasWarning(child, warningIds)));
}

function branchContains(node: UINode, id: string | null | undefined): boolean {
  if (!id) return false;
  return node.id === id || Boolean(node.children?.some((child) => branchContains(child, id)));
}

/** 只有定位目标真正变化时才自动展开，避免可见性等普通节点更新重开分支。 */
export function shouldAutoExpandForFocus(
  node: UINode,
  focusNodeId: string | null | undefined,
  previousFocusNodeId: string | null | undefined,
): boolean {
  return Boolean(focusNodeId && focusNodeId !== previousFocusNodeId && branchContains(node, focusNodeId));
}

function Row(p: {
  n: UINode;
  depth: number;
  selected: boolean;
  selectedIds: string[];
  onSelect: (id: string, intent: SelectionIntent) => void;
  orderedIds: string[];
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  renamingId: string | null;
  renameCaretMode: "all" | "prefix";
  nameMode: LayerNameMode;
  onRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  warningIds?: string[];
  focusNodeId?: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const previousFocusNodeId = useRef<string | null | undefined>(undefined);
  const hasChildren = Boolean(p.n.children?.length);
  const hasWarningInBranch = branchHasWarning(p.n, p.warningIds);
  useEffect(() => {
    if (hasWarningInBranch) setCollapsed(false);
  }, [hasWarningInBranch]);
  useEffect(() => {
    if (shouldAutoExpandForFocus(p.n, p.focusNodeId, previousFocusNodeId.current)) setCollapsed(false);
    previousFocusNodeId.current = p.focusNodeId;
  }, [p.focusNodeId, p.n]);
  useEffect(() => {
    if (p.focusNodeId !== p.n.id) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-node-id="${p.n.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [p.focusNodeId, p.n.id]);

  return (
    <>
      <li data-node-id={p.n.id} className={`${p.selected ? "sel" : ""}${p.warningIds?.includes(p.n.id) ? " warning" : ""}`} onClick={(e) => p.onSelect(p.n.id, createSelectionIntent(e, p.orderedIds))}
        style={{ paddingLeft: 8 + p.depth * 16 }}>
        <button
          className="fold"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setCollapsed((value) => !value);
          }}
          title={hasChildren ? (collapsed ? "展开" : "折叠") : undefined}
        >
          {hasChildren && (
            <svg viewBox="0 0 8 8" className={collapsed ? "" : "open"}>
              <path d="M2 1.5l4 2.5-4 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <TypeIcon type={p.n.ctrl?.type} />
        {p.renamingId === p.n.id ? (
          <InlineRename
            name={p.n.name}
            caretMode={p.renameCaretMode}
            onCommit={(name) => p.onRename(p.n.id, name)}
            onCancel={p.onCancelRename}
          />
        ) : <span className="name" title={p.nameMode === "original" ? `PSD 原名：${displayName(p.n, p.nameMode)}\n工程名称：${p.n.name}` : p.n.name}>{displayName(p.n, p.nameMode)}</span>}
        <button className="icon" title={p.n.visible === false ? "显示" : "隐藏"}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleVisible(p.n.id);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            {p.n.visible === false ? <path d="M3 3l10 10M8 5.2a2.8 2.8 0 0 1 2.8 2.8M5 6.3A4 4 0 0 0 8.6 11M2.2 6.4A8.5 8.5 0 0 0 1.5 8s2.6 4 6.5 4c.9 0 1.7-.2 2.4-.5" />
              : <><path d="M1.5 8s2.6-4 6.5-4 6.5 4 6.5 4-2.6 4-6.5 4S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.8" /></>}
          </svg>
        </button>
        <button className="icon" title={p.n.locked ? "解锁" : "锁定"}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleLock(p.n.id);
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            {p.n.locked ? <><rect x="4" y="7.5" width="8" height="6" rx="1.5" /><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" /></>
              : <path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2M4 7.5h8v6H4z" />}
          </svg>
        </button>
      </li>
      {!collapsed && hasChildren && [...(p.n.children ?? [])].sort((a, b) => b.zIndex - a.zIndex).map((child) => (
        <Row
          key={child.id}
          n={child}
          depth={p.depth + 1}
          selected={p.selectedIds.includes(child.id)}
          selectedIds={p.selectedIds}
          orderedIds={p.orderedIds}
          onSelect={p.onSelect}
          onToggleVisible={p.onToggleVisible}
          onToggleLock={p.onToggleLock}
          renamingId={p.renamingId}
          renameCaretMode={p.renameCaretMode}
          nameMode={p.nameMode}
          onRename={p.onRename}
          onCancelRename={p.onCancelRename}
          warningIds={p.warningIds}
          focusNodeId={p.focusNodeId}
        />
      ))}
    </>
  );
}

/** 层级工作区：统一使用工程控件图标，名称可在 PSD 原名和工程名称之间切换。 */
export default function ControlsPanel(p: Props) {
  const sorted = [...p.nodes].sort((a, b) => b.zIndex - a.zIndex);
  const orderedIds = flattenLayerIds(p.nodes);
  const [width, setWidth] = useState(300);
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizing.current = { startX: e.clientX, startWidth: width };
    const move = (event: PointerEvent) => {
      if (!resizing.current) return;
      setWidth(Math.max(220, Math.min(480, resizing.current.startWidth + event.clientX - resizing.current.startX)));
    };
    const stop = () => {
      resizing.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  return (
    <aside className="layer-panel controls-panel" style={{ width }}>
      <div className="panel-head">
        <h3>层级</h3>
        {p.selectedIds.length > 1 && <span className="selection-count">已选 {p.selectedIds.length}</span>}
      </div>
      <ul>
        {sorted.map((node) => (
          <Row
            key={node.id}
            n={node}
            depth={0}
            selected={p.selectedIds.includes(node.id)}
            selectedIds={p.selectedIds}
            orderedIds={orderedIds}
            onSelect={p.onSelect}
            onToggleVisible={p.onToggleVisible}
            onToggleLock={p.onToggleLock}
            renamingId={p.renamingId}
            renameCaretMode={p.renameCaretMode}
            nameMode={p.nameMode}
            onRename={p.onRename}
            onCancelRename={p.onCancelRename}
            warningIds={p.warningIds}
            focusNodeId={p.focusNodeId}
          />
        ))}
      </ul>
      <div className="panel-resizer" onPointerDown={startResize} title="拖动调整面板宽度" />
    </aside>
  );
}
