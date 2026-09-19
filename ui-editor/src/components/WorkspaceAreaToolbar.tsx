import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AreaTool } from "../areaLayout";
import { Icon, type IconName } from "./Icon";

interface Props {
  tool: AreaTool;
  onTool: (tool: AreaTool) => void;
  children?: ReactNode;
}

export const AREA_TOOL_OPTIONS: Array<{ value: AreaTool; label: string; icon: IconName }> = [
  { value: "layers", label: "层级面板", icon: "layers" },
  { value: "canvas", label: "画布", icon: "canvas" },
  { value: "properties", label: "属性面板", icon: "settings" },
  { value: "overview", label: "场景总览", icon: "preview" },
  { value: "bindings", label: "资源绑定", icon: "binding" },
  { value: "slice", label: "九宫格", icon: "grid-slice" },
  { value: "slice-candidates", label: "九宫格候选", icon: "image" },
  { value: "slice-marker", label: "九宫格标记", icon: "columns" },
  { value: "preview", label: "预览", icon: "monitor" },
  { value: "export-targets", label: "导出目标", icon: "download" },
];

export function areaToolLabel(tool: AreaTool): string {
  return AREA_TOOL_OPTIONS.find((item) => item.value === tool)?.label ?? "工具";
}

export function areaToolIcon(tool: AreaTool): IconName {
  return AREA_TOOL_OPTIONS.find((item) => item.value === tool)?.icon ?? "empty";
}

export default function WorkspaceAreaToolbar({ tool, onTool, children }: Props) {
  const [open, setOpen] = useState(false);
  const [middleDragging, setMiddleDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const middleDragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null);
  const current = AREA_TOOL_OPTIONS.find((item) => item.value === tool) ?? AREA_TOOL_OPTIONS[0];

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const startMiddleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    const actions = event.currentTarget;
    middleDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: actions.scrollLeft };
    actions.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    setMiddleDragging(true);
  };

  const moveMiddleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = middleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
  };

  const stopMiddleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = middleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    middleDragRef.current = null;
    setMiddleDragging(false);
  };

  return <div className="area-toolbar" ref={rootRef} onPointerDown={(event) => event.stopPropagation()}>
    <div className="area-tool-picker">
      <button className="area-tool-picker-button" type="button" aria-label={`当前工具：${current.label}`} aria-haspopup="menu" aria-expanded={open}
        title={`${current.label}（点击切换工具）`}
        onPointerDown={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}>
        <span className="area-tool-icon"><Icon name={current.icon} /></span>
      </button>
      {open && <div className="area-tool-picker-menu" role="menu" aria-label="区域工具">
        {AREA_TOOL_OPTIONS.map((item) => <button key={item.value} type="button" role="menuitem"
          className={`area-tool-option${item.value === tool ? " is-current" : ""}`} aria-label={item.label}
          onClick={() => { onTool(item.value); setOpen(false); }}>
          <span className="area-tool-option-icon"><Icon name={item.icon} /></span>
          <span>{item.label}</span>
        </button>)}
      </div>}
    </div>
    {children ? <div className={`area-toolbar-actions${middleDragging ? " is-middle-dragging" : ""}`} ref={actionsRef}
      aria-label="工具动作区域" onPointerDown={startMiddleDrag} onPointerMove={moveMiddleDrag}
      onPointerUp={stopMiddleDrag} onPointerCancel={stopMiddleDrag}>{children}</div> : null}
  </div>;
}
