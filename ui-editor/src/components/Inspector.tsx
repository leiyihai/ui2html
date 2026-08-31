import type { InteractionTemplate, UINode, UIRect } from "../types";
import { CTRL_TYPES, type CtrlType } from "../types";

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

/** 数值行：label 按住左右拖动快速调值（起点 record 一次，拖动中不记录历史） */
// 顶层组件（不能在 Inspector 内部定义：内联组件每次渲染类型变化会导致 DOM 重建、拖动监听丢失）
function NumRow(p2: { label: string; value: number; step?: number; set: (v: number, record?: boolean) => void }) {
  const step = p2.step ?? 1;
  const onPointerDown = (e: React.PointerEvent<HTMLLabelElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    p2.set(p2.value, true); // 快照拖动前
    const start = p2.value;
    const move = (ev: PointerEvent) =>
      p2.set(start + Math.round((ev.clientX - e.clientX) * step * 100) / 100, false);
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <div className="row">
      <label className="drag" onPointerDown={onPointerDown} title="按住左右拖动调整数值">{p2.label}</label>
      <input type="number" value={p2.value}
        onChange={(ev) => p2.set(+ev.target.value || 0, true)} />
    </div>
  );
}

interface Props {
  node: UINode | null;
  rect: UIRect | null;
  viewport: { width: number; height: number };
  /** record=false 时不进撤销历史（拖动微调中间态） */
  onUpdate: (patch: (n: UINode) => void, record?: boolean) => void;
  onReanchor: (a: { parentX: number; parentY: number; selfX: number; selfY: number }) => void;
  templates: InteractionTemplate[];
  onTemplates: (t: InteractionTemplate[]) => void;
}

