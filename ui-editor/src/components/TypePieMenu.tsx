import { useState } from "react";
import { createPortal } from "react-dom";
import type { CtrlType, UINode } from "../types";
import { TYPE_LABELS, TypeIcon } from "./ControlsPanel";
import { Icon } from "./Icon";

interface Props {
  x: number;
  y: number;
  node: UINode;
  /** The app shell is scaled as a whole; overlays rendered in body need this explicitly. */
  uiScale?: number;
  onChoose: (type: CtrlType) => void;
  onClose: () => void;
}

const TYPE_OPTIONS: CtrlType[] = [
  "ProgressBar", "Slider", "Layout", "empty", "Button", "CheckBox", "RadioButton", "Edit", "StaticImage", "StaticText",
];
const LIST_TYPES: CtrlType[] = ["List", "ListHorizontal", "GridView"];

const LIST_ARRANGEMENTS: Array<{ type: "List" | "ListHorizontal" | "GridView"; label: string; hint: string }> = [
  { type: "List", label: "纵向列表", hint: "从上到下排列" },
  { type: "ListHorizontal", label: "横向列表", hint: "从左到右排列" },
  { type: "GridView", label: "网格列表", hint: "按行列排列" },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function menuLayout(pointer: { x: number; y: number }, uiScale = 1) {
  const scale = Math.max(0.5, Math.min(2, uiScale));
  const width = Math.min(248 * scale, window.innerWidth - 24);
  const height = Math.min(320 * scale, window.innerHeight - 24);
  return {
    left: clamp(pointer.x, width / 2 + 12, window.innerWidth - width / 2 - 12),
    top: clamp(pointer.y, height / 2 + 12, window.innerHeight - height / 2 - 12),
    transform: `translate(-50%, -50%) scale(${scale})`,
    maxHeight: `calc((100vh - 24px) / ${scale})`,
  };
}

export function ListArrangementMenu(p: {
  currentType?: CtrlType;
  onChoose: (type: "List" | "ListHorizontal" | "GridView") => void;
  onBack: () => void;
}) {
  return (
    <section className="type-list-submenu" aria-label="选择列表排列方式">
      <div className="type-list-submenu-head">
        <button className="type-list-back" onClick={p.onBack} aria-label="返回类型列表"><Icon name="back" size={15} /></button>
        <div><span>列表容器</span><strong>选择排列方式</strong></div>
      </div>
      <div className="type-list-submenu-options">
        {LIST_ARRANGEMENTS.map((item) => (
          <button key={item.type} className={`type-list-option ${p.currentType === item.type ? "active" : ""}`} onClick={() => p.onChoose(item.type)}>
            <TypeIcon type={item.type} />
            <span><strong>{item.label}</strong><small>{item.hint}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 单节点类型转换菜单：使用单列紧凑列表，避免饼菜单占据过多画布空间。 */
export default function TypeListMenu(p: Props) {
  const [showListArrangements, setShowListArrangements] = useState(false);
  const current = p.node.ctrl?.type ?? "empty";
  const layout = menuLayout(p, p.uiScale);

  const content = (
    <div className="type-list-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="type-list-menu" style={layout} role="dialog" aria-label="选择控件类型" onPointerDown={(e) => e.stopPropagation()}>
        <header className="type-list-head"><strong>当前：{TYPE_LABELS[current]}</strong></header>
        {showListArrangements ? (
          <ListArrangementMenu currentType={current} onChoose={p.onChoose} onBack={() => setShowListArrangements(false)} />
        ) : (
          <div className="type-list-options">
            {TYPE_OPTIONS.map((type) => (
              <button key={type} className={`type-list-option ${type === current ? "active" : ""}`} onClick={() => p.onChoose(type)}>
                <TypeIcon type={type} /><span>{TYPE_LABELS[type]}</span>
              </button>
            ))}
            <button className={`type-list-option ${LIST_TYPES.includes(current) ? "active" : ""}`} onClick={() => setShowListArrangements(true)}>
              <TypeIcon type={current === "ListHorizontal" || current === "GridView" ? current : "List"} /><span>列表容器</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
  // The app shell is scaled with CSS transform. Portaling to body keeps fixed positioning
  // relative to the actual viewport instead of the transformed layer panel/canvas tree.
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
