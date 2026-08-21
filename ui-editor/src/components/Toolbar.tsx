import { useEffect, useState } from "react";

interface Props {
  onLoadFile: (buffer: ArrayBuffer, name: string) => void;
  psdList: string[];
  onLoadPsdFromFolder: (name: string) => void;
  hasScene: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportAnchors: () => void;
  onExportHtml: () => void;
  onGlobalFont: (font: string) => void;
}

/** 应用栏：文件打开 / 全局字体 / 历史 / 导出 */
export default function Appbar(p: Props) {
  const onFile = async (f: File | undefined) => {
    if (f) p.onLoadFile(await f.arrayBuffer(), f.name);
  };

  const [fontList, setFontList] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { await document.fonts.ready; } catch { /* 等字体就绪 */ }
      if (!alive) return;
      const fams = new Set<string>();
      document.fonts.forEach((f) => { if (f.family) fams.add(f.family.replace(/^"/, "").replace(/"$/, "")); });
      setFontList([...fams]);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <header className="appbar">
      <span className="logo">PSD → UI</span>
      <span className="vsep" />
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
      <span className="vsep" />
      <span className="grow" />
      <input className="global-font" list="global-font-list" placeholder="项目字体（应用到全部文本）" disabled={!p.hasScene}
        onChange={(e) => { const v = e.target.value.trim(); if (v) p.onGlobalFont(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") { const v = e.currentTarget.value.trim(); if (v) p.onGlobalFont(v); } }} />
      <datalist id="global-font-list">
        {fontList.map((f) => <option key={f} value={f} />)}
      </datalist>
      <span className="vsep" />
      <button className="icon-btn" disabled={!p.canUndo} onClick={p.onUndo} title="后退一步 (Ctrl+Z)">↩</button>
      <button className="icon-btn" disabled={!p.canRedo} onClick={p.onRedo} title="前进一步 (Ctrl+X)">↪</button>
      <span className="vsep" />
      <button className="btn" disabled={!p.hasScene} onClick={p.onExportAnchors} title="保存为 psd 同名 json（锚点+九宫格+控件）">导出配置</button>
      <button className="btn primary" disabled={!p.hasScene} onClick={p.onExportHtml} title="导出自适应网页">导出 HTML</button>
    </header>
  );
}
