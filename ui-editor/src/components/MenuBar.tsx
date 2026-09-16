import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Workspace } from "./WorkspaceTabs";

type MenuId = "file" | "edit" | "view" | "help" | null;

interface Props {
  projectName: string;
  dirty: boolean;
  hasScene: boolean;
  canUndo: boolean;
  canRedo: boolean;
  workspace: Workspace;
  onWorkspace: (workspace: Workspace) => void;
  onNew: () => void;
  onOpenProject: () => void;
  onImportPsd: (buffer: ArrayBuffer, name: string) => void;
  onImportImages: (files: File[]) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseProject: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRename: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onMoveLayer: (direction: "up" | "down") => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onExportHtml: () => void;
  onExportEngineJson: () => void;
  showSafeArea: boolean;
  onToggleSafeArea: () => void;
  showDesignBorder: boolean;
  onToggleDesignBorder: () => void;
}

const WORKSPACES: Array<{ value: Workspace; label: string }> = [
  { value: "controls", label: "层级" },
  { value: "bindings", label: "资源绑定" },
  { value: "slice", label: "九宫格" },
  { value: "preview", label: "预览" },
  { value: "export", label: "导出" },
];

export const VIEW_AUXILIARY_ITEMS = ["设计画布边界", "安全区"] as const;

