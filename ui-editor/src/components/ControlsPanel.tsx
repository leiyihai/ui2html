import { useEffect, useRef, useState } from "react";
import type { CtrlType, UINode } from "../types";
import { createSelectionIntent, flattenLayerIds, type SelectionIntent } from "../selection";
import InlineRename from "./InlineRename";
import { Icon, iconNameForControl } from "./Icon";

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

  return (
    <span className={`type-ic ctrl-type-icon ctrl-${key}`} title={label} aria-label={label}>
      <Icon name={iconNameForControl(type)} className="type-glyph" />
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
            <Icon name="collapse" className={collapsed ? "" : "open"} size={13} />
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
          <Icon name={p.n.visible === false ? "eye-off" : "eye"} size={14} />
        </button>
        <button className="icon" title={p.n.locked ? "解锁" : "锁定"}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleLock(p.n.id);
          }}
        >
          <Icon name={p.n.locked ? "lock" : "unlock"} size={14} />
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
  return (
    <aside className="layer-panel controls-panel">
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
    </aside>
  );
}
