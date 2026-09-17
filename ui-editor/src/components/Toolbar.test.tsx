import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { nextPreviewPreset, nextPreviewScaleMode, presetsForDesign } from "../devicePreview";
import Appbar from "./Toolbar";

const props = {
  projectName: "示例.ui.json", dirty: false, hasScene: true, canUndo: true, canRedo: true,
  onNew: vi.fn(), onOpenProject: vi.fn(), onImportPsd: vi.fn(), onImportImages: vi.fn(),
  onSave: vi.fn(), onSaveAs: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
  onExportHtml: vi.fn(), onExportEngineJson: vi.fn(), onGlobalFont: vi.fn(),
  nameMode: "original" as const, onNameModeChange: vi.fn(), onAiRename: vi.fn(), onTypeConvert: vi.fn(),
  useNineSlicePreview: false, onToggleNineSlicePreview: vi.fn(), workspace: "controls" as const,
  workspaces: [{ value: "controls", label: "层级", builtIn: true }], onWorkspace: vi.fn(), onAddWorkspace: vi.fn(), onRenameWorkspace: vi.fn(), onCloseProject: vi.fn(), onRename: vi.fn(), onGroup: vi.fn(), onUngroup: vi.fn(),
  onMoveLayer: vi.fn(), onShowShortcuts: vi.fn(), onShowAbout: vi.fn(),
  showSafeArea: false, onToggleSafeArea: vi.fn(), showDesignBorder: false, onToggleDesignBorder: vi.fn(),
  preview: {
    viewport: { width: 1280, height: 720 }, onViewport: vi.fn(),
    safeArea: { left: 0, right: 0, top: 0, bottom: 0 }, onSafeArea: vi.fn(),
    scaleMode: "cover" as const, onScaleMode: vi.fn(), showSafeArea: true,
    designWidth: 1280, designHeight: 720, deviceShell: "desktop" as const, onDeviceShell: vi.fn(),
    showDeviceShell: true, onToggleDeviceShell: vi.fn(),
  },
};

describe("Appbar", () => {
  it("keeps the top chrome focused on application menus", () => {
    const html = renderToStaticMarkup(<Appbar {...props} />);
    expect(html).toContain("文件");
    expect(html).toContain("视图");
    expect(html).not.toContain("类型转换");
    expect(html).not.toContain('aria-label="项目字体"');
    expect(html).not.toContain("class=\"appbar");
    expect(html).not.toContain("预览 HTML");
    expect(html).not.toContain("导出 JSON");
    expect(html).not.toContain("↩ 撤销");
    expect(html).not.toContain("↪ 重做");
  });

  it("does not render workflow controls in the top chrome", () => {
    const html = renderToStaticMarkup(<Appbar {...props} workspace="preview" />);
    expect(html).not.toContain('aria-label="设备预设"');
    expect(html).not.toContain('aria-label="九宫格预览"');
  });

  it("cycles preview presets and scale modes in a loop", () => {
    const presets = presetsForDesign(1280, 720);
    expect(nextPreviewPreset(presets, "desktop")?.id).toBe("desktop-16-10");
    expect(nextPreviewPreset(presets, "ultrawide")?.id).toBe("notch");
    expect(nextPreviewPreset(presets, "custom")?.id).toBe("notch");
    expect(nextPreviewScaleMode("cover")).toBe("fill");
    expect(nextPreviewScaleMode("fill")).toBe("contain");
  });
});
