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
    types: ["Layout", "empty", "List", "ListHorizontal", "GridView"],
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

/** 单节点类型转换菜单：按控件相似度分为四个方向的分类卡片。 */
export default function TypePieMenu(p: Props) {
  const [hovered, setHovered] = useState<CtrlType | null>(null);
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
            </div>
          </section>
        ))}
        <div className="type-pie-center">
          <div className="type-pie-center-label">{hovered ? "准备切换" : "当前类型"}</div>
          <div className="type-pie-center-disc"><TypeIcon type={current} /></div>
          <strong title={TYPE_LABELS[current]}>{TYPE_LABELS[current]}</strong>
          <small>{hovered ? "点击切换" : "移动鼠标选择"}</small>
        </div>
      </div>
    </div>
  );
}
