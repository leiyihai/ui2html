import type { UINode, UIRect } from "../types";

const PARENT_GRID: [string, number, number][] = [
  ["↖", 0, 0], ["↑", 0.5, 0], ["↗", 1, 0],
  ["←", 0, 0.5], ["●", 0.5, 0.5], ["→", 1, 0.5],
  ["↙", 0, 1], ["↓", 0.5, 1], ["↘", 1, 1],
];
const SELF_GRID: [string, number, number][] = [
  ["↖", 0, 0], ["↑", 0.5, 0], ["↗", 1, 0],
  ["←", 0, 0.5], ["●", 0.5, 0.5], ["→", 1, 0.5],
  ["↙", 0, 1], ["↓", 0.5, 1], ["↘", 1, 1],
];

interface Props {
  node: UINode | null;
  rect: UIRect | null;
  viewport: { width: number; height: number };
  onUpdate: (patch: (n: UINode) => void) => void;
  onReanchor: (a: { parentX: number; parentY: number; selfX: number; selfY: number }) => void;
}

export default function Inspector(p: Props) {
  const n = p.node;
  if (!n) return <aside className="inspector"><h3>属性</h3><p className="hint">选中一个图层</p></aside>;

  const set = <K extends keyof UINode>(key: K, val: UINode[K]) =>
    p.onUpdate((x) => { (x as any)[key] = val; });

  return (
    <aside className="inspector">
      <h3>属性</h3>
      <div className="row"><label>名称</label>
        <input value={n.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div className="row"><label>模式</label>
        <select value={n.adaptation.mode} onChange={(e) => set("adaptation", { mode: e.target.value as any })}>
          <option value="anchor">anchor</option>
          <option value="scale">scale</option>
          <option value="stretch">stretch</option>
        </select></div>
      <div className="row"><label>可见</label>
        <input type="checkbox" checked={n.visible} onChange={(e) => set("visible", e.target.checked)} /></div>
      <div className="row"><label>透明度</label>
        <input type="range" min={0} max={1} step={0.01} value={n.opacity}
          onChange={(e) => set("opacity", +e.target.value)} /></div>
      <div className="row"><label>Z-Index</label>
        <input type="number" value={n.zIndex} onChange={(e) => set("zIndex", +e.target.value || 0)} /></div>
      <div className="row"><label>旋转</label>
        <input type="number" value={n.rotation} onChange={(e) => set("rotation", +e.target.value || 0)} /></div>

      <h4>Parent Anchor（改模式为 anchor 时生效）</h4>
      <div className="grid">
        {PARENT_GRID.map(([t, x, y]) => (
          <button key={t} className={n.anchor.parentX === x && n.anchor.parentY === y ? "on" : ""}
            onClick={() => p.onReanchor({ ...n.anchor, parentX: x, parentY: y })}>{t}</button>
        ))}
      </div>
      <h4>Self Anchor</h4>
      <div className="grid">
        {SELF_GRID.map(([t, x, y]) => (
          <button key={t} className={n.anchor.selfX === x && n.anchor.selfY === y ? "on" : ""}
            onClick={() => p.onReanchor({ ...n.anchor, selfX: x, selfY: y })}>{t}</button>
        ))}
      </div>
      <label className="chk"><input type="checkbox" checked={n.anchor.safeArea}
        onChange={(e) => set("anchor", { ...n.anchor, safeArea: e.target.checked })} /> 绑定 Safe Area</label>
      <h4>Offset（设计像素）</h4>
      <div className="row"><label>X</label>
        <input type="number" value={Math.round(n.anchor.offsetX)}
          onChange={(e) => set("anchor", { ...n.anchor, offsetX: +e.target.value || 0 })} /></div>
      <div className="row"><label>Y</label>
        <input type="number" value={Math.round(n.anchor.offsetY)}
          onChange={(e) => set("anchor", { ...n.anchor, offsetY: +e.target.value || 0 })} /></div>

      <h4>尺寸（设计像素）</h4>
      <div className="row"><label>宽</label>
        <input type="number" min={1} value={Math.round(n.designRect.width)}
          onChange={(e) => set("designRect", { ...n.designRect, width: Math.max(1, +e.target.value || 1) })} /></div>
      <div className="row"><label>高</label>
        <input type="number" min={1} value={Math.round(n.designRect.height)}
          onChange={(e) => set("designRect", { ...n.designRect, height: Math.max(1, +e.target.value || 1) })} /></div>

      <h4>当前布局（{p.viewport.width}×{p.viewport.height}）</h4>
      {p.rect && (
        <div className="row"><label>位置</label>
          <span>{Math.round(p.rect.x)}, {Math.round(p.rect.y)}</span></div>
      )}
      {p.rect && (
        <div className="row"><label>尺寸</label>
          <span>{Math.round(p.rect.width)} × {Math.round(p.rect.height)}</span></div>
      )}
      <div className="row"><label>设计源</label>
        <span title={`PSD 图层 ${n.psd.layerId}`}>{n.psd.originalX},{n.psd.originalY} {n.psd.originalWidth}×{n.psd.originalHeight}</span></div>
    </aside>
  );
}
