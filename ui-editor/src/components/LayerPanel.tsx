import { useState } from "react";
import type { UINode } from "../types";
import { createSelectionIntent, flattenLayerIds, type SelectionIntent } from "../selection";
import InlineRename from "./InlineRename";
import { Icon, type IconName } from "./Icon";

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

const ICONS: Record<NodeType, IconName> = {
  group: "layers",
  list: "list",
  image: "image",
  text: "text",
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
          {isGroup && <Icon name="collapse" className={collapsed ? "" : "open"} size={13} />}
        </button>
        <span className={"type-ic " + TYPE_CLASS[type]} title={{ group: "组", list: "列表", image: "图片", text: "文本" }[type]}>
          <Icon name={ICONS[type]} size={15} />
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
          <Icon name={p.n.visible ? "eye" : "eye-off"} size={14} />
        </button>
        <button className="icon" title="锁定"
          onClick={(e) => { e.stopPropagation(); p.onToggleLock(p.n.id); }}>
          <Icon name={p.n.locked ? "lock" : "unlock"} size={14} />
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
