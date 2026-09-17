import MenuBar from "./MenuBar";
import type { ScaleMode } from "../types";
import type { DeviceShell } from "../devicePreview";

interface PreviewToolbarConfig {
  viewport: { width: number; height: number };
  onViewport: (value: { width: number; height: number }) => void;
  safeArea: { left: number; right: number; top: number; bottom: number };
  onSafeArea: (value: { left: number; right: number; top: number; bottom: number }) => void;
  scaleMode: ScaleMode;
  onScaleMode: (mode: ScaleMode) => void;
  showSafeArea: boolean;
  designWidth: number;
  designHeight: number;
  deviceShell: DeviceShell;
  onDeviceShell: (shell: DeviceShell) => void;
  showDeviceShell: boolean;
  onToggleDeviceShell: () => void;
}

interface Props {
  projectName: string;
  dirty: boolean;
  hasScene: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onNew: () => void;
  onOpenProject: () => void;
  onImportPsd: (buffer: ArrayBuffer, name: string) => void;
  onImportImages: (files: File[]) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportHtml: () => void;
  onExportEngineJson: () => void;
  onGlobalFont: (font: string) => void;
  nameMode: import("./ControlsPanel").LayerNameMode;
  onNameModeChange: (mode: import("./ControlsPanel").LayerNameMode) => void;
  onAiRename: () => void;
  onTypeConvert: () => void;
  useNineSlicePreview: boolean;
  onToggleNineSlicePreview: () => void;
  workspace: import("./WorkspaceTabs").Workspace;
  workspaces: import("./WorkspaceTabs").WorkspaceOption[];
  onWorkspace: (workspace: import("./WorkspaceTabs").Workspace) => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspace: import("./WorkspaceTabs").Workspace, label: string) => void;
  onCloseProject: () => void;
  onRename: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onMoveLayer: (direction: "up" | "down") => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onShowSettings?: () => void;
  showSafeArea: boolean;
  onToggleSafeArea: () => void;
  showDesignBorder: boolean;
  onToggleDesignBorder: () => void;
  preview: PreviewToolbarConfig;
}

/** 顶部应用外壳；流程内的操作由各区域工具栏承载。 */
export default function Appbar(p: Props) {
  return <header className="app-shell-header">
    <MenuBar
        projectName={p.projectName} dirty={p.dirty}
        hasScene={p.hasScene} canUndo={p.canUndo} canRedo={p.canRedo}
        workspace={p.workspace} workspaces={p.workspaces} onWorkspace={p.onWorkspace}
        onAddWorkspace={p.onAddWorkspace} onRenameWorkspace={p.onRenameWorkspace}
        onNew={p.onNew} onOpenProject={p.onOpenProject}
        onImportPsd={p.onImportPsd} onImportImages={p.onImportImages}
        onSave={p.onSave} onSaveAs={p.onSaveAs} onCloseProject={p.onCloseProject}
        onUndo={p.onUndo} onRedo={p.onRedo} onRename={p.onRename}
        onGroup={p.onGroup} onUngroup={p.onUngroup} onMoveLayer={p.onMoveLayer}
        onShowShortcuts={p.onShowShortcuts} onShowAbout={p.onShowAbout}
        onShowSettings={p.onShowSettings}
        onExportHtml={p.onExportHtml} onExportEngineJson={p.onExportEngineJson}
        showSafeArea={p.showSafeArea} onToggleSafeArea={p.onToggleSafeArea}
        showDesignBorder={p.showDesignBorder} onToggleDesignBorder={p.onToggleDesignBorder}
    />
  </header>;
}
