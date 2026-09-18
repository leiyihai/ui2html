import { useEffect, useState } from "react";
import { ENGINE_EDITOR_FONT_FAMILY } from "../engineFont";
import { nextFontInCycle } from "../fontPicker";
import { nextPreviewPreset, nextPreviewScaleMode, PREVIEW_SCALE_MODES, presetsForDesign, type DeviceShell } from "../devicePreview";
import type { ScaleMode } from "../types";

export function FontPickerControl({ hasScene, onFont }: { hasScene: boolean; onFont: (font: string) => void }) {
  const [fontList, setFontList] = useState<string[]>([]);
  const [selectedFont, setSelectedFont] = useState(ENGINE_EDITOR_FONT_FAMILY);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { await document.fonts.ready; } catch { /* 等待字体失败不影响编辑 */ }
      if (!alive) return;
      const families = new Set<string>();
      document.fonts.forEach((font) => {
        if (font.family) families.add(font.family.replace(/^"/, "").replace(/"$/, ""));
      });
      setFontList([ENGINE_EDITOR_FONT_FAMILY, ...[...families].filter((font) => font !== ENGINE_EDITOR_FONT_FAMILY)]);
    })();
    return () => { alive = false; };
  }, []);

  const applyFont = async (font: string) => {
    if (!font) return;
    // 先让浏览器完成字体加载，再触发工程重绘；否则 Canvas 可能先用
    // fallback 字体测量一次，字体真正加载后却没有新的绘制时机。
    try { await document.fonts.load(`16px "${font.replaceAll('"', "\\\"")}"`); } catch { /* 使用浏览器回退字体 */ }
    setSelectedFont(font);
    onFont(font);
  };

  return <div className="font-picker area-toolbar-font-picker" title="选择字体后立即应用到全部文本">
    <select className="global-font" aria-label="项目字体" value={selectedFont} disabled={!hasScene || !fontList.length}
      onChange={(event) => { void applyFont(event.target.value); }}>
      {fontList.map((font) => <option key={font} value={font}>{font}</option>)}
    </select>
    <button className="btn font-cycle" type="button" aria-label="循环切换字体" title="循环切换字体"
      disabled={!hasScene || fontList.length < 2}
        onClick={() => {
        const nextFont = nextFontInCycle(fontList, selectedFont);
        if (nextFont) void applyFont(nextFont);
      }}>↻</button>
  </div>;
}

export function CanvasZoomControl({ zoom, onAdjust }: { zoom: number; onAdjust: (direction: 1 | -1) => void }) {
  return <span className="canvas-zoom-controls area-toolbar-zoom-controls" aria-label="画布缩放">
    <button type="button" className="status-zoom-btn" onClick={() => onAdjust(-1)} aria-label="缩小画布">−</button>
    <span className="canvas-zoom-value" title="Ctrl+0 恢复最佳窗口预览大小">{Math.round(zoom * 100)}%</span>
    <button type="button" className="status-zoom-btn" onClick={() => onAdjust(1)} aria-label="放大画布">＋</button>
  </span>;
}

export interface PreviewToolActionsProps {
  hasScene: boolean;
  viewport: { width: number; height: number };
  onViewport: (value: { width: number; height: number }) => void;
  safeArea: { left: number; right: number; top: number; bottom: number };
  onSafeArea: (value: { left: number; right: number; top: number; bottom: number }) => void;
  scaleMode: ScaleMode;
  onScaleMode: (mode: ScaleMode) => void;
  showSafeArea: boolean;
  designWidth: number;
  designHeight: number;
  deviceShell: DeviceShell;
  onDeviceShell: (shell: DeviceShell) => void;
  showDeviceShell: boolean;
  onToggleDeviceShell: () => void;
  useNineSlicePreview: boolean;
  onToggleNineSlicePreview: () => void;
  previewLayoutMode: "pure" | "edit";
  onTogglePreviewLayout: () => void;
}

