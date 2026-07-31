import type { UINode } from "../types";

interface Props {
  nodes: UINode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
}

export default function LayerPanel(p: Props) {
  const sorted = [...p.nodes].sort((a, b) => b.zIndex - a.zIndex); // 上层在前
  return (
    <aside className="layer-panel">
      <h3>图层 ({p.nodes.length})</h3>
      <ul>
        {sorted.map((n) => (
          <li key={n.id}
            className={n.id === p.selectedId ? "sel" : ""}
            onClick={() => p.onSelect(n.id)}>
            <button className="icon" title="可见"
              onClick={(e) => { e.stopPropagation(); p.onToggleVisible(n.id); }}>
              {n.visible ? "👁" : "🚫"}
            </button>
            <button className="icon" title="锁定"
              onClick={(e) => { e.stopPropagation(); p.onToggleLock(n.id); }}>
              {n.locked ? "🔒" : "🔓"}
            </button>
            <span className="name">{n.name}</span>
            <span className="mode">{n.adaptation.mode}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
