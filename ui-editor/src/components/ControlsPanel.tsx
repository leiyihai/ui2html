import type { CtrlType, UINode } from "../types";
import { CTRL_TYPES } from "../types";

interface Props {
  nodes: UINode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSetCtrl: (id: string, type: CtrlType | null) => void;
}

function Row(p: { n: UINode; depth: number; selected: boolean; onSelect: (id: string) => void; onSetCtrl: (id: string, t: CtrlType | null) => void }) {
  return (
    <>
      <li className={p.selected ? "sel" : ""} onClick={() => p.onSelect(p.n.id)}
        style={{ paddingLeft: 8 + p.depth * 16 }}>
        <span className="name">{p.n.name}</span>
        <select className="ctrl-badge" value={p.n.ctrl?.type ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => p.onSetCtrl(p.n.id, (e.target.value || null) as CtrlType | null)}>
          <option value="">未标记</option>
          {CTRL_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </li>
      {p.n.children?.map((c) => (
        <Row key={c.id} n={c} depth={p.depth + 1} selected={p.selected}
          onSelect={p.onSelect} onSetCtrl={p.onSetCtrl} />
      ))}
    </>
  );
}

/** 控件工作区左侧：图层树 + 每行控件类型标记（下拉选择） */
export default function ControlsPanel(p: Props) {
  const sorted = [...p.nodes].sort((a, b) => b.zIndex - a.zIndex);
  return (
    <aside className="layer-panel controls-panel">
      <h3>控件类型</h3>
      <ul>
        {sorted.map((n) => (
          <Row key={n.id} n={n} depth={0} selected={n.id === p.selectedId}
            onSelect={p.onSelect} onSetCtrl={p.onSetCtrl} />
        ))}
      </ul>
    </aside>
  );
}
