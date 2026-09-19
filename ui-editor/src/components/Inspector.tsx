import { useRef, useState } from "react";
import type { ImageBinding, InteractionTemplate, LayoutValueMode, ResourceSlot, UINode, UIRect } from "../types";
import { CTRL_TYPES, type CtrlType } from "../types";
import { resourceSlotDefinitions } from "../resourceBinding";
import { createDefaultEditText } from "../controlType";
import { clampProgressValue, progressConfig } from "../progressControl";
import { normalizeLayoutValue } from "../layoutValues";
import { Icon, type IconName } from "./Icon";

const PARENT_GRID: [IconName, number, number][] = [
  ["move-up-left", 0, 0], ["arrow-up", 0.5, 0], ["move-up-right", 1, 0],
  ["arrow-left", 0, 0.5], ["circle", 0.5, 0.5], ["arrow-right", 1, 0.5],
  ["move-down-left", 0, 1], ["arrow-down", 0.5, 1], ["move-down-right", 1, 1],
];
const SELF_GRID: [IconName, number, number][] = [
  ["move-up-left", 0, 0], ["arrow-up", 0.5, 0], ["move-up-right", 1, 0],
  ["arrow-left", 0, 0.5], ["circle", 0.5, 0.5], ["arrow-right", 1, 0.5],
  ["move-down-left", 0, 1], ["arrow-down", 0.5, 1], ["move-down-right", 1, 1],
];

export function horizontalPointerDelta(clientX: number, startX: number): number {
  return clientX - startX;
}

export function arrowStepDirection(key: string): -1 | 0 | 1 {
  if (key === "ArrowUp" || key === "ArrowRight") return 1;
  if (key === "ArrowDown" || key === "ArrowLeft") return -1;
  return 0;
}

function DragNumberInput(p: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  className?: string;
  onChange: (value: number, record?: boolean) => void;
}) {
  const step = p.step ?? 1;
  const precision = p.precision ?? (step < 1 ? 2 : 0);
  const factor = 10 ** precision;
  const normalize = (value: number) => {
    const rounded = Math.round(value * factor) / factor;
    return Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, rounded));
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const direction = arrowStepDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    p.onChange(normalize(p.value + direction * step), true);
  };
  return <input className={`drag-number${p.className ? ` ${p.className}` : ""}`} type="number" value={p.value} step={p.step} min={p.min} max={p.max}
    title="点击输入编辑；聚焦后使用方向键调整"
    onKeyDown={onKeyDown}
    onChange={(event) => p.onChange(normalize(Number(event.target.value) || 0), true)} />;
}

function DragValueLabel(p: {
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number, record?: boolean) => void;
  children: React.ReactNode;
}) {
  const dragRef = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
  const precision = p.step < 1 ? 2 : 0;
  const factor = 10 ** precision;
  const normalize = (value: number) => {
    const rounded = Math.round(value * factor) / factor;
    return Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, rounded));
  };
  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startValue: p.value };
    p.onChange(p.value, true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = horizontalPointerDelta(event.clientX, drag.startX);
    if (Math.abs(distance) <= 1) return;
    event.preventDefault();
    p.onChange(normalize(drag.startValue + distance * p.step), false);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };
  return <div className="layout-value-label">
    <span className="layout-value-copy">{p.children}</span>
    <span className="value-drag-zone" title="按住左右拖动调整数值"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
  </div>;
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
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    p.set(p.value, true);
    const start = p.value;
    const move = (ev: PointerEvent) => p.set(normalize(start + horizontalPointerDelta(ev.clientX, e.clientX) * step), false);
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <div className="row">
      <label>{p.label}</label>
      <span className="value-drag-zone" title="按住左右拖动调整数值" onPointerDown={onPointerDown} />
      <DragNumberInput value={p.value} step={p.inputStep ?? p.step} min={p.min} max={p.max} precision={precision}
        onChange={(value, record) => p.set(normalize(value), record)} />
    </div>
  );
}

