import { useEffect, useState } from "react";
import { ENGINE_EDITOR_FONT_FAMILY } from "../engineFont";
import { nextFontInCycle } from "../fontPicker";
import MenuBar from "./MenuBar";

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
        onExportHtml={p.onExportHtml} onExportEngineJson={p.onExportEngineJson}
      />
      <div className="appbar">
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
      {p.workspace === "preview" && <label className="toolbar-check"><input type="checkbox" checked={p.useNineSlicePreview} disabled={!p.hasScene} onChange={p.onToggleNineSlicePreview} />九宫格预览</label>}
      </div>
      </div>
    </header>
  );
}
