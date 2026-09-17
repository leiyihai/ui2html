interface Props {
  uiScale: number;
  onUiScale: (value: number) => void;
  onReset: () => void;
  reduceMotion: boolean;
  onReduceMotion: (value: boolean) => void;
  showShortcutHints: boolean;
  onShowShortcutHints: (value: boolean) => void;
  onClose: () => void;
}

/** 全局应用设置；只保存编辑器显示偏好，不写入 UI 工程。 */
export default function SettingsDialog({ uiScale, onUiScale, onReset, reduceMotion, onReduceMotion, showShortcutHints, onShowShortcutHints, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <header className="settings-dialog-head">
          <div>
            <span className="workspace-kicker">APPLICATION</span>
            <h2 id="settings-dialog-title">界面设置</h2>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭界面设置">×</button>
        </header>
        <div className="settings-dialog-body">
          <section className="settings-section">
            <div className="settings-section-copy">
              <strong>界面缩放</strong>
              <span>调整 UI2HTML 整体界面的显示比例。</span>
              <small>默认 120%，可调整范围为 100%–130%；只影响编辑器界面，不改变画布数据、工程尺寸或导出结果。</small>
            </div>
            <div className="settings-scale-control">
              <input type="range" min="100" max="130" step="5" value={Math.round(uiScale * 100)}
                aria-label="界面缩放比例" onChange={(event) => onUiScale(Number(event.target.value) / 100)} />
              <output>{Math.round(uiScale * 100)}%</output>
              <div className="settings-scale-actions">
                <button className="btn" type="button" disabled={uiScale <= 1} onClick={() => onUiScale(Math.max(1, uiScale - 0.05))}>缩小</button>
                <button className="btn" type="button" disabled={uiScale === 1.2} onClick={onReset}>恢复默认</button>
                <button className="btn" type="button" disabled={uiScale >= 1.3} onClick={() => onUiScale(Math.min(1.3, uiScale + 0.05))}>放大</button>
              </div>
            </div>
          </section>
          <section className="settings-section settings-options">
            <label className="settings-option">
              <input type="checkbox" checked={reduceMotion} onChange={(event) => onReduceMotion(event.target.checked)} />
              <span>
                <strong>减少界面动效</strong>
                <small>关闭过渡和旋转等非必要动效。</small>
              </span>
            </label>
            <label className="settings-option">
              <input type="checkbox" checked={showShortcutHints} onChange={(event) => onShowShortcutHints(event.target.checked)} />
              <span>
                <strong>显示底部快捷键提示</strong>
                <small>在状态栏保留当前工作区的快捷操作提示。</small>
              </span>
            </label>
          </section>
          <div className="settings-dialog-note">当前设置保存在本机，下次启动编辑器时继续使用。</div>
        </div>
        <footer className="settings-dialog-foot">
          <button className="btn primary" type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  );
}
