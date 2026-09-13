import { useState } from "react";
import type { CtrlType, UINode } from "../types";
import { TYPE_LABELS, TypeIcon } from "./ControlsPanel";

interface Props {
  x: number;
  y: number;
  node: UINode;
  onChoose: (type: CtrlType) => void;
  onClose: () => void;
}

type TypeGroup = { key: string; label: string; hint: string; types: CtrlType[] };

const TYPE_GROUPS: TypeGroup[] = [
  { key: "progress", label: "进度 / 滚动", hint: "数值与拖动状态", types: ["ProgressBar", "Slider"] },
  { key: "layout", label: "容器 / 布局", hint: "组织界面层级", types: ["Layout", "empty"] },
  { key: "interactive", label: "交互控件", hint: "用户操作反馈", types: ["Button", "CheckBox", "RadioButton", "Edit"] },
  { key: "content", label: "内容展示", hint: "图片与文字", types: ["StaticImage", "StaticText"] },
];

const LIST_ARRANGEMENTS: Array<{ type: "List" | "ListHorizontal" | "GridView"; label: string; hint: string }> = [
  { type: "List", label: "纵向列表", hint: "从上到下排列" },
  { type: "ListHorizontal", label: "横向列表", hint: "从左到右排列" },
  { type: "GridView", label: "网格列表", hint: "按行列排列" },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function menuLayout(pointer: { x: number; y: number }) {
  const width = Math.min(390, window.innerWidth - 24);
  const height = Math.min(520, window.innerHeight - 24);
  return {
    left: clamp(pointer.x, width / 2 + 12, window.innerWidth - width / 2 - 12),
    top: clamp(pointer.y, height / 2 + 12, window.innerHeight - height / 2 - 12),
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
        <button className="type-list-back" onClick={p.onBack} aria-label="返回类型列表">‹</button>
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

/** 单节点类型转换菜单：使用分组列表，避免饼菜单占据过多画布空间。 */
export default function TypeListMenu(p: Props) {
  const [showListArrangements, setShowListArrangements] = useState(false);
  const current = p.node.ctrl?.type ?? "empty";
  const layout = menuLayout(p);

  return (
    <div className="type-list-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="type-list-menu" style={layout} role="dialog" aria-label="选择控件类型" onPointerDown={(e) => e.stopPropagation()}>
        <header className="type-list-head"><div><span>TYPE CONVERSION</span><strong>选择控件类型</strong></div><small>点击选项立即应用 · Esc 关闭</small></header>
        {showListArrangements ? (
          <ListArrangementMenu currentType={current} onChoose={p.onChoose} onBack={() => setShowListArrangements(false)} />
        ) : (
          <div className="type-list-groups">
            {TYPE_GROUPS.map((group, index) => (
              <section className="type-list-group" key={group.key}>
                <div className="type-list-group-head"><b>{String(index + 1).padStart(2, "0")}</b><strong>{group.label}</strong><small>{group.hint}</small></div>
                <div className="type-list-options">
                  {group.types.map((type) => (
                    <button key={type} className={`type-list-option ${type === current ? "active" : ""}`} onClick={() => p.onChoose(type)}>
                      <TypeIcon type={type} /><span>{TYPE_LABELS[type]}</span>{type === current && <em>当前</em>}
                    </button>
                  ))}
                  {group.key === "layout" && (
                    <button className={`type-list-option ${["List", "ListHorizontal", "GridView"].includes(current) ? "active" : ""}`} onClick={() => setShowListArrangements(true)}>
                      <TypeIcon type={current === "ListHorizontal" || current === "GridView" ? current : "List"} /><span>列表容器</span>{["List", "ListHorizontal", "GridView"].includes(current) && <em>当前</em>}
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        <footer className="type-list-foot"><span>当前类型</span><strong>{TYPE_LABELS[current]}</strong><span>选择后自动完成类型转换</span></footer>
      </div>
    </div>
  );
}