export default function Inspector(p: Props) {
  const n = p.node;
  if (!n) return <aside className="inspector"><h3>属性</h3><p className="hint">选中一个图层</p></aside>;

  const set = <K extends keyof UINode>(key: K, val: UINode[K], record = true) =>
    p.onUpdate((x) => { (x as any)[key] = val; }, record);

  const toHex = (color: string): string => {
    const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) return "#" + m.slice(1).map((v) => (+v).toString(16).padStart(2, "0")).join("");
    return /^#[0-9a-fA-F]{6}/.test(color) ? color.slice(0, 7) : "#ffffff";
  };
  const hex6 = (color: string) => toHex(color);

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
      {n.list && (
        <>
          <h4>List</h4>
          <div className="row"><label>类型</label>
            <select value={n.list.type}
              onChange={(e) => set("list", { ...n.list!, type: e.target.value as any })}>
              <option value="horizontal">横向</option>
              <option value="vertical">纵向</option>
              <option value="grid">网格</option>
            </select></div>
          <NumRow label="间距" value={Math.round(n.list.spacing)}
            set={(v) => set("list", { ...n.list!, spacing: Math.max(0, v) })} />
          {n.list.type === "grid" && (
            <NumRow label="列数" value={n.list.columns}
              set={(v) => set("list", { ...n.list!, columns: Math.max(1, v || 1) })} />
          )}
          <NumRow label="边距L" value={Math.round(n.list.padding.left)}
            set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, left: Math.max(0, v) } })} />
          <NumRow label="边距R" value={Math.round(n.list.padding.right)}
            set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, right: Math.max(0, v) } })} />
          <NumRow label="边距T" value={Math.round(n.list.padding.top)}
            set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, top: Math.max(0, v) } })} />
          <NumRow label="边距B" value={Math.round(n.list.padding.bottom)}
            set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, bottom: Math.max(0, v) } })} />
        </>
      )}
      <div className="row"><label>可见</label>
        <input type="checkbox" checked={n.visible} onChange={(e) => set("visible", e.target.checked)} /></div>
      <div className="row"><label>透明度</label>
        <input type="range" min={0} max={1} step={0.01} value={n.opacity}
          onChange={(e) => set("opacity", +e.target.value)} /></div>
      <NumRow label="Z-Index" value={n.zIndex} set={(v) => set("zIndex", v || 0)} />
      <NumRow label="旋转" value={n.rotation} set={(v) => set("rotation", v || 0)} />
      {n.text && (
        <>
          <h4>文本内容</h4>
          <textarea rows={2} value={n.text.content}
            onChange={(e) => set("text", { ...n.text!, content: e.target.value })} />
          <div className="row"><label>模式</label>
            <select value={n.text.mode}
              onChange={(e) => set("text", { ...n.text!, mode: e.target.value as any })}>
              <option value="auto">单行延伸</option>
              <option value="fixed">固定框（换行+裁切）</option>
              <option value="fit">自适应字号</option>
            </select></div>
          <NumRow label="字号" value={n.text.fontSize}
            set={(v) => set("text", { ...n.text!, fontSize: Math.max(1, v || 1) })} />
          {n.text.mode === "fit" && (
            <NumRow label="最小字号" value={n.text.minFontSize}
              set={(v) => set("text", { ...n.text!, minFontSize: Math.max(1, v || 1) })} />
          )}
          <div className="row"><label>颜色</label>
            <input type="color" value={toHex(n.text.color)}
              onChange={(e) => set("text", { ...n.text!, color: e.target.value })} /></div>
          {n.text.mode !== "auto" && (
            <p className="hint">文本框宽高用下方「尺寸」调整；内容超出框会被裁切</p>
          )}
        </>
      )}

      <h4>控件类型</h4>
      <div className="row"><label>类型</label>
        <select value={n.ctrl?.type ?? ""}
          onChange={(e) => {
            const t = e.target.value;
            if (t) set("ctrl", { ...(n.ctrl ?? {}), type: t as CtrlType });
            else set("ctrl", undefined);
          }}>
          <option value="">未标记</option>
          {CTRL_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></div>
      {(n.ctrl?.type === "Button" || n.ctrl?.type === "CheckBox") && (
        <div className="row"><label>交互模板</label>
          <select value={n.ctrl.templateId ?? ""}
            onChange={(e) => set("ctrl", { ...n.ctrl!, templateId: e.target.value || undefined })}>
            <option value="">（无）</option>
            {p.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
      )}
      <h4>交互模板</h4>
      <div className="tpl-list">
        {p.templates.length === 0 && <p className="hint">还没有模板，新建一个</p>}
        {p.templates.map((t) => (
          <div key={t.id} className="tpl">
            <div className="tpl-head">
              <input value={t.name} title="模板名"
                onChange={(e) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x))} />
              <button className="icon" title="删除模板"
                onClick={() => p.onTemplates(p.templates.filter((x) => x.id !== t.id))}>✕</button>
            </div>
            <NumRow label="点击缩放" value={t.pressScale} step={0.01}
              set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressScale: v || 1 } : x))} />
            <NumRow label="点击透明度" value={t.pressOpacity} step={0.01}
              set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressOpacity: v } : x))} />
            <div className="row"><label>点击高亮色</label>
              <input type="color" value={t.pressTint ? hex6(t.pressTint) : "#ffffff"}
                onChange={(e) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressTint: e.target.value + "40" } : x))} />
              <button className="icon" onClick={() => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressTint: null } : x))}
                title="清除高亮">✕</button></div>
            <NumRow label="动画时长" value={t.duration} step={0.01}
              set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, duration: v || 0.1 } : x))} />
          </div>
        ))}
      </div>
      <button className="btn" onClick={() => p.onTemplates([...p.templates, {
        id: "t" + Date.now(), name: "模板" + (p.templates.length + 1),
        pressScale: 0.95, pressOpacity: 0.8, pressTint: null, duration: 0.1,
      }])}>＋ 新建模板</button>

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
      <NumRow label="X" value={Math.round(n.anchor.offsetX)}
        set={(v) => set("anchor", { ...n.anchor, offsetX: v })} />
      <NumRow label="Y" value={Math.round(n.anchor.offsetY)}
        set={(v) => set("anchor", { ...n.anchor, offsetY: v })} />

      <h4>尺寸（设计像素）</h4>
      <NumRow label="宽" value={Math.round(n.designRect.width)}
        set={(v) => set("designRect", { ...n.designRect, width: Math.max(1, v || 1) })} />
      <NumRow label="高" value={Math.round(n.designRect.height)}
        set={(v) => set("designRect", { ...n.designRect, height: Math.max(1, v || 1) })} />

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
