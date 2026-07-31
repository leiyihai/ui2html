import { PRESETS } from "../App";

interface Props {
  onLoadFile: (buffer: ArrayBuffer) => void;
  viewport: { width: number; height: number };
  onViewport: (v: { width: number; height: number }) => void;
  safeArea: { left: number; right: number; top: number; bottom: number };
  onSafeArea: (v: { left: number; right: number; top: number; bottom: number }) => void;
  showSafeArea: boolean;
  onShowSafeArea: (b: boolean) => void;
  showDesignBorder: boolean;
  onShowDesignBorder: (b: boolean) => void;
  warnings: string[];
  hasScene: boolean;
}

export default function Toolbar(p: Props) {
  const onFile = async (f: File | undefined) => {
    if (f) p.onLoadFile(await f.arrayBuffer());
  };

  return (
    <header className="toolbar">
      <span className="title">UI Layout Editor</span>
      <label className="btn">
        打开 PSD
        <input type="file" accept=".psd" style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <button className="btn" onClick={async () => {
        const r = await fetch("/test.psd");
        p.onLoadFile(await r.arrayBuffer());
      }}>加载示例 test.psd</button>

      <span className="sep" />
      <select value={`${p.viewport.width} × ${p.viewport.height}`}
        onChange={(e) => {
          const hit = PRESETS.find(([n]) => n === e.target.value);
          if (hit) p.onViewport({ width: hit[1], height: hit[2] });
        }}>
        {PRESETS.map(([n]) => (
          <option key={n} value={n} disabled={!p.hasScene}>{n}</option>
        ))}
      </select>
      <label className="num">宽 <input type="number" value={p.viewport.width}
        onChange={(e) => p.onViewport({ ...p.viewport, width: +e.target.value || 0 })} /></label>
      <label className="num">高 <input type="number" value={p.viewport.height}
        onChange={(e) => p.onViewport({ ...p.viewport, height: +e.target.value || 0 })} /></label>

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
