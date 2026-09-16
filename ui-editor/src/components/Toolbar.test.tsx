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
  onWorkspace: vi.fn(), onCloseProject: vi.fn(), onRename: vi.fn(), onGroup: vi.fn(), onUngroup: vi.fn(),
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
  it("keeps the font picker next to type conversion and omits redundant top-level actions", () => {
    const html = renderToStaticMarkup(<Appbar {...props} />);
    expect(html).toContain("类型转换");
    expect(html).toContain('aria-label="项目字体"');
    expect(html.indexOf("类型转换")).toBeLessThan(html.indexOf('aria-label="项目字体"'));
    expect(html).not.toContain("预览 HTML");
    expect(html).not.toContain("导出 JSON");
    expect(html).not.toContain("↩ 撤销");
    expect(html).not.toContain("↪ 重做");
  });

  it("shows preview controls directly in the current workflow toolbar", () => {
    const html = renderToStaticMarkup(<Appbar {...props} workspace="preview" />);
    expect(html).toContain("preview-appbar");
    expect(html).toContain('aria-label="设备预设"');
    expect(html).toContain('aria-label="循环切换设备预设"');
    expect(html).toContain('aria-label="显示设备壳"');
    expect(html).toContain('aria-label="九宫格预览"');
    expect(html).toContain('aria-label="预览缩放方式"');
    expect(html).toContain('aria-label="循环切换缩放方式"');
    expect(html).toContain('<optgroup label="手机">');
    expect(html).toContain('<optgroup label="桌面">');
    expect(html).not.toContain("<details");
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