function MenuItem(p: { label: string; shortcut?: string; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return <button className={`menu-item${p.danger ? " danger" : ""}`} disabled={p.disabled} onClick={p.onClick}>
    <span>{p.label}</span>{p.shortcut && <kbd>{p.shortcut}</kbd>}
  </button>;
}

function Divider() { return <div className="menu-divider" role="separator" />; }

function MenuToggle(p: { label: string; checked: boolean; disabled?: boolean; onClick: () => void }) {
  return <button className="menu-item menu-toggle" role="menuitemcheckbox" aria-checked={p.checked}
    disabled={p.disabled} onClick={p.onClick}>
    <span className="menu-toggle-check" aria-hidden="true">{p.checked ? "✓" : ""}</span>
    <span>{p.label}</span>
  </button>;
}

/** 桌面软件风格的菜单栏；菜单动作与现有快捷键/工具栏共用回调。 */
export default function MenuBar(p: Props) {
  const [open, setOpen] = useState<MenuId>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const toggle = (id: Exclude<MenuId, null>) => setOpen((current) => current === id ? null : id);
  const closeThen = (action: () => void) => { setOpen(null); action(); };
  const handlePsd = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setOpen(null);
    p.onImportPsd(await file.arrayBuffer(), file.name);
  };
  const handleImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...event.currentTarget.files ?? []];
    event.currentTarget.value = "";
    if (!files.length) return;
    setOpen(null);
    p.onImportImages(files);
  };

  return <div className="top-chrome" ref={rootRef}>
    <div className="window-titlebar">
      <div className="window-titlebar-project" title={p.projectName}>
        <div className="window-titlebar-mark" aria-hidden="true">U</div>
        <span className={`window-titlebar-state ${p.hasScene ? (p.dirty ? "dirty" : "ready") : "empty"}`} aria-hidden="true" />
        <span className="window-titlebar-name">{p.projectName}</span>
        <span className="window-titlebar-status">{p.hasScene ? (p.dirty ? "有未保存更改" : "已保存") : "未打开工程"}</span>
      </div>
      <div className="window-titlebar-drag" aria-hidden="true" />
    </div>
    <nav className="menu-bar" aria-label="应用菜单">
      <div className="menu-drag-region" aria-hidden="true" />
      <div className="menu-brand" aria-label="UI2HTML">
        <div className="menu-brand-mark" aria-hidden="true">U</div>
        <span className="menu-brand-separator" />
      </div>
      <div className="menu-groups">
      <div className="menu-group">
        <button className={`menu-trigger ${open === "file" ? "on" : ""}`} onClick={() => toggle("file")}>文件</button>
        {open === "file" && <div className="menu-popover menu-file" role="menu">
          <MenuItem label="新建工程" shortcut="Ctrl+N" onClick={() => closeThen(p.onNew)} />
          <MenuItem label="打开工程…" shortcut="Ctrl+O" onClick={() => closeThen(p.onOpenProject)} />
          <Divider />
          <label className="menu-item" role="menuitem"><span>导入 PSD…</span><kbd>—</kbd><input type="file" accept=".psd,.psb" onChange={handlePsd} /></label>
          <label className="menu-item" role="menuitem"><span>导入图片…</span><kbd>—</kbd><input type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/svg+xml" multiple onChange={handleImages} /></label>
          <Divider />
          <MenuItem label="保存工程" shortcut="Ctrl+S" disabled={!p.hasScene} onClick={() => closeThen(p.onSave)} />
          <MenuItem label="另存为…" shortcut="Ctrl+Shift+S" disabled={!p.hasScene} onClick={() => closeThen(p.onSaveAs)} />
          <MenuItem label="关闭当前工程" shortcut="Ctrl+W" disabled={!p.hasScene} onClick={() => closeThen(p.onCloseProject)} />
          <Divider />
          <MenuItem label="导出 HTML" disabled={!p.hasScene} onClick={() => closeThen(p.onExportHtml)} />
          <MenuItem label="导出自研引擎 JSON" disabled={!p.hasScene} onClick={() => closeThen(p.onExportEngineJson)} />
        </div>}
      </div>
      <div className="menu-group">
        <button className={`menu-trigger ${open === "edit" ? "on" : ""}`} onClick={() => toggle("edit")}>编辑</button>
        {open === "edit" && <div className="menu-popover" role="menu">
          <MenuItem label="撤销" shortcut="Ctrl+Z" disabled={!p.canUndo} onClick={() => closeThen(p.onUndo)} />
          <MenuItem label="重做" shortcut="Ctrl+X" disabled={!p.canRedo} onClick={() => closeThen(p.onRedo)} />
          <Divider />
          <MenuItem label="重命名" shortcut="F2" disabled={!p.hasScene} onClick={() => closeThen(p.onRename)} />
          <MenuItem label="打组" shortcut="Ctrl+G" disabled={!p.hasScene} onClick={() => closeThen(p.onGroup)} />
          <MenuItem label="取消打组" shortcut="Alt+G" disabled={!p.hasScene} onClick={() => closeThen(p.onUngroup)} />
          <Divider />
          <MenuItem label="上移层级" shortcut="Ctrl+[" disabled={!p.hasScene} onClick={() => closeThen(() => p.onMoveLayer("up"))} />
          <MenuItem label="下移层级" shortcut="Ctrl+]" disabled={!p.hasScene} onClick={() => closeThen(() => p.onMoveLayer("down"))} />
        </div>}
      </div>
      <div className="menu-group">
        <button className={`menu-trigger ${open === "view" ? "on" : ""}`} onClick={() => toggle("view")}>视图</button>
        {open === "view" && <div className="menu-popover" role="menu">
          <div className="menu-section-label">工作区</div>
          {WORKSPACES.map((item) => <MenuItem key={item.value} label={item.label} disabled={item.value !== "controls" && !p.hasScene}
            onClick={() => closeThen(() => p.onWorkspace(item.value))} />)}
          <Divider />
          <div className="menu-section-label">辅助显示</div>
          <MenuToggle label={VIEW_AUXILIARY_ITEMS[0]} checked={p.showDesignBorder} disabled={!p.hasScene}
            onClick={() => closeThen(p.onToggleDesignBorder)} />
          <MenuToggle label={VIEW_AUXILIARY_ITEMS[1]} checked={p.showSafeArea} disabled={!p.hasScene}
            onClick={() => closeThen(p.onToggleSafeArea)} />
        </div>}
      </div>
      <div className="menu-group">
        <button className={`menu-trigger ${open === "help" ? "on" : ""}`} onClick={() => toggle("help")}>帮助</button>
        {open === "help" && <div className="menu-popover" role="menu">
          <MenuItem label="快捷键说明" onClick={() => closeThen(p.onShowShortcuts)} />
          <Divider />
          <MenuItem label="关于 UI2HTML" onClick={() => closeThen(p.onShowAbout)} />
        </div>}
      </div>
      </div>
      <div className="menu-workspaces-inline" aria-label="工作区">
        {WORKSPACES.map((item) => <button key={item.value}
          className={`menu-workspace ${p.workspace === item.value ? "on" : ""}`}
          disabled={item.value !== "controls" && !p.hasScene}
          onClick={() => p.onWorkspace(item.value)}
          title={item.value === "controls" ? "工程层级与编辑" : item.label}>
          <span>{item.label}</span>
        </button>)}
      </div>
    </nav>
  </div>;
}
