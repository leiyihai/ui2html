import { useState } from "react";
import type { ImageBinding, InteractionTemplate, LayoutValueMode, ResourceSlot, UINode, UIRect } from "../types";
import { CTRL_TYPES, type CtrlType } from "../types";
import { resourceSlotDefinitions } from "../resourceBinding";
import { createDefaultEditText } from "../controlType";
import { clampProgressValue, progressConfig } from "../progressControl";
import { normalizeLayoutValue, resolveLayoutValue } from "../layoutValues";

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

function gridLabel(x: number, y: number): string {
  return PARENT_GRID.find(([, px, py]) => px === x && py === y)?.[0] ?? "自定义";
}

/** 数值行：label 按住左右拖动快速调值。 */
function NumRow(p: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  inputStep?: number;
  set: (v: number, record?: boolean) => void;
}) {
  const step = p.step ?? 1;
  const precision = p.precision ?? 2;
  const factor = 10 ** precision;
  const normalize = (value: number) => {
    const rounded = Math.round(value * factor) / factor;
    return Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, rounded));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLLabelElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    p.set(p.value, true);
    const start = p.value;
    const move = (ev: PointerEvent) => p.set(normalize(start + (ev.clientX - e.clientX) * step), false);
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <div className="row">
      <label className="drag" onPointerDown={onPointerDown} title="按住左右拖动调整数值">{p.label}</label>
      <input type="number" value={p.value} step={p.inputStep} min={p.min} max={p.max}
        onChange={(ev) => p.set(normalize(Number(ev.target.value) || 0), true)} />
    </div>
  );
}

