import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { renderUi } from "../renderer";
import { collectResourceBindingTargets, effectivePreviewRect, imageDataUrl, isBindingComplete, orderResourceBindingTargets, type ResourceBindingTarget } from "../resourceBindingWorkspace";
import type { LayoutResult, ResourceSlot, UINode } from "../types";
import { TypeIcon } from "./ControlsPanel";
import { Icon } from "./Icon";

interface Props {
  nodes: import("../types").UINode[];
  layout: LayoutResult | null;
  viewport: { width: number; height: number };
  selectedIds: string[];
  onSelectImage: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  onLocate: (id: string) => void;
  onBind: (targetId: string, imageIds: string[], slot?: ResourceSlot) => void;
  onUnbind: (targetId: string, slot: ResourceSlot) => void;
  onResetComplete: (targetId: string) => void;
}

function BindingCard(p: {
  target: ResourceBindingTarget;
  selectedIds: string[];
  onSelectImage: Props["onSelectImage"];
  onLocate: Props["onLocate"];
  onBind: Props["onBind"];
  onUnbind: Props["onUnbind"];
  onResetComplete: Props["onResetComplete"];
  layout: Props["layout"];
  viewport: Props["viewport"];
}) {
  const { target } = p;
  const [expanded, setExpanded] = useState(true);
  const selectedImages = target.images.filter((image) => p.selectedIds.includes(image.id));
  const type = target.node.ctrl?.type;
  const boundCount = target.slots.filter((slot) => target.node.resources?.[slot.key]).length;
  const complete = isBindingComplete(target);
  const selected = p.selectedIds.includes(target.node.id) || selectedImages.length > 0;
  const locateFromCard = (event: MouseEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    if (element.closest("button, input, select, textarea, a")) return;
    p.onLocate(target.node.id);
  };

  return (
    <article className={`binding-card ${complete ? "complete" : "pending"}${selected ? " selected" : ""}`} onClick={locateFromCard}>
      <header className="binding-card-head">
        <div className="binding-card-title" title={target.path.join(" / ")}>
          <TypeIcon type={type} />
          {complete && target.node.resourceBindingComplete ? (
            <button type="button" className="binding-status done status-action" aria-label="已完成，点击恢复为待处理状态"
              onClick={(event) => { event.stopPropagation(); p.onResetComplete(target.node.id); }} title="已完成 · 点击恢复为待处理状态">
              <i aria-hidden="true"><Icon name="refresh" size={14} /></i>
            </button>
          ) : <span className={`binding-status ${complete ? "done" : "todo"}`} aria-label={complete ? "已完成" : "待绑定"} title={complete ? "已完成" : "待绑定"}>
            <i aria-hidden="true"><Icon name={complete ? "check" : "circle"} size={14} /></i>
          </span>}
          <div className="binding-card-heading">
            <h3>{target.node.name}</h3>
          </div>
        </div>
        <div className="binding-card-actions">
          <button type="button" className="binding-card-expand" aria-expanded={expanded}
            aria-label={expanded ? "收起绑定详情" : "展开绑定详情"}
            title={expanded ? "收起绑定详情" : "展开绑定详情"}
            onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}>
            <i className={`binding-card-expand-icon${expanded ? " expanded" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      <NodeEffectPreview target={target} layout={p.layout} viewport={p.viewport} onLocate={p.onLocate} />

      {expanded && (
        <div className="binding-card-details">
          <section className="binding-detail-section">
            <div className="binding-detail-head">
              <span>图片</span>
              <small>{selectedImages.length ? `已选 ${selectedImages.length}` : `${target.images.length} 张`}</small>
              <button className="binding-batch-action" disabled={!selectedImages.length}
                onClick={() => p.onBind(target.node.id, selectedImages.map((image) => image.id))}>
                批量绑定
              </button>
            </div>
            {target.images.length ? (
              <div className="binding-image-grid">
                {target.images.map((image) => (
                  <button key={image.id} className={`binding-image-tile${p.selectedIds.includes(image.id) ? " selected" : ""}`}
                    aria-pressed={p.selectedIds.includes(image.id)} title={`${image.name} · 点击选择`}
                    onClick={(event) => p.onSelectImage(image.id, event)}>
                    <img src={imageDataUrl(image)} alt="" />
                    <span>{image.name}</span>
                    {p.selectedIds.includes(image.id) && <i><Icon name="check" size={14} /></i>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="binding-empty-images">无可绑定图片</div>
            )}
          </section>

          <section className="binding-detail-section binding-slots-section">
            <div className="binding-detail-head">
              <span>槽位</span>
              <small>{boundCount}/{target.slots.length}</small>
            </div>
            <div className="binding-slot-list">
              {target.slots.map((slot) => {
                const binding = target.node.resources?.[slot.key];
                return (
                  <div className={`binding-slot${binding ? " filled" : ""}`} key={slot.key}>
                    <div className="binding-slot-name">
                      <strong>{slot.label}</strong>
                      <small>{slot.key}</small>
                    </div>
                    {binding ? (
                      <div className="binding-slot-value">
                        <img src={imageDataUrl(binding.sourceNode)} alt="" />
                        <span title={binding.name}>{binding.name}</span>
                        <button className="binding-unbind" onClick={() => p.onUnbind(target.node.id, slot.key)} title="解除绑定">解除</button>
                      </div>
                    ) : (
                      <button className="binding-slot-action" disabled={!selectedImages.length}
                        onClick={() => p.onBind(target.node.id, [selectedImages[0].id], slot.key)}>
                        绑定
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </article>
  );
}

function descendantIds(node: UINode, out = new Set<string>()): Set<string> {
  out.add(node.id);
  for (const child of node.children ?? []) descendantIds(child, out);
  return out;
}

function NodeEffectPreview(p: {
  target: ResourceBindingTarget;
  layout: LayoutResult | null;
  viewport: { width: number; height: number };
  onLocate: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const item = p.layout?.nodes.find((entry) => entry.node.id === p.target.node.id);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bounds = item && effectivePreviewRect(item, p.viewport);
    if (!canvas || !p.layout || !bounds) return;
    const width = 520;
    const height = 160;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#111a22";
    context.fillRect(0, 0, width, height);
    const source = document.createElement("canvas");
    source.width = Math.max(1, Math.round(p.viewport.width));
    source.height = Math.max(1, Math.round(p.viewport.height));
    renderUi(source.getContext("2d")!, {
      ...p.layout,
      nodes: p.layout.nodes.filter((entry) => descendantIds(p.target.node).has(entry.node.id)),
    });
    const scale = Math.min((width - 24) / bounds.width, (height - 24) / bounds.height);
    const drawWidth = bounds.width * scale;
    const drawHeight = bounds.height * scale;
    context.imageSmoothingEnabled = true;
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height,
      (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    context.strokeStyle = "rgba(137, 208, 236, .4)";
    context.strokeRect((width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }, [item, p.layout, p.viewport, p.target.node]);

  return (
    <button type="button" className="binding-node-preview" onClick={() => p.onLocate(p.target.node.id)}
      title="点击预览区域定位层级并在总览中标记">
      <canvas ref={canvasRef} />
    </button>
  );
}

export default function ResourceBindingWorkspace(p: Props) {
  const targets = orderResourceBindingTargets(collectResourceBindingTargets(p.nodes));
  const completedCount = targets.filter(isBindingComplete).length;
  const completion = targets.length ? Math.round((completedCount / targets.length) * 100) : 0;
  return (
    <section className="resource-binding-workspace" aria-label="资源绑定">
      <div className="binding-workspace-head">
        <div>
          <span className="binding-kicker">资源关系</span>
          <h2>资源绑定</h2>
          <p>按控件查看图片并手动绑定。Ctrl+B：选图片=绑定资源，只选控件=确认完成。</p>
        </div>
        <div className="binding-workspace-stat">
          <strong>{completedCount}<em>/{targets.length}</em></strong>
          <span>控件已完成</span>
        </div>
      </div>
      <div className="binding-workspace-progress" role="progressbar" aria-label="资源绑定完成进度"
        aria-valuemin={0} aria-valuemax={targets.length} aria-valuenow={completedCount}>
        <i style={{ width: `${completion}%` }} />
      </div>
      {targets.length ? (
        <div className="binding-card-list">
          {targets.map((target) => <BindingCard key={target.node.id} target={target} selectedIds={p.selectedIds}
            onSelectImage={p.onSelectImage} onLocate={p.onLocate} onBind={p.onBind} onUnbind={p.onUnbind}
            onResetComplete={p.onResetComplete} layout={p.layout} viewport={p.viewport} />)}
        </div>
      ) : (
        <div className="binding-workspace-empty">
          <span className="binding-empty-mark"><Icon name="binding" size={28} /></span>
          <strong>还没有可绑定的控件</strong>
          <p>先导入 PSD 或打开工程，再将节点转换为按钮、进度条等控件类型。</p>
        </div>
      )}
    </section>
  );
}
