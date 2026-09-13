import type { ScaleMode } from "../types";
import { presetsForDesign, type DeviceShell } from "../devicePreview";

export type Workspace = "controls" | "bindings" | "slice" | "preview" | "export";

interface Props {
  ws: Workspace;
  onWs: (workspace: Workspace) => void;
  hasScene: boolean;
  viewport: { width: number; height: number };
  onViewport: (value: { width: number; height: number }) => void;
  safeArea: { left: number; right: number; top: number; bottom: number };
  onSafeArea: (value: { left: number; right: number; top: number; bottom: number }) => void;
  scaleMode: ScaleMode;
  onScaleMode: (mode: ScaleMode) => void;
  showSafeArea: boolean;
  onShowSafeArea: (value: boolean) => void;
  showDesignBorder: boolean;
  onShowDesignBorder: (value: boolean) => void;
  designWidth: number;
  designHeight: number;
  deviceShell: DeviceShell;
  onDeviceShell: (shell: DeviceShell) => void;
}

/** 工作区上下文栏：工作区切换已提升到顶部菜单栏，这里只放当前工作区的视图参数。 */
export default function Workbar(p: Props) {
  const presets = presetsForDesign(p.designWidth, p.designHeight);
  const preset = presets.find((item) => item.width === p.viewport.width && item.height === p.viewport.height)?.id ?? "custom";
  if (p.ws !== "preview") return null;
  return (
    <div className="workspace-contextbar">
      <details className="device-preview" open={false}>
        <summary>设备预览 · {p.viewport.width} × {p.viewport.height}</summary>
        <div className="device-preview-popover">
          <label>设备预设
            <select value={preset} disabled={!p.hasScene} onChange={(event) => {
              const hit = presets.find((item) => item.id === event.target.value);
              if (hit) { p.onViewport({ width: hit.width, height: hit.height }); p.onDeviceShell(hit.shell); }
            }}>
              {presets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>宽 <input type="number" min="1" value={p.viewport.width} disabled={!p.hasScene}
            onChange={(event) => p.onViewport({ ...p.viewport, width: Math.max(1, +event.target.value || 1) })} /></label>
          <label>高 <input type="number" min="1" value={p.viewport.height} disabled={!p.hasScene}
            onChange={(event) => p.onViewport({ ...p.viewport, height: Math.max(1, +event.target.value || 1) })} /></label>
          <label>缩放
            <select value={p.scaleMode} disabled={!p.hasScene} onChange={(event) => p.onScaleMode(event.target.value as ScaleMode)}>
              <option value="contain">完整显示</option>
              <option value="width">按宽度</option>
              <option value="height">按高度</option>
              <option value="cover">等比铺满</option>
              <option value="fill">拉伸铺满</option>
            </select>
          </label>
          <label className="device-check"><input type="checkbox" checked={p.showSafeArea} disabled={!p.hasScene}
            onChange={(event) => p.onShowSafeArea(event.target.checked)} />显示安全区</label>
          <label className="device-check"><input type="checkbox" checked={p.showDesignBorder} disabled={!p.hasScene}
            onChange={(event) => p.onShowDesignBorder(event.target.checked)} />显示设计边框</label>
          {p.showSafeArea && <div className="device-safe-area">
            {(["left", "right", "top", "bottom"] as const).map((side) => (
              <label key={side}>{side === "left" ? "左" : side === "right" ? "右" : side === "top" ? "上" : "下"}
                <input type="number" min="0" value={p.safeArea[side]}
                  onChange={(event) => p.onSafeArea({ ...p.safeArea, [side]: Math.max(0, +event.target.value || 0) })} /></label>
            ))}
          </div>}
          <p>仅改变预览视口，不改变工程中的节点位置和尺寸。</p>
        </div>
      </details>
    </div>
  );
}
