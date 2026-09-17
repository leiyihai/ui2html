import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AREA_TOOL_OPTIONS, areaToolIcon, areaToolLabel } from "./WorkspaceAreaToolbar";
import WorkspaceAreaToolbar from "./WorkspaceAreaToolbar";

describe("WorkspaceAreaToolbar", () => {
  it("uses a compact icon-only switcher when closed", () => {
    const html = renderToStaticMarkup(<WorkspaceAreaToolbar tool="layers" onTool={vi.fn()} />);
    expect(html).toContain('class="area-tool-picker-button"');
    expect(html).toContain('aria-label="当前工具：层级面板"');
    expect(html).toContain('class="area-tool-icon"');
    expect(html).not.toContain('role="menu"');
  });

  it("keeps one icon and label for every available area tool", () => {
    expect(AREA_TOOL_OPTIONS).toHaveLength(10);
    expect(new Set(AREA_TOOL_OPTIONS.map((item) => item.icon)).size).toBe(10);
    for (const item of AREA_TOOL_OPTIONS) {
      expect(areaToolIcon(item.value)).toBe(item.icon);
      expect(areaToolLabel(item.value)).toBe(item.label);
    }
  });
});
