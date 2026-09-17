import { useEffect, useState } from "react";
import { ENGINE_EDITOR_FONT_FAMILY } from "../engineFont";
import { nextFontInCycle } from "../fontPicker";
import { nextPreviewPreset, nextPreviewScaleMode, PREVIEW_SCALE_MODES, presetsForDesign, type DeviceShell } from "../devicePreview";
import type { ScaleMode } from "../types";
import MenuBar from "./MenuBar";

interface PreviewToolbarConfig {
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
}

interface Props {
  projectName: string;
  dirty: boolean;
  hasScene: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onNew: () => void;
  onOpenProject: () => void;
  onImportPsd: (buffer: ArrayBuffer, name: string) => void;
  onImportImages: (files: File[]) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportHtml: () => void;
  onExportEngineJson: () => void;
  onGlobalFont: (font: string) => void;
  nameMode: import("./ControlsPanel").LayerNameMode;
  onNameModeChange: (mode: import("./ControlsPanel").LayerNameMode) => void;
  onAiRename: () => void;
  onTypeConvert: () => void;
  useNineSlicePreview: boolean;
  onToggleNineSlicePreview: () => void;
  workspace: import("./WorkspaceTabs").Workspace;
  onWorkspace: (workspace: import("./WorkspaceTabs").Workspace) => void;
  onCloseProject: () => void;
  onRename: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onMoveLayer: (direction: "up" | "down") => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onShowSettings?: () => void;
  showSafeArea: boolean;
  onToggleSafeArea: () => void;
  showDesignBorder: boolean;
  onToggleDesignBorder: () => void;
  preview: PreviewToolbarConfig;
}

