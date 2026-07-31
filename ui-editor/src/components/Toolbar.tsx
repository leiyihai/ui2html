import { PRESETS } from "../App";
import type { ScaleMode } from "../types";

interface Props {
  onLoadFile: (buffer: ArrayBuffer, name: string) => void;
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
  warnings: string[];
  hasScene: boolean;
  onExportAnchors: () => void;
  onExportHtml: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  psdList: string[];
  onLoadPsdFromFolder: (name: string) => void;
  exportMsg: string;
}

export default function Toolbar(p: Props) {
  const onFile = async (f: File | undefined) => {
    if (f) p.onLoadFile(await f.arrayBuffer(), f.name);
  };

  return (
    <header className="toolbar">
      <span className="title">UI Layout Editor</span>
      <label className="btn">
        打开 PSD
        <input type="file" accept=".psd" style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <select title="从 psd 文件夹选择" value=""
        onChange={(e) => { const n = e.target.value; if (n) p.onLoadPsdFromFolder(n); }}>
        <option value="">psd 文件夹…</option>
        {p.psdList.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>

      <span className="sep" />
      {(() => {
        const cur = PRESETS.find(([, w, h]) => w === p.viewport.width && h === p.viewport.height)?.[0] ?? "custom";
        return (
          <select value={cur}
            onChange={(e) => {
              const hit = PRESETS.find(([n]) => n === e.target.value);
              if (hit) p.onViewport({ width: hit[1], height: hit[2] });
            }}>
            {PRESETS.map(([n]) => (
              <option key={n} value={n} disabled={!p.hasScene}>{n}</option>
            ))}
            <option value="custom" disabled={!p.hasScene}>自定义</option>
          </select>
        );
      })()}
      <label className="num">宽 <input type="number" value={p.viewport.width}
        onChange={(e) => p.onViewport({ ...p.viewport, width: +e.target.value || 0 })} /></label>
      <label className="num">高 <input type="number" value={p.viewport.height}
        onChange={(e) => p.onViewport({ ...p.viewport, height: +e.target.value || 0 })} /></label>

      <span className="sep" />
      <label>缩放策略
        <select value={p.scaleMode} onChange={(e) => p.onScaleMode(e.target.value as ScaleMode)}>
          <option value="contain">等比适配 (Contain)</option>
          <option value="width">宽度优先 (Width)</option>
          <option value="height">高度优先 (Height)</option>
          <option value="cover">贴边等比 (Cover)</option>
          <option value="fill">拉伸铺满 (Fill)</option>
        </select>
      </label>

      <span className="sep" />
      <button className="btn" disabled={!p.canUndo} onClick={p.onUndo} title="后退一步 (Ctrl+Z)">↩ 撤销</button>
      <button className="btn" disabled={!p.canRedo} onClick={p.onRedo} title="前进一步 (Ctrl+X)">↪ 重做</button>

      <span className="sep" />
      <button className="btn primary" disabled={!p.hasScene} onClick={p.onExportHtml} title="导出到 export 文件夹">导出 HTML</button>
      <button className="btn" disabled={!p.hasScene} onClick={p.onExportAnchors}>导出锚点</button>
      {p.exportMsg && <span className="ok">{p.exportMsg}</span>}

      <span className="sep" />
      <label><input type="checkbox" checked={p.showSafeArea} onChange={(e) => p.onShowSafeArea(e.target.checked)} /> Safe Area</label>
      {p.showSafeArea && (
        <span className="sa-inputs">
          <label>L <input type="number" value={p.safeArea.left} onChange={(e) => p.onSafeArea({ ...p.safeArea, left: +e.target.value || 0 })} /></label>
          <label>R <input type="number" value={p.safeArea.right} onChange={(e) => p.onSafeArea({ ...p.safeArea, right: +e.target.value || 0 })} /></label>
          <label>T <input type="number" value={p.safeArea.top} onChange={(e) => p.onSafeArea({ ...p.safeArea, top: +e.target.value || 0 })} /></label>
          <label>B <input type="number" value={p.safeArea.bottom} onChange={(e) => p.onSafeArea({ ...p.safeArea, bottom: +e.target.value || 0 })} /></label>
        </span>
      )}
      <label><input type="checkbox" checked={p.showDesignBorder} onChange={(e) => p.onShowDesignBorder(e.target.checked)} /> 设计边框</label>

      {p.warnings.length > 0 && (
        <span className="warn" title={p.warnings.join("\n")}>⚠ {p.warnings.length} 个图层被跳过</span>
      )}
    </header>
  );
}
