import { useEffect, useState } from "react";
import { ENGINE_EDITOR_FONT_FAMILY } from "../engineFont";
import { nextFontInCycle } from "../fontPicker";

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
}

/** 应用栏：工程生命周期、素材导入、历史与预览导出。 */
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
    <header className="appbar">
      <span className="logo">UI Editor</span>
      <span className="project-title" title={p.projectName}>
        {p.projectName}{p.dirty ? " ●" : ""}
      </span>
      <span className="vsep" />
      <button className="btn" onClick={p.onNew}>新建</button>
      <button className="btn" onClick={p.onOpenProject}>打开工程</button>
      <label className="btn">
        导入 PSD
        <input
          type="file"
          accept=".psd,.psb"
          style={{ display: "none" }}
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = event.target.files?.[0];
            if (file) p.onImportPsd(await file.arrayBuffer(), file.name);
            input.value = "";
          }}
        />
      </label>
      <label className="btn">
        导入图片
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/svg+xml"
          multiple
          style={{ display: "none" }}
          onChange={(event) => {
            p.onImportImages([...event.target.files ?? []]);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <span className="vsep" />
      <button className="btn primary" disabled={!p.hasScene} onClick={p.onSave} title="保存工程 (Ctrl+S)">保存</button>
      <button className="btn" disabled={!p.hasScene} onClick={p.onSaveAs}>另存为</button>
      <span className="grow" />
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
      <span className="vsep" />
      <button className="btn" disabled={!p.canUndo} onClick={p.onUndo} title="后退一步 (Ctrl+Z)">↩ 撤销</button>
      <button className="btn" disabled={!p.canRedo} onClick={p.onRedo} title="前进一步 (Ctrl+X)">↪ 重做</button>
      <button className="btn" disabled={!p.hasScene} onClick={p.onExportHtml}>预览 HTML</button>
      <button className="btn primary" disabled={!p.hasScene} onClick={p.onExportEngineJson}>导出 JSON</button>
    </header>
  );
}