/** 当前流程工具栏：只放与当前工作区相关的高频操作。 */
export default function Appbar(p: Props) {
  const [fontList, setFontList] = useState<string[]>([]);
  const [selectedFont, setSelectedFont] = useState(ENGINE_EDITOR_FONT_FAMILY);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { await document.fonts.ready; } catch { /* 等字体就绪 */ }
      if (!alive) return;
      const families = new Set<string>();
      document.fonts.forEach((font) => {
        if (font.family) families.add(font.family.replace(/^"/, "").replace(/"$/, ""));
      });
      setFontList([ENGINE_EDITOR_FONT_FAMILY, ...[...families].filter((font) => font !== ENGINE_EDITOR_FONT_FAMILY)]);
    })();
    return () => { alive = false; };
  }, []);

  const applyFont = (font: string) => {
    if (!font) return;
    setSelectedFont(font);
    p.onGlobalFont(font);
  };

  const cycleFont = () => {
    const nextFont = nextFontInCycle(fontList, selectedFont);
    if (nextFont) applyFont(nextFont);
  };

  const previewPresets = presetsForDesign(p.preview.designWidth, p.preview.designHeight);
  const presetGroups = [...new Set(previewPresets.map((item) => item.group))];
  const previewPreset = previewPresets.find((item) => item.width === p.preview.viewport.width && item.height === p.preview.viewport.height
    && item.shell === p.preview.deviceShell)?.id ?? "custom";
  const currentPreviewPreset = previewPresets.find((item) => item.id === previewPreset);
  const previewSideLabels = { left: "左", right: "右", top: "上", bottom: "下" } as const;

  return (
    <header className="app-shell-header">
      <MenuBar
        projectName={p.projectName} dirty={p.dirty}
        hasScene={p.hasScene} canUndo={p.canUndo} canRedo={p.canRedo}
        workspace={p.workspace} onWorkspace={p.onWorkspace}
        onNew={p.onNew} onOpenProject={p.onOpenProject}
        onImportPsd={p.onImportPsd} onImportImages={p.onImportImages}
        onSave={p.onSave} onSaveAs={p.onSaveAs} onCloseProject={p.onCloseProject}
        onUndo={p.onUndo} onRedo={p.onRedo} onRename={p.onRename}
        onGroup={p.onGroup} onUngroup={p.onUngroup} onMoveLayer={p.onMoveLayer}
        onShowShortcuts={p.onShowShortcuts} onShowAbout={p.onShowAbout}
        onShowSettings={p.onShowSettings}
        onExportHtml={p.onExportHtml} onExportEngineJson={p.onExportEngineJson}
        showSafeArea={p.showSafeArea} onToggleSafeArea={p.onToggleSafeArea}
        showDesignBorder={p.showDesignBorder} onToggleDesignBorder={p.onToggleDesignBorder}
      />
      <div className={`appbar${p.workspace === "preview" ? " preview-appbar" : ""}`}>
      <div className="toolbar-tools">
      {p.workspace === "controls" && <>
        <button className="btn tool-button" disabled={!p.hasScene} onClick={() => p.onNameModeChange(p.nameMode === "original" ? "ai" : "original")}
          title={p.nameMode === "original" ? "切换到工程名称" : "切换到 PSD 原名"}>
          {p.nameMode === "original" ? "PSD 原名" : "工程名称"}
        </button>
        <button className="btn tool-button" disabled={!p.hasScene} onClick={p.onAiRename} title="调用 AI 为节点和图片资源统一命名">AI 命名</button>
        <button className="btn tool-button" disabled={!p.hasScene} onClick={p.onTypeConvert} title="打开控件类型选择菜单（T）">类型转换</button>
        <div className="font-picker" title="选择字体后立即应用到全部文本">
          <select
            className="global-font"
            aria-label="项目字体"
            value={selectedFont}
            disabled={!p.hasScene || !fontList.length}
            onChange={(event) => applyFont(event.target.value)}
          >
            {fontList.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
          <button
            className="btn font-cycle"
            type="button"
            aria-label="循环切换字体"
            title="循环切换字体"
            disabled={!p.hasScene || fontList.length < 2}
            onClick={cycleFont}
          >↻</button>
        </div>
      </>}
      {p.workspace === "preview" && <div className="preview-toolbar-tools" aria-label="预览工具栏">
        <div className="preview-context-tools">
          <span className="preview-context-label">设备预设</span>
          <select className="preview-context-select preview-preset-select" aria-label="设备预设" value={previewPreset} disabled={!p.hasScene} onChange={(event) => {
            const hit = previewPresets.find((item) => item.id === event.target.value);
            if (hit) { p.preview.onViewport({ width: hit.width, height: hit.height }); p.preview.onDeviceShell(hit.shell); }
          }}>
            {presetGroups.map((group) => (
              <optgroup key={group} label={group}>
                {previewPresets.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>
            ))}
            <option value="custom">自定义</option>
          </select>
          <button className="btn preview-cycle-button" type="button" aria-label="循环切换设备预设" title="循环切换设备预设" disabled={!p.hasScene || previewPresets.length < 2}
            onClick={() => { const next = nextPreviewPreset(previewPresets, previewPreset); if (next) { p.preview.onViewport({ width: next.width, height: next.height }); p.preview.onDeviceShell(next.shell); } }}>
            ↻
          </button>
          <button className={`btn preview-toggle-button${p.preview.showDeviceShell ? " on" : ""}`} type="button"
            aria-pressed={p.preview.showDeviceShell} aria-label="显示设备壳" title="切换白色设备壳"
            disabled={!p.hasScene} onClick={p.preview.onToggleDeviceShell}>
            设备壳
          </button>
          <span className="preview-context-size">{currentPreviewPreset ? `${currentPreviewPreset.width} × ${currentPreviewPreset.height}` : `${p.preview.viewport.width} × ${p.preview.viewport.height}`}</span>
        </div>
        <div className="preview-context-tools">
          <span className="preview-context-label">视口</span>
          <label className="preview-context-number"><span>宽</span><input type="number" min="1" aria-label="预览宽度" value={p.preview.viewport.width} disabled={!p.hasScene}
            onChange={(event) => p.preview.onViewport({ ...p.preview.viewport, width: Math.max(1, +event.target.value || 1) })} /></label>
          <label className="preview-context-number"><span>高</span><input type="number" min="1" aria-label="预览高度" value={p.preview.viewport.height} disabled={!p.hasScene}
            onChange={(event) => p.preview.onViewport({ ...p.preview.viewport, height: Math.max(1, +event.target.value || 1) })} /></label>
        </div>
        <div className="preview-context-tools">
          <span className="preview-context-label">缩放</span>
          <select className="preview-context-select preview-scale-select" aria-label="预览缩放方式" value={p.preview.scaleMode} disabled={!p.hasScene} onChange={(event) => p.preview.onScaleMode(event.target.value as ScaleMode)}>
            {PREVIEW_SCALE_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button className="btn preview-cycle-button" type="button" aria-label="循环切换缩放方式" title="循环切换缩放方式" disabled={!p.hasScene}
            onClick={() => p.preview.onScaleMode(nextPreviewScaleMode(p.preview.scaleMode))}>
            ↻
          </button>
        </div>
        {p.preview.showSafeArea && <div className="device-safe-area">
          {(["left", "right", "top", "bottom"] as const).map((side) => (
            <label key={side}>{previewSideLabels[side]}
              <input type="number" min="0" value={p.preview.safeArea[side]} aria-label={`安全区${previewSideLabels[side]}`}
                onChange={(event) => p.preview.onSafeArea({ ...p.preview.safeArea, [side]: Math.max(0, +event.target.value || 0) })} /></label>
          ))}
        </div>}
        <button className={`btn preview-toggle-button${p.useNineSlicePreview ? " on" : ""}`} type="button"
          aria-pressed={p.useNineSlicePreview} aria-label="九宫格预览" title="切换九宫格预览"
          disabled={!p.hasScene} onClick={p.onToggleNineSlicePreview}>
          九宫格预览
        </button>
      </div>}
      </div>
      </div>
    </header>
  );
}
