import { useState } from "react";
import type { CtrlType, UINode } from "../types";
import { CTRL_TYPES } from "../types";
import { TYPE_LABELS, TypeIcon } from "./ControlsPanel";

interface Props {
  x: number;
  y: number;
  node: UINode;
  onChoose: (type: CtrlType) => void;
  onClose: () => void;
}

const MENU_SIZE = 340;
const RADIUS = 126;

/** 单节点类型转换菜单：始终显示完整类型，容器约束只负责禁用不兼容选项。 */
export default function TypePieMenu(p: Props) {
  const [hovered, setHovered] = useState<CtrlType | null>(null);
  const current = hovered ?? p.node.ctrl?.type ?? "empty";
  const left = Math.max(MENU_SIZE / 2 + 8, Math.min(window.innerWidth - MENU_SIZE / 2 - 8, p.x));
  const top = Math.max(MENU_SIZE / 2 + 8, Math.min(window.innerHeight - MENU_SIZE / 2 - 8, p.y));

  return (
    <div className="type-pie-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="type-pie-menu" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="type-pie-ring" />
        {CTRL_TYPES.map(({ value }, index) => {
          const angle = index / CTRL_TYPES.length * Math.PI * 2 - Math.PI / 2;
          return (
            <button
              key={value}
              className={`type-pie-item ${value === current ? "active" : ""}`}
              style={{ left: `calc(50% + ${Math.cos(angle) * RADIUS}px)`, top: `calc(50% + ${Math.sin(angle) * RADIUS}px)` }}
              title={TYPE_LABELS[value]}
              onPointerEnter={() => setHovered(value)}
              onPointerLeave={() => setHovered(null)}
              onClick={() => p.onChoose(value)}
            >
              <TypeIcon type={value} />
              <span>{TYPE_LABELS[value]}</span>
            </button>
          );
        })}
        <div className="type-pie-center">
          <TypeIcon type={current} />
          <strong>{TYPE_LABELS[current]}</strong>
          <small>{hovered ? "点击切换" : "选择类型"}</small>
        </div>
      </div>
    </div>
  );
}
