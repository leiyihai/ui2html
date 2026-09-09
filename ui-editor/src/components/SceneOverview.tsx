import { useEffect, useRef } from "react";
import { renderUi } from "../renderer";
import { effectivePreviewRect } from "../resourceBindingWorkspace";
import type { LayoutResult, UINode } from "../types";

interface Props {
  result: LayoutResult | null;
  nodes: UINode[];
  viewport: { width: number; height: number };
  selectedId: string | null;
  onLocate: (id: string) => void;
  useNineSlice?: boolean;
}

function flatten(node: UINode, out: UINode[] = []): UINode[] {
  out.push(node);
  for (const child of node.children ?? []) flatten(child, out);
  return out;
}

export default function SceneOverview(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeMap = new Map(flatten({
    id: "__root__", name: "", image: null, children: p.nodes,
    designRect: { x: 0, y: 0, width: 0, height: 0 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: -Infinity,
    adaptation: { mode: "anchor" }, psd: { layerId: -1, originalX: 0, originalY: 0, originalWidth: 0, originalHeight: 0 },
  }).filter((node) => node.id !== "__root__").map((node) => [node.id, node]));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !p.result) return;
    canvas.width = Math.max(1, Math.round(p.viewport.width));
    canvas.height = Math.max(1, Math.round(p.viewport.height));
    const context = canvas.getContext("2d");
    if (!context) return;
    renderUi(context, p.result, p.useNineSlice ?? false);

    const selected = p.selectedId ? p.result.nodes.find((item) => item.node.id === p.selectedId) : null;
    const bounds = selected && effectivePreviewRect(selected, p.viewport);
    if (!bounds) return;
    const line = Math.max(2, Math.min(6, Math.min(canvas.width, canvas.height) / 180));
    context.save();
    context.strokeStyle = "#ff6b6b";
    context.fillStyle = "rgba(255, 86, 86, .12)";
    context.lineWidth = line;
    context.setLineDash([Math.max(4, line * 2), Math.max(3, line)]);
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.strokeRect(bounds.x, bounds.y, Math.max(bounds.width, 12), Math.max(bounds.height, 12));
    context.restore();
  }, [p.result, p.viewport, p.selectedId, p.useNineSlice]);

  const locateFromPoint = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!p.result) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (event.clientX - rect.left) * p.viewport.width / rect.width;
    const y = (event.clientY - rect.top) * p.viewport.height / rect.height;
    const hit = [...p.result.nodes]
      .sort((a, b) => b.node.zIndex - a.node.zIndex)
      .find((item) => item.visible && x >= item.rect.x && x <= item.rect.x + item.rect.width
        && y >= item.rect.y && y <= item.rect.y + item.rect.height);
    if (hit) p.onLocate(hit.node.id);
    else if (p.selectedId && nodeMap.has(p.selectedId)) p.onLocate(p.selectedId);
  };

  return (
    <section className="scene-overview" aria-label="场景总览">
      <div className="scene-overview-head">
        <div>
          <span className="overview-kicker">MAP</span>
          <h3>场景总览</h3>
        </div>
        <span>{p.viewport.width} × {p.viewport.height}</span>
      </div>
      <button className="scene-overview-canvas" onClick={locateFromPoint} title="点击画布或红框定位节点">
        <canvas ref={canvasRef} aria-label="场景缩略图" />
        {!p.result && <span>打开工程后显示</span>}
      </button>
      <p className="scene-overview-hint">红框是当前节点范围 · 点击任意位置定位</p>
    </section>
  );
}
