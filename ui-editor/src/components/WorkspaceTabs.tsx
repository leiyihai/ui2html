import type { ScaleMode } from "../types";
import { PRESETS } from "../App";

export type Workspace = "controls" | "slice" | "layout" | "animation" | "export";

interface Props {
  ws: Workspace;
  onWs: (w: Workspace) => void;
  hasScene: boolean;
  /** 存在未标记控件类型的节点：锁定九宫格/布局适配工作区 */
  lockLayout: boolean;
  /** 点击被锁定工作区时的提示回调 */
  onLocked: () => void;
  // 九宫格工作区上下文
  sliceAvailable: boolean;
  sliceApplied: boolean;
  onReplaceSlice: () => void;
  onToggleSlice: () => void;
  onRestoreSlice: () => void;
  // 布局工作区：预览视图设置
  viewport: { width: number; height: number };
  onViewport: (v: { width: number; height: number }) => void;
  safeArea: { left: number; right: number; top: number; bottom: number };
  onSafeArea: (v: { left: number; right: number; top: number; bottom: number }) => void;
  scaleMode: ScaleMode;
  onScaleMode: (m: ScaleMode) => void;
  showSafeArea: boolean;
  onShowSafeArea: (b: boolean) => void;
  showDesignBorder: boolean;
  onShowDesignBorder: (b: boolean) => void;
}

/** 工作栏：工作区导航（流程：控件类型 → 九宫格 → 布局适配 → 动画）+ 上下文工具 */
export default function Workbar(p: Props) {
  const main: [Workspace, string, string, boolean][] = [
    ["controls", "控件类型", "◎", false],
    ["slice", "九宫格", "❒", p.lockLayout],
    ["layout", "布局适配", "▦", p.lockLayout],
    ["animation", "动画", "▶", false],
  ];
  const curPreset = PRESETS.find(([, w, h]) => w === p.viewport.width && h === p.viewport.height)?.[0] ?? "custom";
  const lockTip = "请先在「控件类型」工作区完成所有节点的标记";
  return (
    <div className="workbar">
      <nav className="ws-tabs">
        {main.map(([w, label, icon, locked]) => (
          <button key={w} className={(p.ws === w ? "on" : "") + (locked ? " locked" : "")}
            title={locked ? lockTip : ""}
            onClick={() => { if (locked) p.onLocked(); else p.onWs(w); }}>
            <span className="ws-ic">{locked ? "🔒" : icon}</span>{label}
          </button>
        ))}
      </nav>
      {p.ws === "slice" && p.sliceAvailable && (
        <span className="ws-ctx">
          <button className="btn" onClick={p.onReplaceSlice} title="用「9」文件夹内同名图片替换">九宫格替换</button>
          <button className={"btn" + (p.sliceApplied ? " on" : "")} onClick={p.onToggleSlice}
            title="切换替换前/后效果">{p.sliceApplied ? "替换后 ✓" : "替换前"}</button>
          <button className="btn" onClick={p.onRestoreSlice} title="还原为替换前版本">还原</button>
        </span>
      )}
      {p.ws === "layout" && (
        <span className="ws-views">
          <select value={curPreset}
            onChange={(e) => {
              const hit = PRESETS.find(([n]) => n === e.target.value);
              if (hit) p.onViewport({ width: hit[1], height: hit[2] });
            }}>
            {PRESETS.map(([n]) => (
              <option key={n} value={n} disabled={!p.hasScene}>{n}</option>
            ))}
            <option value="custom" disabled={!p.hasScene}>自定义</option>
          </select>
          <label className="num">宽 <input type="number" value={p.viewport.width}
            onChange={(e) => p.onViewport({ ...p.viewport, width: +e.target.value || 0 })} /></label>
          <label className="num">高 <input type="number" value={p.viewport.height}
            onChange={(e) => p.onViewport({ ...p.viewport, height: +e.target.value || 0 })} /></label>
          <select value={p.scaleMode} onChange={(e) => p.onScaleMode(e.target.value as ScaleMode)} title="整体缩放策略">
            <option value="contain">等比适配</option>
            <option value="width">宽度优先</option>
            <option value="height">高度优先</option>
            <option value="cover">贴边等比</option>
            <option value="fill">拉伸铺满</option>
          </select>
          <label className="chk"><input type="checkbox" checked={p.showSafeArea}
            onChange={(e) => p.onShowSafeArea(e.target.checked)} /> SafeArea</label>
          {p.showSafeArea && (
            <span className="sa-inputs">
              <label>L <input type="number" value={p.safeArea.left}
                onChange={(e) => p.onSafeArea({ ...p.safeArea, left: +e.target.value || 0 })} /></label>
              <label>R <input type="number" value={p.safeArea.right}
                onChange={(e) => p.onSafeArea({ ...p.safeArea, right: +e.target.value || 0 })} /></label>
              <label>T <input type="number" value={p.safeArea.top}
                onChange={(e) => p.onSafeArea({ ...p.safeArea, top: +e.target.value || 0 })} /></label>
              <label>B <input type="number" value={p.safeArea.bottom}
                onChange={(e) => p.onSafeArea({ ...p.safeArea, bottom: +e.target.value || 0 })} /></label>
            </span>
          )}
          <label className="chk"><input type="checkbox" checked={p.showDesignBorder}
            onChange={(e) => p.onShowDesignBorder(e.target.checked)} /> 设计边框</label>
        </span>
      )}
      <span className="ws-spacer" />
      <button className={"ws-settings" + (p.ws === "export" ? " on" : "")} onClick={() => p.onWs("export")}>⚙ 导出设置</button>
    </div>
  );
}
