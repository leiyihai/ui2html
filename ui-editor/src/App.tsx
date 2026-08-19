import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutEngine, reanchor } from "./layoutEngine";
import { importPsd } from "./psdImport";
import { renderOverlay, renderUi } from "./renderer";
import { buildExportHtml } from "./exportHtml";
import type { LayoutContext, ScaleMode, UINode, UIScene } from "./types";
import Toolbar from "./components/Toolbar";
import LayerPanel from "./components/LayerPanel";
import Inspector from "./components/Inspector";

export const PRESETS: [string, number, number][] = [
  ["16:9 (1920 × 1080)", 1920, 1080],
  ["18:9 (2160 × 1080)", 2160, 1080],
  ["21:9 (2520 × 1080)", 2520, 1080],
  ["iPad 横屏 (1024 × 768)", 1024, 768],
  ["iPad 竖屏 (768 × 1024)", 768, 1024],
  ["iPhone 刘海屏 (390 × 844)", 390, 844],
];

// 树工具：组节点含 children，节点操作需要递归
function walkNodes(nodes: UINode[], out: UINode[] = []): UINode[] {
  for (const n of nodes) { out.push(n); if (n.children) walkNodes(n.children, out); }
  return out;
}
function mapNodes(nodes: UINode[], id: string, fn: (n: UINode) => void): UINode[] {
  return nodes.map((n) => {
    if (n.id === id) { const c = { ...n }; fn(c); return c; }
    if (n.children) return { ...n, children: mapNodes(n.children, id, fn) };
    return n;
  });
}
function applySnap(nodes: UINode[], snap: Snapshot): UINode[] {
  return nodes.map((n) => {
    const c = snap[n.id] ? { ...n, ...snap[n.id] } : { ...n };
    if (c.children) c.children = applySnap(c.children, snap);
    return c;
  });
}

// 撤销快照：只存可变属性（image 是 canvas 不能序列化）
type Snapshot = Record<string, {
  anchor: UINode["anchor"]; adaptation: UINode["adaptation"];
  visible: boolean; opacity: number; zIndex: number; rotation: number;
  scale: { x: number; y: number }; name: string; locked?: boolean;
}>;
const snapScene = (s: UIScene): Snapshot => Object.fromEntries(walkNodes(s.nodes).map((n) => [n.id, {
  anchor: { ...n.anchor }, adaptation: { ...n.adaptation }, visible: n.visible,
  opacity: n.opacity, zIndex: n.zIndex, rotation: n.rotation,
  scale: { ...n.scale }, name: n.name, locked: n.locked,
}]));

const HISTORY_LIMIT = 50; // 步数不用保留太多

