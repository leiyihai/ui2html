import type { ScaleMode } from "../types";
import { presetsForDesign, type DeviceShell } from "../devicePreview";

export type Workspace = "controls" | "export";

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

/** 当前版本只保留编辑层级和导出两个工作区；适配、动画、九宫格以后独立增加。 */
export default function Workbar(p: Props) {
  const presets = presetsForDesign(p.designWidth, p.designHeight);
  const preset = presets.find((item) => item.width === p.viewport.width && item.height === p.viewport.height)?.id ?? "custom";
  return (
    <div className="workbar">
      <nav className="ws-tabs" aria-label="工作区">
        <button className={p.ws === "controls" ? "on" : ""} onClick={() => p.onWs("controls")}>
          <span className="ws-ic">◎</span>层级
        </button>
        <button className={p.ws === "export" ? "on" : ""} disabled={!p.hasScene}
          onClick={() => p.onWs("export")} title={!p.hasScene ? "请先打开或导入工程" : "导出自研引擎 JSON"}>
          <span className="ws-ic">⇩</span>导出
        </button>
      </nav>
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
      <span className="ws-spacer" />
      <span className="workbar-hint">PSD 只负责导入，工程文件独立保存</span>
    </div>
  );
}
