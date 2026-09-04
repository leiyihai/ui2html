import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import QuickActionMenu from "./QuickActionMenu";

describe("QuickActionMenu", () => {
  it("shows import actions on the left and save actions on the right", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    const html = renderToStaticMarkup(<QuickActionMenu
      x={640}
      y={360}
      hasScene={true}
      onNew={vi.fn()}
      onOpenProject={vi.fn()}
      onImportPsd={vi.fn()}
      onImportImages={vi.fn()}
      onSave={vi.fn()}
      onSaveAs={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(html).toContain("工程与导入");
    expect(html).toContain("新建");
    expect(html).toContain("打开工程");
    expect(html).toContain("导入 PSD");
    expect(html).toContain("导入图片");
    expect(html).toContain("保存工程");
    expect(html).toContain("保存");
    expect(html).toContain("另存为");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("keeps save actions visible but disabled without a scene", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    const html = renderToStaticMarkup(<QuickActionMenu
      x={640}
      y={360}
      hasScene={false}
      onNew={vi.fn()}
      onOpenProject={vi.fn()}
      onImportPsd={vi.fn()}
      onImportImages={vi.fn()}
      onSave={vi.fn()}
      onSaveAs={vi.fn()}
      onClose={vi.fn()}
    />);

    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });
});
