import { useEffect, useRef, useState } from "react";

export type Slice = { left: number; top: number; right: number; bottom: number };
export const DEFAULT_SLICE: Slice = { left: 0, top: 0, right: 0, bottom: 0 };

export function loadSlice(psdName: string, imgName: string): Slice {
  try {
    const s = localStorage.getItem(`ui2html.slice.${psdName}.${imgName}`);
    if (s) return { ...DEFAULT_SLICE, ...JSON.parse(s) };
  } catch { /* 忽略损坏数据 */ }
  return { ...DEFAULT_SLICE };
}

/** 左侧九宫格图片列表（类似图层面板） */
export function SliceList(p: {
  sources: { name: string; canvas: HTMLCanvasElement }[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  if (!p.sources.length) {
    return <div className="slice-empty">未找到「9」文件夹（约定：名为 9 的文件夹内图片作为九宫格替换源）</div>;
  }
  return (
    <ul className="slice-list">
      {p.sources.map((s) => (
        <li key={s.name} className={s.name === p.selected ? "sel" : ""}
          onClick={() => p.onSelect(s.name)}>
          <span className="type-ic t-image">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
              <circle cx="6" cy="6.8" r="1" />
              <path d="M4.2 11.5 7.2 8.4l2 2 2.6-2.6" />
            </svg>
          </span>
          <span className="name">{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** 中间区域的九宫格编辑：图片预览 + 4 条可拖动引导线 + 边距数值，自动保存 */
export function SliceEditor(p: {
  source: { name: string; canvas: HTMLCanvasElement };
  psdName: string | null;
  onBack: () => void;
}) {
  const [slice, setSlice] = useState<Slice>(() => loadSlice(p.psdName ?? "", p.source.name));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"top" | "bottom" | "left" | "right" | null>(null);
  const scaleRef = useRef(1);

  // 绘制图片 + 引导线（归一化：无论原图大小都缩放到适中区域，便于操作）
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const { canvas } = p.source;
    const dpr = window.devicePixelRatio || 1;
    const maxW = 420, maxH = 300;
    const sc = Math.max(0.25, Math.min(maxW / canvas.width, maxH / canvas.height, 8));
    scaleRef.current = sc;
    cv.width = canvas.width * sc * dpr;
    cv.height = canvas.height * sc * dpr;
    cv.style.width = canvas.width * sc + "px";
    cv.style.height = canvas.height * sc + "px";
    const g = cv.getContext("2d")!;
    g.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(canvas, 0, 0);
    g.strokeStyle = "#00ff00";
    g.lineWidth = 1 / sc;
    const { left, top, right, bottom } = slice;
    const w = canvas.width, h = canvas.height;
    g.beginPath(); g.moveTo(0, top); g.lineTo(w, top); g.stroke();
    g.beginPath(); g.moveTo(0, h - bottom); g.lineTo(w, h - bottom); g.stroke();
    g.beginPath(); g.moveTo(left, 0); g.lineTo(left, h); g.stroke();
    g.beginPath(); g.moveTo(w - right, 0); g.lineTo(w - right, h); g.stroke();
  }, [p.source, slice]);

  const save = (s: Slice) => {
    setSlice(s);
    localStorage.setItem(`ui2html.slice.${p.psdName}.${p.source.name}`, JSON.stringify(s));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = (e.clientX - rect.left) / scaleRef.current;
    const py = (e.clientY - rect.top) / scaleRef.current;
    const w = p.source.canvas.width, h = p.source.canvas.height;
    const near = 6 / scaleRef.current;
    const { left, top, right, bottom } = slice;
    const lines: [string, number][] = [
      ["top", top], ["bottom", h - bottom], ["left", left], ["right", w - right],
    ];
    const hit = lines
      .map(([d, v]) => [d, v, d === "top" || d === "bottom" ? Math.abs(py - v) : Math.abs(px - v)] as const)
      .filter(([, , dist]) => dist < near)
      .sort((a, b) => a[2] - b[2])[0];
    if (hit) { dragRef.current = hit[0] as "top" | "bottom" | "left" | "right"; (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = Math.max(0, Math.round((e.clientX - rect.left) / scaleRef.current));
    const py = Math.max(0, Math.round((e.clientY - rect.top) / scaleRef.current));
    const w = p.source.canvas.width, h = p.source.canvas.height;
    const d = dragRef.current;
    save({
      ...slice,
      top: d === "top" ? Math.min(py, h - 1) : slice.top,
      bottom: d === "bottom" ? Math.min(h - py, h - 1) : slice.bottom,
      left: d === "left" ? Math.min(px, w - 1) : slice.left,
      right: d === "right" ? Math.min(w - px, w - 1) : slice.right,
    });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const num = (key: keyof Slice, max: number) => (
    <label className="slice-num">
      <span>{key === "top" ? "上" : key === "bottom" ? "下" : key === "left" ? "左" : "右"}</span>
      <input type="number" min={0} max={max} value={slice[key]}
        onChange={(e) => save({ ...slice, [key]: Math.max(0, Math.min(max, +e.target.value || 0)) })} />
    </label>
  );

  return (
    <div className="slice-editor" onClick={(e) => { if (e.target === e.currentTarget) p.onBack(); }}>
      <div className="slice-editor-head">
        <span className="slice-title">{p.source.name}</span>
        <span className="slice-hint">拖动绿色线或输入数值标记九宫格边距（自动保存）· 点击空白处返回画布</span>
      </div>
      <div className="slice-preview">
        <canvas ref={canvasRef} onPointerDown={onPointerDown}
          onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      </div>
      <div className="slice-nums">
        {num("top", p.source.canvas.height - 1)}
        {num("bottom", p.source.canvas.height - 1)}
        {num("left", p.source.canvas.width - 1)}
        {num("right", p.source.canvas.width - 1)}
      </div>
    </div>
  );
}