export function PreviewToolActions(p: PreviewToolActionsProps) {
  const previewPresets = presetsForDesign(p.designWidth, p.designHeight);
  const presetGroups = [...new Set(previewPresets.map((item) => item.group))];
  const previewPreset = previewPresets.find((item) => item.width === p.viewport.width && item.height === p.viewport.height
    && item.shell === p.deviceShell)?.id ?? "custom";
  const currentPreviewPreset = previewPresets.find((item) => item.id === previewPreset);
  const previewSideLabels = { left: "左", right: "右", top: "上", bottom: "下" } as const;

  return <div className="preview-toolbar-tools area-preview-tools" aria-label="预览工具栏">
    <div className="preview-context-tools">
      <span className="preview-context-label">设备预设</span>
      <select className="preview-context-select preview-preset-select" aria-label="设备预设" value={previewPreset} disabled={!p.hasScene}
        onChange={(event) => {
          const hit = previewPresets.find((item) => item.id === event.target.value);
          if (hit) { p.onViewport({ width: hit.width, height: hit.height }); p.onDeviceShell(hit.shell); }
        }}>
        {presetGroups.map((group) => <optgroup key={group} label={group}>
          {previewPresets.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </optgroup>)}
        <option value="custom">自定义</option>
      </select>
      <button className="btn preview-cycle-button" type="button" aria-label="循环切换设备预设" title="循环切换设备预设"
        disabled={!p.hasScene || previewPresets.length < 2}
        onClick={() => { const next = nextPreviewPreset(previewPresets, previewPreset); if (next) { p.onViewport({ width: next.width, height: next.height }); p.onDeviceShell(next.shell); } }}>↻</button>
      <button className={`btn preview-toggle-button${p.showDeviceShell ? " on" : ""}`} type="button" aria-pressed={p.showDeviceShell}
        aria-label="显示设备壳" title="切换白色设备壳" disabled={!p.hasScene} onClick={p.onToggleDeviceShell}>设备壳</button>
      <span className="preview-context-size">{currentPreviewPreset ? `${currentPreviewPreset.width} × ${currentPreviewPreset.height}` : `${p.viewport.width} × ${p.viewport.height}`}</span>
    </div>
    <div className="preview-context-tools">
      <span className="preview-context-label">视口</span>
      <label className="preview-context-number"><span>宽</span><input type="number" min="1" aria-label="预览宽度" value={p.viewport.width} disabled={!p.hasScene}
        onChange={(event) => p.onViewport({ ...p.viewport, width: Math.max(1, +event.target.value || 1) })} /></label>
      <label className="preview-context-number"><span>高</span><input type="number" min="1" aria-label="预览高度" value={p.viewport.height} disabled={!p.hasScene}
        onChange={(event) => p.onViewport({ ...p.viewport, height: Math.max(1, +event.target.value || 1) })} /></label>
    </div>
    <div className="preview-context-tools">
      <span className="preview-context-label">缩放</span>
      <select className="preview-context-select preview-scale-select" aria-label="预览缩放方式" value={p.scaleMode} disabled={!p.hasScene}
        onChange={(event) => p.onScaleMode(event.target.value as ScaleMode)}>
        {PREVIEW_SCALE_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <button className="btn preview-cycle-button" type="button" aria-label="循环切换缩放方式" title="循环切换缩放方式" disabled={!p.hasScene}
        onClick={() => p.onScaleMode(nextPreviewScaleMode(p.scaleMode))}>↻</button>
    </div>
    {p.showSafeArea && <div className="device-safe-area">
      {(["left", "right", "top", "bottom"] as const).map((side) => <label key={side}>{previewSideLabels[side]}
        <input type="number" min="0" value={p.safeArea[side]} aria-label={`安全区${previewSideLabels[side]}`}
          onChange={(event) => p.onSafeArea({ ...p.safeArea, [side]: Math.max(0, +event.target.value || 0) })} /></label>)}
    </div>}
    <button className={`btn preview-toggle-button${p.useNineSlicePreview ? " on" : ""}`} type="button" aria-pressed={p.useNineSlicePreview}
      aria-label="九宫格预览" title="切换九宫格预览" disabled={!p.hasScene} onClick={p.onToggleNineSlicePreview}>九宫格预览</button>
    <button className={`btn preview-toggle-button${p.previewLayoutMode === "edit" ? " on" : ""}`} type="button"
      aria-pressed={p.previewLayoutMode === "edit"} aria-label={p.previewLayoutMode === "edit" ? "切换纯预览布局" : "切换编辑检查布局"}
      title={p.previewLayoutMode === "edit" ? "切换为纯预览" : "打开编辑检查布局"} disabled={!p.hasScene} onClick={p.onTogglePreviewLayout}>
      {p.previewLayoutMode === "edit" ? "纯预览" : "编辑检查"}
    </button>
  </div>;
}
