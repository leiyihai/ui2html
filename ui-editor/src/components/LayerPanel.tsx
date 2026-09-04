import { useState } from "react";
import type { UINode } from "../types";
import { createSelectionIntent, flattenLayerIds, type SelectionIntent } from "../selection";
import InlineRename from "./InlineRename";

interface Props {
  nodes: UINode[];
  selectedId: string | null;
  selectedIds: string[];
  onSelect: (id: string, intent: SelectionIntent) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  renamingId: string | null;
  renameCaretMode: "all" | "prefix";
  onRename: (id: string, name: string) => void;
  onCancelRename: () => void;
}

export type NodeType = "group" | "list" | "image" | "text";
export function nodeType(n: UINode): NodeType {
  if (n.children?.length) return n.list ? "list" : "group";
  return n.text ? "text" : "image";
}

const ICONS: Record<NodeType, React.ReactNode> = {
  // 线性图标：组=嵌套容器，list=列表行，image=矩形+山形，text=段落线
  group: (
    <>
      <rect x="2.5" y="4.5" width="11" height="9" rx="2" />
      <path d="M5.5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v7" />
    </>
  ),
  list: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <circle cx="6" cy="6.8" r="1" />
      <path d="M4.2 11.5 7.2 8.4l2 2 2.6-2.6" />
    </>
  ),
  text: (
    <>
      <path d="M3 4.5h10M3 7h7M3 9.5h9M3 12h5" />
    </>
  ),
};

const TYPE_CLASS: Record<NodeType, string> = {
  group: "t-group", list: "t-list", image: "t-image", text: "t-text",
};

function Row(p: { n: UINode; depth: number; selectedId: string | null; selectedIds: string[]; orderedIds: string[]; onSelect: (id: string, intent: SelectionIntent) => void; onToggleVisible: (id: string) => void; onToggleLock: (id: string) => void; renamingId: string | null; renameCaretMode: "all" | "prefix"; onRename: (id: string, name: string) => void; onCancelRename: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const isGroup = !!p.n.children?.length;
  const type = nodeType(p.n);
  return (
    <>
      <li key={p.n.id} className={p.selectedIds.includes(p.n.id) ? "sel" : ""}
        onClick={(e) => p.onSelect(p.n.id, createSelectionIntent(e, p.orderedIds))} style={{ paddingLeft: 8 + p.depth * 16 }}>
        {p.depth > 0 && <span className="indent-line" style={{ left: 4 + p.depth * 16 }} />}
        <button className="fold" title={collapsed ? "展开" : "折叠"}
          onClick={(e) => { e.stopPropagation(); if (isGroup) setCollapsed(!collapsed); }}>
          {isGroup && (
            <svg viewBox="0 0 8 8" className={collapsed ? "" : "open"}>
              <path d="M2 1.5l4 2.5-4 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span className={"type-ic " + TYPE_CLASS[type]} title={{ group: "组", list: "列表", image: "图片", text: "文本" }[type]}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{ICONS[type]}</svg>
        </span>
        {p.renamingId === p.n.id ? (
          <InlineRename
            name={p.n.name}
            caretMode={p.renameCaretMode}
            onCommit={(name) => p.onRename(p.n.id, name)}
            onCancel={p.onCancelRename}
          />
        ) : <span className="name">{p.n.name}</span>}
        <span className="type-tag">{type === "list" ? "list" : ""}</span>
        <button className="icon" title="可见"
          onClick={(e) => { e.stopPropagation(); p.onToggleVisible(p.n.id); }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            {p.n.visible ? <><path d="M1.5 8s2.6-4 6.5-4 6.5 4 6.5 4-2.6 4-6.5 4S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.8" /></>
              : <path d="M3 3l10 10M8 5.2a2.8 2.8 0 0 1 2.8 2.8M5 6.3A4 4 0 0 0 8.6 11M2.2 6.4A8.5 8.5 0 0 0 1.5 8s2.6 4 6.5 4c.9 0 1.7-.2 2.4-.5" />}
          </svg>
        </button>
        <button className="icon" title="锁定"
          onClick={(e) => { e.stopPropagation(); p.onToggleLock(p.n.id); }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            {p.n.locked ? <><rect x="4" y="7.5" width="8" height="6" rx="1.5" /><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" /></>
              : <path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2M4 7.5h8v6H4z" />}
          </svg>
        </button>
      </li>
      {!collapsed && [...(p.n.children ?? [])].sort((a, b) => b.zIndex - a.zIndex).map((c) => (
        <Row key={c.id} n={c} depth={p.depth + 1} selectedId={p.selectedId}
        selectedIds={p.selectedIds} orderedIds={p.orderedIds}
          onSelect={p.onSelect} onToggleVisible={p.onToggleVisible} onToggleLock={p.onToggleLock}
          renamingId={p.renamingId} renameCaretMode={p.renameCaretMode}
          onRename={p.onRename} onCancelRename={p.onCancelRename} />
      ))}
    </>
  );
}

export default function LayerPanel(p: Props) {
  const sorted = [...p.nodes].sort((a, b) => b.zIndex - a.zIndex); // 上层在前
  const orderedIds = flattenLayerIds(p.nodes);
  return (
    <aside className="layer-panel">
      <h3>图层</h3>
      <ul>
        {sorted.map((n) => (
        <Row key={n.id} n={n} depth={0} selectedId={p.selectedId} selectedIds={p.selectedIds} orderedIds={orderedIds} onSelect={p.onSelect}
            onToggleVisible={p.onToggleVisible} onToggleLock={p.onToggleLock}
            renamingId={p.renamingId} renameCaretMode={p.renameCaretMode}
            onRename={p.onRename} onCancelRename={p.onCancelRename} />
        ))}
      </ul>
    </aside>
  );
}
