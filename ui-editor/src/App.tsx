import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutEngine, reanchor } from "./layoutEngine";
import { importPsd } from "./psdImport";
import { renderOverlay, renderUi } from "./renderer";
import type { LayoutContext, UINode, UIScene } from "./types";
import Toolbar from "./components/Toolbar";
import LayerPanel from "./components/LayerPanel";
import Inspector from "./components/Inspector";

export const PRESETS: [string, number, number][] = [
  ["1920 × 1080", 1920, 1080],
  ["2340 × 1080", 2340, 1080],
  ["2560 × 1440", 2560, 1440],
  ["1280 × 720", 1280, 720],
  ["1080 × 1920", 1080, 1920],
  ["390 × 844", 390, 844],
  ["375 × 812", 375, 812],
];

export default function App() {
  const [scene, setScene] = useState<UIScene | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [safeArea, setSafeArea] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [showDesignBorder, setShowDesignBorder] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);

  const uiRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const layoutCtx: LayoutContext | null = useMemo(
    () => (scene ? {
      designWidth: scene.designWidth,
      designHeight: scene.designHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      safeArea,
    } : null),
    [scene, viewport, safeArea],
  );
  const result = useMemo(
    () => (scene && layoutCtx ? new LayoutEngine().layoutScene(scene, layoutCtx) : null),
    [scene, layoutCtx],
  );

  // 画布尺寸（含 devicePixelRatio）与渲染
  useEffect(() => {
    if (!result) return;
    const ui = uiRef.current, ov = ovRef.current;
    if (!ui || !ov || !layoutCtx) return;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [ui, ov]) {
      c.width = layoutCtx.viewportWidth * dpr;
      c.height = layoutCtx.viewportHeight * dpr;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    renderUi(ui.getContext("2d")!, result);
    renderOverlay(ov.getContext("2d")!, result, layoutCtx, {
      selectedId, showGrid: false, showSafeArea, showDesignBorder,
    });
  }, [result, layoutCtx, selectedId, showSafeArea, showDesignBorder]);

  // 画布 CSS 尺寸：contain 到窗口
  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current;
      if (!wrap || !layoutCtx) return;
      const s = Math.min(wrap.clientWidth / layoutCtx.viewportWidth, wrap.clientHeight / layoutCtx.viewportHeight);
      for (const c of [uiRef.current, ovRef.current]) {
        if (c) { c.style.width = `${layoutCtx.viewportWidth * s}px`; c.style.height = `${layoutCtx.viewportHeight * s}px`; }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [layoutCtx]);

  const loadPsd = useCallback((buffer: ArrayBuffer) => {
    const { scene: s, warnings: w } = importPsd(buffer);
    setScene(s);
    setWarnings(w);
    setViewport({ width: s.designWidth, height: s.designHeight });
    setSelectedId(null);
  }, []);

  const updateNode = useCallback((id: string, patch: (n: UINode) => void) => {
    setScene((prev) => prev && {
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? (patch(n), { ...n }) : n)),
    });
  }, []);

  const updateSelected = useCallback((patch: (n: UINode) => void) => {
    setScene((prev) => {
      if (!prev) return prev;
      const idx = prev.nodes.findIndex((n) => n.id === selectedId);
      if (idx < 0) return prev;
      const n = { ...prev.nodes[idx] };
      patch(n);
      const nodes = prev.nodes.slice();
      nodes[idx] = n;
      return { ...prev, nodes };
    });
  }, [selectedId]);

  // 命中检测 + 拖动（文档 §17：拖动只改 offset，不碰 designRect）
  const toLogical = (clientX: number, clientY: number) => {
    const ui = uiRef.current!;
    const r = ui.getBoundingClientRect();
    const k = layoutCtx!.viewportWidth / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!result || !layoutCtx) return;
    const p = toLogical(e.clientX, e.clientY);
    const hit = [...result.nodes]
      .sort((a, b) => b.node.zIndex - a.node.zIndex)
      .find((n) => n.node.visible && p.x >= n.rect.x && p.x <= n.rect.x + n.rect.width
        && p.y >= n.rect.y && p.y <= n.rect.y + n.rect.height);
    if (!hit) { setSelectedId(null); return; }
    setSelectedId(hit.node.id);
    if (hit.node.locked) return;
    dragRef.current = { id: hit.node.id, startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !layoutCtx || !result) return;
    const start = { x: (d.startX - (uiRef.current!.getBoundingClientRect().left)) * (layoutCtx.viewportWidth / uiRef.current!.getBoundingClientRect().width), y: (d.startY - uiRef.current!.getBoundingClientRect().top) * (layoutCtx.viewportHeight / uiRef.current!.getBoundingClientRect().height) };
    const p = toLogical(e.clientX, e.clientY);
    const dx = p.x - start.x, dy = p.y - start.y;
    updateSelected((n) => {
      if (n.adaptation.mode !== "anchor") n.adaptation.mode = "anchor"; // 拖动 → 锚点模式
      n.anchor.offsetX += dx / result.scale;   // 预览位移 → 设计 offset（÷scale 等比）
      n.anchor.offsetY += dy / result.scale;
    });
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY };
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div className="app">
      <Toolbar
        onLoadFile={loadPsd} viewport={viewport} onViewport={setViewport}
        safeArea={safeArea} onSafeArea={setSafeArea}
        showSafeArea={showSafeArea} onShowSafeArea={setShowSafeArea}
        showDesignBorder={showDesignBorder} onShowDesignBorder={setShowDesignBorder}
        warnings={warnings} hasScene={!!scene}
      />
      <div className="body">
        <LayerPanel
          nodes={scene?.nodes ?? []} selectedId={selectedId} onSelect={setSelectedId}
          onToggleVisible={(id) => updateNode(id, (n) => { n.visible = !n.visible; })}
          onToggleLock={(id) => updateNode(id, (n) => { n.locked = !n.locked; })}
        />
        <div className="canvas-wrap" ref={wrapRef}>
          <div className="canvas-stack">
            <canvas ref={uiRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
            <canvas ref={ovRef} style={{ pointerEvents: "none" }} />
          </div>
        </div>
        <Inspector
          node={scene?.nodes.find((n) => n.id === selectedId) ?? null}
          rect={result?.nodes.find((n) => n.node.id === selectedId)?.rect ?? null}
          viewport={viewport}
          onUpdate={updateSelected}
          onReanchor={(a) => updateSelected((n) => {
            const r = result!.nodes.find((x) => x.node.id === n.id)!.rect;
            reanchor(n, scene!.designWidth, scene!.designHeight, r, layoutCtx!, result!, a);
          })}
        />
      </div>
    </div>
  );
}
