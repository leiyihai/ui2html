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

type TypeGroup = {
  key: string;
  label: string;
  hint: string;
  placement: "top" | "left" | "right" | "bottom";
  types: CtrlType[];
};

const TYPE_GROUPS: TypeGroup[] = [
  {
    key: "progress",
    label: "进度 / 滚动",
    hint: "数值与拖动状态",
    placement: "left",
    types: ["ProgressBar", "Slider"],
  },
  {
    key: "layout",
    label: "容器 / 布局",
    hint: "组织界面层级",
    placement: "top",
    types: ["Layout", "empty"],
  },
  {
    key: "interactive",
    label: "交互控件",
    hint: "用户操作反馈",
    placement: "right",
    types: ["Button", "CheckBox", "RadioButton", "Edit"],
  },
  {
    key: "content",
    label: "内容展示",
    hint: "图片与文字",
    placement: "bottom",
    types: ["StaticImage", "StaticText"],
  },
];

const LIST_ARRANGEMENTS: Array<{ type: "List" | "ListHorizontal" | "GridView"; label: string; hint: string }> = [
  { type: "List", label: "纵向列表", hint: "从上到下排列" },
  { type: "ListHorizontal", label: "横向列表", hint: "从左到右排列" },
  { type: "GridView", label: "网格列表", hint: "按行列排列" },
];

const MENU_WIDTH = 620;
const MENU_HEIGHT = 470;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function menuLayout(pointer: { x: number; y: number }) {
  const scale = Math.max(0.36, Math.min(1, (window.innerWidth - 20) / MENU_WIDTH, (window.innerHeight - 20) / MENU_HEIGHT));
  const width = MENU_WIDTH * scale;
  const height = MENU_HEIGHT * scale;
  return {
    left: clamp(pointer.x, width / 2 + 10, window.innerWidth - width / 2 - 10),
    top: clamp(pointer.y, height / 2 + 10, window.innerHeight - height / 2 - 10),
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
}

export function ListArrangementMenu(p: {
  currentType?: CtrlType;
  onChoose: (type: "List" | "ListHorizontal" | "GridView") => void;
  onBack: () => void;
}) {
  return (
    <section className="type-pie-list-stage" aria-label="选择列表排列方式">
      <div className="type-pie-list-heading">
        <span>列表容器</span>
        <strong>选择排列方式</strong>
        <small>将直接写入对应的引擎控件类型</small>
      </div>
      <div className="type-pie-list-options">
        {LIST_ARRANGEMENTS.map((item) => (
          <button
            key={item.type}
            className={`type-pie-item ${p.currentType === item.type ? "active" : ""} type-pie-list-item`}
            title={item.label}
            aria-label={item.label}
            onClick={() => p.onChoose(item.type)}
          >
            <TypeIcon type={item.type} />
            <span><strong>{item.label}</strong><small>{item.hint}</small></span>
          </button>
        ))}
      </div>
      <button className="type-pie-list-back" onClick={p.onBack}>返回类型选择</button>
    </section>
  );
}

/** 单节点类型转换菜单：按控件相似度分为四个方向的分类卡片。 */
export default function TypePieMenu(p: Props) {
  const [hovered, setHovered] = useState<CtrlType | null>(null);
  const [stage, setStage] = useState<"types" | "list-arrangement">("types");
  const current = hovered ?? p.node.ctrl?.type ?? "empty";
  const layout = menuLayout(p);

  return (
    <div className="type-pie-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div
        className="type-pie-menu"
        style={layout}
        role="dialog"
        aria-label="选择控件类型"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="type-pie-orbit type-pie-orbit-horizontal" />
        <div className="type-pie-orbit type-pie-orbit-vertical" />
        {stage === "list-arrangement" ? (
          <ListArrangementMenu
            currentType={p.node.ctrl?.type}
            onChoose={p.onChoose}
            onBack={() => setStage("types")}
          />
        ) : <>
        {TYPE_GROUPS.map((group) => (
          <section key={group.key} className={`type-pie-group type-pie-group-${group.placement}`}>
            <div className="type-pie-group-heading">
              <strong>{group.label}</strong>
              <span>{group.hint}</span>
            </div>
            <div className="type-pie-group-grid">
              {group.types.map((type) => (
                <button
                  key={type}
                  className={`type-pie-item ${type === current ? "active" : ""}`}
                  title={TYPE_LABELS[type]}
                  aria-label={TYPE_LABELS[type]}
                  onPointerEnter={() => setHovered(type)}
                  onPointerLeave={() => setHovered(null)}
                  onClick={() => p.onChoose(type)}
                >
                  <TypeIcon type={type} />
                  <span>{TYPE_LABELS[type]}</span>
                </button>
              ))}
              {group.key === "layout" && (
                <button
                  className={`type-pie-item ${["List", "ListHorizontal", "GridView"].includes(p.node.ctrl?.type ?? "") ? "active" : ""}`}
                  title="列表容器"
                  aria-label="列表容器"
                  onClick={() => setStage("list-arrangement")}
                >
                  <TypeIcon type={p.node.ctrl?.type === "ListHorizontal" || p.node.ctrl?.type === "GridView" ? p.node.ctrl.type : "List"} />
                  <span>列表容器</span>
                </button>
              )}
            </div>
          </section>
        ))}
        <div className="type-pie-center">
          <div className="type-pie-center-label">{hovered ? "准备切换" : "当前类型"}</div>
          <div className="type-pie-center-disc"><TypeIcon type={current} /></div>
          <strong title={TYPE_LABELS[current]}>{TYPE_LABELS[current]}</strong>
          <small>{hovered ? "点击切换" : "移动鼠标选择"}</small>
        </div>
        </>}
      </div>
    </div>
  );
}