function InspectorSection(p: { title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(p.defaultOpen ?? true);
  return (
    <section className={`inspector-section ${open ? "open" : "closed"}`}>
      <button className="inspector-section-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="section-chevron">{open ? "⌄" : "›"}</span>
        <strong>{p.title}</strong>
        {p.summary && <span className="section-summary">{p.summary}</span>}
      </button>
      {open && <div className="inspector-section-body">{p.children}</div>}
    </section>
  );
}

function ResourceSlotRow(p: { slot: ResourceSlot; label: string; binding?: ImageBinding; onUnbind: (slot: ResourceSlot) => void }) {
  const src = p.binding?.image.toDataURL("image/png");
  return (
    <div className="resource-slot-row">
      <div className="resource-slot-label">
        <strong>{p.label}</strong>
        <small>{p.slot}</small>
      </div>
      {p.binding ? (
        <div className="resource-bound">
          <img src={src} alt="" />
          <span title={p.binding.name}>{p.binding.name}</span>
          <button className="icon" title="解除绑定" onClick={() => p.onUnbind(p.slot)}>✕</button>
        </div>
      ) : (
        <span className="resource-empty">空槽位 · Ctrl+B</span>
      )}
    </div>
  );
}

interface Props {
  node: UINode | null;
  rect: UIRect | null;
  parentDesignSize?: { width: number; height: number };
  /** 兼容旧测试/调用方；设备预览不在属性面板中设置。 */
  viewport?: { width: number; height: number };
  onUpdate: (patch: (n: UINode) => void, record?: boolean) => void;
  onSetCtrl: (id: string, type: CtrlType | null) => void;
  onUnbindResource: (id: string, slot: ResourceSlot) => void;
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
  const typeLabel = CTRL_TYPES.find((item) => item.value === n.ctrl?.type)?.label ?? "未标记";
  const isInteractive = n.ctrl?.type === "Button" || n.ctrl?.type === "CheckBox";
  const isSelectableControl = n.ctrl?.type === "CheckBox" || n.ctrl?.type === "RadioButton";
  const resourceSlots = resourceSlotDefinitions(n.ctrl?.type);
  const boundResourceCount = resourceSlots.filter((slot) => n.resources?.[slot.key]).length;
  const editableText = n.text ?? (n.ctrl?.type === "Edit" ? createDefaultEditText() : null);
  const isProgressControl = n.ctrl?.type === "ProgressBar" || n.ctrl?.type === "Slider";
  const progress = isProgressControl ? progressConfig(n) : null;
  const parentSize = p.parentDesignSize ?? { width: 1280, height: 720 };
  const layoutField = (key: "x" | "y" | "width" | "height") => {
    const fallback = key === "x" ? n.anchor.offsetX : key === "y" ? n.anchor.offsetY : key === "width" ? n.designRect.width : n.designRect.height;
    const value = n.layout?.[key];
    return {
      mode: value?.mode ?? "absolute" as LayoutValueMode,
      value: value?.mode === "relative" ? value.relative : value?.absolute ?? fallback,
    };
  };
  const updateLayoutField = (key: "x" | "y" | "width" | "height", mode: LayoutValueMode, value: number) => {
    const base = key === "x" || key === "width" ? parentSize.width : parentSize.height;
    p.onUpdate((node) => {
      const current = key === "x" ? node.anchor.offsetX : key === "y" ? node.anchor.offsetY : key === "width" ? node.designRect.width : node.designRect.height;
      const resolved = mode === "relative" ? value * base : value;
      node.layout = {
        x: node.layout?.x ?? normalizeLayoutValue("absolute", node.anchor.offsetX, parentSize.width),
        y: node.layout?.y ?? normalizeLayoutValue("absolute", node.anchor.offsetY, parentSize.height),
        width: node.layout?.width ?? normalizeLayoutValue("absolute", node.designRect.width, parentSize.width),
        height: node.layout?.height ?? normalizeLayoutValue("absolute", node.designRect.height, parentSize.height),
        ...node.layout,
        [key]: normalizeLayoutValue(mode, resolved, base),
      };
      if (key === "x") node.anchor.offsetX = resolved;
      if (key === "y") node.anchor.offsetY = resolved;
      if (key === "width") node.designRect.width = Math.max(1, resolved);
      if (key === "height") node.designRect.height = Math.max(1, resolved);
      if ((key === "width" || key === "height") && node.list && node.list.sizeConfirmed === false) {
        node.list = { ...node.list, sizeConfirmed: true };
      }
      // keep the local value used by older renderer paths in sync with the visible design result
      void current;
    });
  };

  return (
    <aside className="inspector">
      <div className="inspector-titlebar">
        <div>
          <h3>属性</h3>
          <span className="inspector-node-name" title={n.name}>{n.name}</span>
        </div>
        <span className="inspector-type-chip">{typeLabel}</span>
      </div>

      <InspectorSection title="节点" summary={typeLabel}>
        <div className="row"><label>名称</label>
          <input value={n.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="row"><label>控件类型</label>
          <select value={n.ctrl?.type ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              p.onSetCtrl(n.id, value ? value as CtrlType : null);
            }}>
            <option value="">未标记</option>
            {CTRL_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select></div>
        <div className="row"><label>可见</label>
          <input type="checkbox" checked={n.visible} onChange={(e) => set("visible", e.target.checked)} /></div>
        {isSelectableControl && (
          <div className="row"><label>{n.ctrl?.type === "CheckBox" ? "初始勾选" : "初始选中"}</label>
            <input type="checkbox" checked={Boolean(n.ctrl?.selected)}
              onChange={(e) => set("ctrl", { ...n.ctrl!, selected: e.target.checked ? true : undefined })} /></div>
        )}
        <div className="row"><label>透明度</label>
          <input type="range" min={0} max={1} step={0.01} value={n.opacity}
            onChange={(e) => set("opacity", +e.target.value)} /></div>
        <NumRow label="Z-Index" value={n.zIndex} set={(v) => set("zIndex", v || 0)} />
        <NumRow label="旋转" value={n.rotation} set={(v) => set("rotation", v || 0)} />
      </InspectorSection>

      {editableText && (
        <InspectorSection title={n.ctrl?.type === "Edit" ? "输入框文本" : "文本内容"} summary={`${Math.round(editableText.fontSize)} px`}>
          <textarea rows={2} value={editableText.content} placeholder={n.ctrl?.type === "Edit" ? "输入框中显示的文字" : undefined}
            onChange={(e) => set("text", { ...editableText, content: e.target.value })} />
          <div className="row"><label>排版</label>
            <select value={editableText.mode}
              onChange={(e) => set("text", { ...editableText, mode: e.target.value as any })}>
              <option value="auto">单行延伸</option>
              <option value="fixed">固定框（换行+裁切）</option>
              <option value="fit">自适应字号</option>
            </select></div>
          <NumRow label="字号" value={editableText.fontSize}
            set={(v) => set("text", { ...editableText, fontSize: Math.max(1, v || 1) })} />
          {editableText.mode === "fit" && (
            <NumRow label="最小字号" value={editableText.minFontSize}
              set={(v) => set("text", { ...editableText, minFontSize: Math.max(1, v || 1) })} />
          )}
          <div className="row"><label>颜色</label>
            <input type="color" value={toHex(editableText.color)}
              onChange={(e) => set("text", { ...editableText, color: e.target.value, textColor: e.target.value })} /></div>
          <div className="row"><label>水平对齐</label>
            <select value={editableText.horizontalAlign ?? "center"}
              onChange={(e) => set("text", { ...editableText, horizontalAlign: e.target.value as "left" | "center" | "right" })}>
              <option value="left">左</option><option value="center">居中</option><option value="right">右</option>
            </select></div>
          <div className="row"><label>垂直对齐</label>
            <select value={editableText.verticalAlign ?? "center"}
              onChange={(e) => set("text", { ...editableText, verticalAlign: e.target.value as "top" | "center" | "bottom" })}>
              <option value="top">上</option><option value="center">居中</option><option value="bottom">下</option>
            </select></div>
          <label className="chk"><input type="checkbox" checked={editableText.wordWrap ?? false}
            onChange={(e) => set("text", { ...editableText, wordWrap: e.target.checked })} /> 自动换行</label>
          <label className="chk"><input type="checkbox" checked={editableText.selfAdaptHeight ?? false}
            onChange={(e) => set("text", { ...editableText, selfAdaptHeight: e.target.checked })} /> 自适应高度</label>
          <label className="chk"><input type="checkbox" checked={editableText.shadow ?? false}
            onChange={(e) => set("text", { ...editableText, shadow: e.target.checked })} /> 文字投影</label>
          {editableText.shadow && <div className="row"><label>投影色</label>
            <input type="color" value={toHex(editableText.shadowColor ?? "#000000")}
              onChange={(e) => set("text", { ...editableText, shadowColor: e.target.value })} /></div>}
          <label className="chk"><input type="checkbox" checked={editableText.border ?? false}
            onChange={(e) => set("text", { ...editableText, border: e.target.checked })} /> 文字描边</label>
          {editableText.border && <div className="row"><label>描边色</label>
            <input type="color" value={toHex(editableText.borderColor ?? "#000000")}
              onChange={(e) => set("text", { ...editableText, borderColor: e.target.value })} /></div>}
          <NumRow label="文字缩放" value={editableText.scale ?? 1} step={0.01} min={0.1} max={4} precision={2} inputStep={0.01}
            set={(v) => set("text", { ...editableText, scale: Math.max(0.1, v || 1) })} />
          <NumRow label="行间距" value={editableText.lineExtraSpace ?? 0} step={1}
            set={(v) => set("text", { ...editableText, lineExtraSpace: v || 0 })} />
          <label className="chk"><input type="checkbox" checked={editableText.autoOmission ?? false}
            onChange={(e) => set("text", { ...editableText, autoOmission: e.target.checked })} /> 自动省略</label>
          {editableText.mode !== "auto" && <p className="hint">文本框宽高在“位置与尺寸校正”中调整。</p>}
        </InspectorSection>
      )}

      {n.list && (
        <InspectorSection title="列表布局" summary={n.list.type === "grid" ? `${n.list.columns} 列` : n.list.type === "vertical" ? "纵向" : "横向"}>
          <div className="row"><label>排列</label>
            <select value={n.list.type}
              onChange={(e) => set("list", { ...n.list!, type: e.target.value as any })}>
              <option value="horizontal">横向</option>
              <option value="vertical">纵向</option>
              <option value="grid">网格</option>
            </select></div>
          <NumRow label="间距" value={Math.round(n.list.spacing)}
            set={(v) => set("list", { ...n.list!, spacing: Math.max(0, v) })} />
          {n.list.type === "grid" && <NumRow label="列数" value={n.list.columns}
            set={(v) => set("list", { ...n.list!, columns: Math.max(1, v || 1) })} />}
          <div className="subsection-label">内边距</div>
          <div className="inset-grid">
            <NumRow label="左" value={Math.round(n.list.padding.left)} set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, left: Math.max(0, v) } })} />
            <NumRow label="右" value={Math.round(n.list.padding.right)} set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, right: Math.max(0, v) } })} />
            <NumRow label="上" value={Math.round(n.list.padding.top)} set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, top: Math.max(0, v) } })} />
            <NumRow label="下" value={Math.round(n.list.padding.bottom)} set={(v) => set("list", { ...n.list!, padding: { ...n.list!.padding, bottom: Math.max(0, v) } })} />
          </div>
          <div className="subsection-label">预览 item</div>
          <div className="row"><label>模板节点</label>
            <select value={n.list.previewItemId ?? ""}
              onChange={(e) => set("list", { ...n.list!, previewItemId: e.target.value || undefined, previewItemCount: e.target.value ? Math.max(1, n.list!.previewItemCount ?? 1) : undefined })}>
              <option value="">不指定（使用真实子节点）</option>
              {(n.children ?? []).map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
            </select></div>
          {n.list.previewItemId && <NumRow label="重复数量" value={n.list.previewItemCount ?? 1} min={1} max={99}
            set={(v) => set("list", { ...n.list!, previewItemCount: Math.max(1, Math.min(99, Math.round(v || 1))) })} />}
          {n.list.sizeConfirmed === false && <div className="list-size-warning">列表尺寸待确认：当前尺寸可能只是单个 item 的大小。</div>}
          {n.list.sizeConfirmed === false && <button className="btn" onClick={() => set("list", { ...n.list!, sizeConfirmed: true })}>确认当前尺寸</button>}
        </InspectorSection>
      )}

      {progress && (
        <InspectorSection title="进度控件" summary={`${progress.value.toFixed(2)} · ${progress.direction === "horizontal" ? "水平" : "垂直"}`}>
          <NumRow label="进度值" value={progress.value} step={0.01} min={0} max={1} precision={2} inputStep={0.01}
            set={(value) => set("progress", { ...progress, value: clampProgressValue(value) })} />
          <div className="row"><label>方向</label>
            <select value={progress.direction}
              onChange={(e) => set("progress", { ...progress, direction: e.target.value as "horizontal" | "vertical" })}>
              <option value="horizontal">水平</option>
              <option value="vertical">垂直</option>
            </select>
          </div>
          <label className="chk"><input type="checkbox" checked={progress.reverse}
            onChange={(e) => set("progress", { ...progress, reverse: e.target.checked })} /> 反向</label>
        </InspectorSection>
      )}

      {resourceSlots.length > 0 && (
        <InspectorSection title="资源" summary={`${boundResourceCount}/${resourceSlots.length}`}>
          <p className="hint">可在资源绑定页签中查看缩略图并手动绑定，也可以选择图片后按 Ctrl+B。</p>
          <div className="resource-slots">
            {resourceSlots.map((slot) => (
              <ResourceSlotRow key={slot.key} slot={slot.key} label={slot.label}
                binding={n.resources?.[slot.key]}
                onUnbind={(key) => p.onUnbindResource(n.id, key)} />
            ))}
          </div>
        </InspectorSection>
      )}

      <InspectorSection title="引擎对齐" summary={`父级 ${gridLabel(n.anchor.parentX, n.anchor.parentY)}`}>
        <p className="hint correction-note">沿用九宫格设置控件相对父节点的对齐方式，同时保持当前视觉位置。</p>
        <div className="subsection-label">Parent Anchor · HorizontalAlignment / VerticalAlignment</div>
        <div className="grid">
          {PARENT_GRID.map(([label, x, y]) => (
            <button key={label} className={n.anchor.parentX === x && n.anchor.parentY === y ? "on" : ""}
              onClick={() => p.onReanchor({ ...n.anchor, parentX: x, parentY: y })}>{label}</button>
          ))}
        </div>
        <div className="subsection-label">Self Anchor · 控件自身锚点</div>
        <div className="grid">
          {SELF_GRID.map(([label, x, y]) => (
            <button key={label} className={n.anchor.selfX === x && n.anchor.selfY === y ? "on" : ""}
              onClick={() => p.onReanchor({ ...n.anchor, selfX: x, selfY: y })}>{label}</button>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="位置与尺寸校正" summary="PSD 视觉微调">
        <p className="hint correction-note">PSD 导入的位置和尺寸默认保留；这里仅用于少量视觉校正。</p>
        {(["x", "y", "width", "height"] as const).map((key) => {
          const field = layoutField(key);
          const label = key === "x" ? "X" : key === "y" ? "Y" : key === "width" ? "宽" : "高";
          return <div className="layout-value-row" key={key}>
            <label className="layout-value-label">{label}</label>
            <select value={field.mode} onChange={(e) => updateLayoutField(key, e.target.value as LayoutValueMode, field.mode === "relative"
              ? resolveLayoutValue(n.layout?.[key], key === "x" || key === "width" ? parentSize.width : parentSize.height, field.value)
              : field.value)}>
              <option value="absolute">绝对</option><option value="relative">相对</option>
            </select>
            <input type="number" step={field.mode === "relative" ? 0.01 : 1} value={field.value}
              onChange={(e) => updateLayoutField(key, field.mode, Number(e.target.value) || 0)} />
          </div>;
        })}
        <div className="subsection-label">尺寸（设计像素）</div>
        {p.rect && <div className="layout-readout"><span>当前布局</span><strong>{Math.round(p.rect.x)}, {Math.round(p.rect.y)} · {Math.round(p.rect.width)} × {Math.round(p.rect.height)}</strong></div>}
      </InspectorSection>

      <InspectorSection title="交互" summary={isInteractive ? "可配置" : "模板库"} defaultOpen={isInteractive}>
        {isInteractive && (
          <div className="row"><label>绑定模板</label>
            <select value={n.ctrl?.templateId ?? ""}
              onChange={(e) => set("ctrl", { ...n.ctrl!, templateId: e.target.value || undefined })}>
              <option value="">（无）</option>
              {p.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
        )}
        <div className="tpl-list">
          {p.templates.length === 0 && <p className="hint">还没有模板，新建一个。</p>}
          {p.templates.map((t) => (
            <div key={t.id} className="tpl">
              <div className="tpl-head">
                <input value={t.name} title="模板名"
                  onChange={(e) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x))} />
                <button className="icon" title="删除模板" onClick={() => p.onTemplates(p.templates.filter((x) => x.id !== t.id))}>✕</button>
              </div>
              <NumRow label="点击缩放" value={t.pressScale} step={0.01}
                set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressScale: v || 1 } : x))} />
              <NumRow label="点击透明度" value={t.pressOpacity} step={0.01}
                set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressOpacity: v } : x))} />
              <div className="row"><label>点击高亮色</label>
                <input type="color" value={t.pressTint ? toHex(t.pressTint) : "#ffffff"}
                  onChange={(e) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressTint: e.target.value + "40" } : x))} />
                <button className="icon" onClick={() => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressTint: null } : x))} title="清除高亮">✕</button></div>
              <NumRow label="动画时长" value={t.duration} step={0.01}
                set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, duration: v || 0.1 } : x))} />
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => p.onTemplates([...p.templates, {
          id: "t" + Date.now(), name: "模板" + (p.templates.length + 1),
          pressScale: 0.95, pressOpacity: 0.8, pressTint: null, duration: 0.1,
        }])}>＋ 新建模板</button>
      </InspectorSection>

      <InspectorSection title="工程资源" summary={n.assetPath ?? (n.image ? "保存后生成" : "无")} defaultOpen={false}>
        <div className="source-readout"><span>节点 ID</span><strong>{n.id}</strong></div>
        <div className="source-readout"><span>资源路径</span><strong>{n.assetPath ?? (n.image ? "首次保存时生成" : "无")}</strong></div>
      </InspectorSection>
    </aside>
  );
}
