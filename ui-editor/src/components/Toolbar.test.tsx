import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
});
