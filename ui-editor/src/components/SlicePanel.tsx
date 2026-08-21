import { useEffect, useRef, useState } from "react";

interface Props {
  sources: { name: string; canvas: HTMLCanvasElement }[];
  psdName: string | null;
}

const DEFAULT_SLICE = { left: 0, top: 0, right: 0, bottom: 0 };
type Slice = typeof DEFAULT_SLICE;

export function loadSlice(psdName: string, imgName: string): Slice {
  try {
    const s = localStorage.getItem(`ui2html.slice.${psdName}.${imgName}`);
    if (s) return { ...DEFAULT_SLICE, ...JSON.parse(s) };
  } catch { /* 忽略损坏数据 */ }
  return { ...DEFAULT_SLICE };
}

/** 九宫格标记面板：图片 + 4 条可拖动引导线 + 边距数值，自动保存 */
export default function SlicePanel(p: Props) {
  const [selected, setSelected] = useState<string | null>(p.sources[0]?.name ?? null);
  const [slice, setSlice] = useState<Slice>(() => selected ? loadSlice(p.psdName ?? "", selected) : { ...DEFAULT_SLICE });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"top" | "bottom" | "left" | "right" | null>(null);

  const src = p.sources.find((s) => s.name === selected) ?? null;
  const scaleRef = useRef(1); // 画布像素 / 图片像素

  useEffect(() => {
    setSelected(p.sources[0]?.name ?? null);
  }, [p.sources]);

  useEffect(() => {
    if (!selected) return;
    setSlice(loadSlice(p.psdName ?? "", selected));
  }, [selected, p.psdName]);

  // 绘制图片 + 引导线
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !src) return;
    const dpr = window.devicePixelRatio || 1;
    const maxW = 240, maxH = 150;
    const sc = Math.min(maxW / src.canvas.width, maxH / src.canvas.height, 1);
    scaleRef.current = sc;
    cv.width = src.canvas.width * sc * dpr;
    cv.height = src.canvas.height * sc * dpr;
    cv.style.width = src.canvas.width * sc + "px";
    cv.style.height = src.canvas.height * sc + "px";
    const g = cv.getContext("2d")!;
    g.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
    g.clearRect(0, 0, src.canvas.width, src.canvas.height);
    g.drawImage(src.canvas, 0, 0);
    // 引导线（绿色，参考 9-Slice 插件）
    g.strokeStyle = "#00ff00";
    g.lineWidth = 1 / sc;
    const { left, top, right, bottom } = slice;
    const w = src.canvas.width, h = src.canvas.height;
    [[top, 0, w], [h - bottom, 0, w]].forEach(([y]) => {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    });
    [[left, 0, h], [w - right, 0, h]].forEach(([x]) => {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    });
  }, [src, slice]);

  const save = (s: Slice) => {
    setSlice(s);
    if (selected && p.psdName) {
      localStorage.setItem(`ui2html.slice.${p.psdName}.${selected}`, JSON.stringify(s));
    }
  };

  // 拖动引导线
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!src) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = (e.clientX - rect.left) / scaleRef.current;
    const py = (e.clientY - rect.top) / scaleRef.current;
    const w = src.canvas.width, h = src.canvas.height;
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
    if (!dragRef.current || !src) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = Math.max(0, Math.round((e.clientX - rect.left) / scaleRef.current));
    const py = Math.max(0, Math.round((e.clientY - rect.top) / scaleRef.current));
    const w = src.canvas.width, h = src.canvas.height;
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

  if (!p.sources.length) {
    return <div className="slice-empty">未找到「9」文件夹（约定：名为 9 的文件夹内图片作为九宫格替换源）</div>;
  }

  return (
    <div className="slice-panel">
      <div className="slice-list">
        {p.sources.map((s) => (
          <button key={s.name} className={s.name === selected ? "on" : ""}
            onClick={() => setSelected(s.name)}>{s.name}</button>
        ))}
      </div>
      {src ? (
        <>
          <div className="slice-preview">
            <canvas ref={canvasRef} onPointerDown={onPointerDown}
              onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          </div>
          <div className="slice-nums">
            {num("top", src.canvas.height - 1)}
            {num("bottom", src.canvas.height - 1)}
            {num("left", src.canvas.width - 1)}
            {num("right", src.canvas.width - 1)}
          </div>
          <p className="slice-hint">拖动绿色线标记九宫格边距（自动保存）</p>
        </>
      ) : (
        <p className="slice-empty">选择左侧图片</p>
      )}
    </div>
  );
}
