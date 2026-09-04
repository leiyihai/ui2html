import type { ChangeEvent } from "react";

interface Props {
  x: number;
  y: number;
  hasScene: boolean;
  onNew: () => void;
  onOpenProject: () => void;
  onImportPsd: (buffer: ArrayBuffer, name: string) => void;
  onImportImages: (files: File[]) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 720;
const MENU_HEIGHT = 330;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function menuLayout(pointer: { x: number; y: number }) {
  const scale = Math.max(0.42, Math.min(1, (window.innerWidth - 20) / MENU_WIDTH, (window.innerHeight - 20) / MENU_HEIGHT));
  const width = MENU_WIDTH * scale;
  const height = MENU_HEIGHT * scale;
  return {
    left: clamp(pointer.x, width / 2 + 10, window.innerWidth - width / 2 - 10),
    top: clamp(pointer.y, height / 2 + 10, window.innerHeight - height / 2 - 10),
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
}

/** Ctrl+S 快捷操作面板：导入/工程操作在左侧，保存操作在右侧。 */
export default function QuickActionMenu(p: Props) {
  const layout = menuLayout(p);

  const handlePsdChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    p.onClose();
    p.onImportPsd(await file.arrayBuffer(), file.name);
  };

  const handleImagesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...event.target.files ?? []];
    event.currentTarget.value = "";
    if (!files.length) return;
    p.onClose();
    p.onImportImages(files);
  };

  return (
    <div
      className="quick-action-backdrop"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) p.onClose(); }}
    >
      <div
        className="quick-action-menu"
        style={layout}
        role="dialog"
        aria-label="快捷操作"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <section className="quick-action-column quick-action-column-left">
          <div className="quick-action-heading">工程与导入</div>
          <button className="quick-action-item" onClick={() => { p.onClose(); p.onNew(); }}>
            <span className="quick-action-icon">＋</span>
            <span>新建</span>
          </button>
          <button className="quick-action-item" onClick={() => { p.onClose(); p.onOpenProject(); }}>
            <span className="quick-action-icon">↗</span>
            <span>打开工程</span>
          </button>
          <label className="quick-action-item">
            <span className="quick-action-icon">◇</span>
            <span>导入 PSD</span>
            <input type="file" accept=".psd,.psb" onChange={handlePsdChange} />
          </label>
          <label className="quick-action-item">
            <span className="quick-action-icon">▧</span>
            <span>导入图片</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/svg+xml"
              multiple
              onChange={handleImagesChange}
            />
          </label>
        </section>

        <div className="quick-action-center" aria-hidden="true">
          <div className="quick-action-center-disc"><kbd>Ctrl S</kbd></div>
          <span>快捷操作</span>
        </div>

        <section className="quick-action-column quick-action-column-right">
          <div className="quick-action-heading">保存工程</div>
          <button
            className="quick-action-item quick-action-item-primary"
            disabled={!p.hasScene}
            onClick={() => { p.onClose(); p.onSave(); }}
          >
            <span className="quick-action-icon">↓</span>
            <span>保存</span>
          </button>
          <button
            className="quick-action-item"
            disabled={!p.hasScene}
            onClick={() => { p.onClose(); p.onSaveAs(); }}
          >
            <span className="quick-action-icon">⇩</span>
            <span>另存为</span>
          </button>
        </section>
      </div>
    </div>
  );
}