function InspectorSection(p: { title: string; help?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(p.defaultOpen ?? true);
  return (
    <section className={`inspector-section ${open ? "open" : "closed"}`}>
      <div className="inspector-section-head">
        <button type="button" className="inspector-section-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <Icon name={open ? "expand" : "collapse"} className="section-chevron" size={14} />
          <strong title={p.help}>{p.title}</strong>
        </button>
      </div>
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
          <button className="icon" title="解除绑定" onClick={() => p.onUnbind(p.slot)}><Icon name="close" size={14} /></button>
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
  const [anchorTab, setAnchorTab] = useState<"parent" | "self">("parent");
  if (!n) return <aside className="inspector"><h3>属性</h3><p className="hint">选中一个图层</p></aside>;

  const set = <K extends keyof UINode>(key: K, val: UINode[K], record = true) =>
    p.onUpdate((x) => { (x as any)[key] = val; }, record);
  const toHex = (color: string): string => {
    const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) return "#" + m.slice(1).map((v) => (+v).toString(16).padStart(2, "0")).join("");
    return /^#[0-9a-fA-F]{6}/.test(color) ? color.slice(0, 7) : "#ffffff";
  };
  const isInteractive = n.ctrl?.type === "Button" || n.ctrl?.type === "CheckBox";
  const isSelectableControl = n.ctrl?.type === "CheckBox" || n.ctrl?.type === "RadioButton";
  const resourceSlots = resourceSlotDefinitions(n.ctrl?.type);
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
  const updateLayoutField = (key: "x" | "y" | "width" | "height", mode: LayoutValueMode, value: number, record = true) => {
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
    }, record);
  };
  const toggleLayoutMode = (key: "x" | "y" | "width" | "height", field: ReturnType<typeof layoutField>) => {
    const base = key === "x" || key === "width" ? parentSize.width : parentSize.height;
    const absoluteValue = field.mode === "relative" ? field.value * base : field.value;
    const nextMode: LayoutValueMode = field.mode === "relative" ? "absolute" : "relative";
    const nextValue = nextMode === "relative" ? (base > 0 ? absoluteValue / base : 0) : absoluteValue;
    updateLayoutField(key, nextMode, nextValue);
  };

  return (
    <aside className="inspector">
      <div className="inspector-titlebar">
        <div>
          <h3>属性</h3>
          <span className="inspector-node-name" title={n.name}>{n.name}</span>
        </div>
      </div>

      <InspectorSection title="节点">
        <div className="row"><label>名称</label>
          <input className="node-name-field" value={n.name} onChange={(e) => set("name", e.target.value)} /></div>
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
        <InspectorSection title={n.ctrl?.type === "Edit" ? "输入框文本" : "文本内容"}
          help={editableText.mode !== "auto" ? "文本框宽高在“位置与尺寸”中调整。" : "设置文本内容、字号、颜色和排版方式。"}>
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
              onChange={(e) => p.onUpdate((x) => {
                x.text = { ...editableText, verticalAlign: e.target.value as "top" | "center" | "bottom" };
                // 手动指定垂直对齐后，以用户设置为准，不再套用 PSD 原始基线。
                if (x.psd) delete x.psd.originalBaseline;
              })}>
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
        </InspectorSection>
      )}

      {n.list && (
        <InspectorSection title="列表布局">
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
        <InspectorSection title="进度控件">
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
        <InspectorSection title="资源" help="可在资源绑定页签中查看缩略图并手动绑定，也可以选择图片后按 Ctrl+B。">
          <div className="resource-slots">
            {resourceSlots.map((slot) => (
              <ResourceSlotRow key={slot.key} slot={slot.key} label={slot.label}
                binding={n.resources?.[slot.key]}
                onUnbind={(key) => p.onUnbindResource(n.id, key)} />
            ))}
          </div>
        </InspectorSection>
      )}

      <InspectorSection title="布局对齐" help="父级对齐对应引擎的水平/垂直对齐；自身锚点决定控件使用哪个位置作为定位基准。">
        <div className="anchor-tabs" role="tablist" aria-label="布局对齐设置">
          <button type="button" role="tab" aria-selected={anchorTab === "parent"}
            className={anchorTab === "parent" ? "on" : ""} onClick={() => setAnchorTab("parent")}>
            父级对齐
          </button>
          <button type="button" role="tab" aria-selected={anchorTab === "self"}
            className={anchorTab === "self" ? "on" : ""} onClick={() => setAnchorTab("self")}>
            自身锚点
          </button>
        </div>
        {anchorTab === "parent" ? (
          <div role="tabpanel" aria-label="父级对齐">
            <div className="subsection-label">对齐位置</div>
            <div className="grid">
              {PARENT_GRID.map(([icon, x, y], index) => (
                <button key={`${icon}-${index}`} className={n.anchor.parentX === x && n.anchor.parentY === y ? "on" : ""}
                  onClick={() => p.onReanchor({ ...n.anchor, parentX: x, parentY: y })}><Icon name={icon} size={13} /></button>
              ))}
            </div>
          </div>
        ) : (
          <div role="tabpanel" aria-label="自身锚点">
            <div className="subsection-label">锚点位置</div>
            <div className="grid">
              {SELF_GRID.map(([icon, x, y], index) => (
                <button key={`${icon}-${index}`} className={n.anchor.selfX === x && n.anchor.selfY === y ? "on" : ""}
                  onClick={() => p.onReanchor({ ...n.anchor, selfX: x, selfY: y })}><Icon name={icon} size={13} /></button>
              ))}
            </div>
          </div>
        )}
      </InspectorSection>

      <InspectorSection title="位置与尺寸" help="PSD 导入的位置和尺寸默认保留；这里可直接微调节点的显示结果。">
        {(["x", "y", "width", "height"] as const).map((key) => {
          const field = layoutField(key);
          const label = key === "x" ? "X" : key === "y" ? "Y" : key === "width" ? "宽" : "高";
          return <div className="layout-value-row" key={key}>
            <DragValueLabel value={field.value} step={field.mode === "relative" ? 0.01 : 1}
              onChange={(value, record) => updateLayoutField(key, field.mode, value, record)}>
              <strong>{label}</strong><span>{field.mode === "relative" ? "相对" : "绝对"}</span>
            </DragValueLabel>
            <DragNumberInput step={field.mode === "relative" ? 0.01 : 1} precision={field.mode === "relative" ? 2 : 0}
              className="layout-drag-number" value={field.value}
              onChange={(value, record) => updateLayoutField(key, field.mode, value, record)} />
            <button type="button" className="layout-mode-button" title="点击切换相对/绝对值" aria-label="切换相对/绝对值"
              onClick={() => toggleLayoutMode(key, field)} aria-pressed={field.mode === "relative"}>
              <Icon name="move-horizontal" size={14} />
            </button>
          </div>;
        })}
      </InspectorSection>

      <InspectorSection title="交互" defaultOpen={isInteractive}>
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
                <button className="icon" title="删除模板" onClick={() => p.onTemplates(p.templates.filter((x) => x.id !== t.id))}><Icon name="close" size={14} /></button>
              </div>
              <NumRow label="点击缩放" value={t.pressScale} step={0.01}
                set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressScale: v || 1 } : x))} />
              <NumRow label="点击透明度" value={t.pressOpacity} step={0.01}
                set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressOpacity: v } : x))} />
              <div className="row"><label>点击高亮色</label>
                <input type="color" value={t.pressTint ? toHex(t.pressTint) : "#ffffff"}
                  onChange={(e) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressTint: e.target.value + "40" } : x))} />
                <button className="icon" onClick={() => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, pressTint: null } : x))} title="清除高亮"><Icon name="close" size={14} /></button></div>
              <NumRow label="动画时长" value={t.duration} step={0.01}
                set={(v) => p.onTemplates(p.templates.map((x) => x.id === t.id ? { ...x, duration: v || 0.1 } : x))} />
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => p.onTemplates([...p.templates, {
          id: "t" + Date.now(), name: "模板" + (p.templates.length + 1),
          pressScale: 0.95, pressOpacity: 0.8, pressTint: null, duration: 0.1,
        }])}><Icon name="plus" size={14} /> 新建模板</button>
      </InspectorSection>

      <InspectorSection title="工程资源" defaultOpen={false}>
        <div className="source-readout"><span>节点 ID</span><strong>{n.id}</strong></div>
        <div className="source-readout"><span>资源路径</span><strong>{n.assetPath ?? (n.image ? "首次保存时生成" : "无")}</strong></div>
      </InspectorSection>
    </aside>
  );
}