export default function App() {
  const [scene, setScene] = useState<UIScene | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [safeArea, setSafeArea] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [scaleMode, setScaleMode] = useState<ScaleMode>("cover");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showDesignBorder, setShowDesignBorder] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [histLen, setHistLen] = useState(0);
  const [futureLen, setFutureLen] = useState(0);
  const [psdName, setPsdName] = useState<string | null>(null);
  const [psdList, setPsdList] = useState<string[]>([]);
  const [exportMsg, setExportMsg] = useState("");

  const uiRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const sceneRef = useRef<UIScene | null>(null); // 同步引用（事件中立即更新）
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);

  const layoutCtx: LayoutContext | null = useMemo(
    () => (scene ? {
      designWidth: scene.designWidth,
      designHeight: scene.designHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      safeArea,
      scaleMode,
    } : null),
    [scene, viewport, safeArea, scaleMode],
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
      const s = Math.min(wrap.clientWidth / layoutCtx.viewportWidth, wrap.clientHeight / layoutCtx.viewportHeight) * 0.72;
      for (const c of [uiRef.current, ovRef.current]) {
        if (c) { c.style.width = `${layoutCtx.viewportWidth * s}px`; c.style.height = `${layoutCtx.viewportHeight * s}px`; }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [layoutCtx]);

  // ---- 状态变更统一入口（record=true 时压入历史）----
  const applyScene = useCallback((next: UIScene) => { sceneRef.current = next; setScene(next); }, []);
  const pushHistory = useCallback((s: UIScene) => {
    historyRef.current.push(snapScene(s));
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    setHistLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  const mutateScene = useCallback((mutator: (s: UIScene) => UIScene, record = true) => {
    const prev = sceneRef.current;
    if (!prev) return;
    if (record) pushHistory(prev);
    applyScene(mutator(prev));
  }, [applyScene, pushHistory]);

  // 读取 psd 文件夹列表（start.bat 同步到 public/psd/list.txt）
  useEffect(() => {
    fetch("/psd/list.txt").then((r) => r.text()).then((t) =>
      setPsdList(t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))).catch(() => { });
  }, []);

  const loadPsd = useCallback(async (buffer: ArrayBuffer, name: string) => {
    const { scene: s, warnings: w } = importPsd(buffer);
    // 应用已保存的锚点默认配置（public/anchor.json，按图层名）
    try {
        const r = await fetch("anchor.json");
        if (r.ok) {
          const presets = await r.json();
          walkNodes(s.nodes).forEach((n) => {
            const p = presets[n.name];
            if (p) {
              n.anchor = { ...n.anchor, ...p };
              if (p.mode) n.adaptation.mode = p.mode;
            }
          });
        }
    } catch { /* 无默认配置则用 PSD 推断 */ }
    historyRef.current = [];
    futureRef.current = [];
    setHistLen(0); setFutureLen(0);
    applyScene(s);
    setWarnings(w);
    setPsdName(name);
    setViewport({ width: s.designWidth, height: s.designHeight });
    setSelectedId(null);
  }, [applyScene]);

  // 从 psd 文件夹加载（下拉选择）
  const loadPsdFromFolder = useCallback(async (name: string) => {
    try {
      const r = await fetch(`/psd/${name}`);
      if (!r.ok) throw 0;
      await loadPsd(await r.arrayBuffer(), name);
    } catch { setExportMsg(`无法加载 psd/${name}（请用 start.bat 启动）`); }
  }, [loadPsd]);

  const exportAnchors = useCallback(() => {
    if (!scene) return;
    const data = Object.fromEntries(walkNodes(scene.nodes).map((n) => [n.name, {
      parentX: n.anchor.parentX, parentY: n.anchor.parentY,
      selfX: n.anchor.selfX, selfY: n.anchor.selfY,
      offsetX: Math.round(n.anchor.offsetX * 10) / 10,
      offsetY: Math.round(n.anchor.offsetY * 10) / 10,
      mode: n.adaptation.mode,
    }]));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "anchor.json";
    a.click();
  }, [scene]);

  const exportHtml = useCallback(async () => {
    if (!scene) return;
    const html = buildExportHtml(scene, scaleMode, safeArea);
    const base = (psdName ?? "ui").replace(/\.psd$/i, "");
    try {
      const r = await fetch("/save-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: base, html }),
      });
      if (!r.ok) throw 0;
      setExportMsg(`已导出 export/${base}.html ✓`);
      return;
    } catch {
      // dev server 不可用（file:// 打开）时回退浏览器下载
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.html`;
      a.click();
      setExportMsg("已下载（未通过 start.bat 启动，无法写入 export 文件夹）");
    }
  }, [scene, scaleMode, safeArea, psdName]);

  const updateNode = useCallback((id: string, patch: (n: UINode) => void) => {
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, id, patch) }));
  }, [mutateScene]);

  /** 全局字体：一次性替换场景内所有文本节点的字体 */
  const applyGlobalFont = useCallback((font: string) => {
    mutateScene((s) => {
      const nodes = s.nodes.map((n) => ({ ...n }));
      let n = 0;
      walkNodes(nodes).forEach((x) => { if (x.text) { x.text = { ...x.text, font }; n++; } });
      setExportMsg(`已将全部 ${n} 个文本的字体替换为「${font}」`);
      return { ...s, nodes };
    });
  }, [mutateScene]);

  const updateSelected = useCallback((patch: (n: UINode) => void, record = true) => {
    const prev = sceneRef.current;
    if (!prev) return;
    if (!walkNodes(prev.nodes).some((x) => x.id === selectedId)) return;
    mutateScene((s) => ({ ...s, nodes: mapNodes(s.nodes, selectedId!, patch) }), record);
  }, [selectedId, mutateScene]);

  // ---- 撤销 / 重做（Ctrl+Z 后退，Ctrl+X 前进）----
  const undo = useCallback(() => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    futureRef.current.push(snapScene(sceneRef.current!));
    const s = sceneRef.current!;
    applyScene({ ...s, nodes: applySnap(s.nodes, snap) });
    setHistLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, [applyScene]);

  const redo = useCallback(() => {
    const snap = futureRef.current.pop();
    if (!snap) return;
    historyRef.current.push(snapScene(sceneRef.current!));
    const s = sceneRef.current!;
    applyScene({ ...s, nodes: applySnap(s.nodes, snap) });
    setHistLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
  }, [applyScene]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
      else if (e.key === "x" || e.key === "X") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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
      .find((n) => n.visible && p.x >= n.rect.x && p.x <= n.rect.x + n.rect.width
        && p.y >= n.rect.y && p.y <= n.rect.y + n.rect.height);
    if (!hit) { setSelectedId(null); return; }
    setSelectedId(hit.node.id);
    if (hit.node.locked) return;
    pushHistory(sceneRef.current!); // 拖动前记录一次，撤销回退整个拖动
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
      n.anchor.offsetX += dx / result.scaleX;   // 预览位移 → 设计 offset（÷scale 等比）
      n.anchor.offsetY += dy / result.scaleY;
    }, false); // 拖动中不记录（按下时已记录一次）
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY };
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div className="app">
      <Toolbar
        onLoadFile={loadPsd} viewport={viewport} onViewport={setViewport}
        safeArea={safeArea} onSafeArea={setSafeArea}
        scaleMode={scaleMode} onScaleMode={setScaleMode}
        showSafeArea={showSafeArea} onShowSafeArea={setShowSafeArea}
        showDesignBorder={showDesignBorder} onShowDesignBorder={setShowDesignBorder}
        warnings={warnings} hasScene={!!scene} onExportAnchors={exportAnchors} onExportHtml={exportHtml}
        canUndo={histLen > 0} canRedo={futureLen > 0} onUndo={undo} onRedo={redo}
        psdList={psdList} onLoadPsdFromFolder={loadPsdFromFolder} exportMsg={exportMsg}
        onGlobalFont={applyGlobalFont}
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
          node={walkNodes(scene?.nodes ?? []).find((n) => n.id === selectedId) ?? null}
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
