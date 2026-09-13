import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "./WorkspaceTabs";
import MenuBar from "./MenuBar";

const props = {
  projectName: "示例.ui.json", dirty: false,
  hasScene: true, canUndo: true, canRedo: false, workspace: "controls" as Workspace,
  onWorkspace: vi.fn(), onNew: vi.fn(), onOpenProject: vi.fn(), onImportPsd: vi.fn(), onImportImages: vi.fn(),
  onSave: vi.fn(), onSaveAs: vi.fn(), onCloseProject: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
  onRename: vi.fn(), onGroup: vi.fn(), onUngroup: vi.fn(), onMoveLayer: vi.fn(),
  onShowShortcuts: vi.fn(), onShowAbout: vi.fn(), onExportHtml: vi.fn(), onExportEngineJson: vi.fn(),
};

describe("MenuBar", () => {
  it("renders the standard desktop menu groups", () => {
    const html = renderToStaticMarkup(<MenuBar {...props} />);
    expect(html).toContain("文件");
    expect(html).toContain("编辑");
    expect(html).toContain("视图");
    expect(html).toContain("帮助");
    expect(html).toContain("UI2HTML");
    expect(html).toContain("示例.ui.json");
    expect(html).toContain("资源绑定");
  });
});
