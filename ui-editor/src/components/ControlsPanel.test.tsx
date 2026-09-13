import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UINode } from "../types";
import ControlsPanel, { shouldAutoExpandForFocus } from "./ControlsPanel";

const bag: UINode = {
  id: "bag",
  name: "bag",
  originalName: "背包",
  image: null,
  children: [],
  ctrl: { type: "Layout" },
  designRect: { x: 0, y: 0, width: 296, height: 404 },
  anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  visible: true,
  zIndex: 0,
  adaptation: { mode: "anchor" },
  psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 296, originalHeight: 404 },
};

describe("ControlsPanel inline rename", () => {
  it("does not reopen a collapsed branch when only node visibility changed", () => {
    const child = { ...bag, id: "bag-child", name: "bag child" };
    const parent = { ...bag, children: [child] };

    expect(shouldAutoExpandForFocus(parent, "bag-child", "bag-child")).toBe(false);
    expect(shouldAutoExpandForFocus(parent, "bag-child", null)).toBe(true);
  });

  it("replaces the selected node name with an inline input", () => {
    const html = renderToStaticMarkup(
      <ControlsPanel
        nodes={[bag]}
        selectedIds={[bag.id]}
        nameMode="ai"
        onNameModeChange={vi.fn()}
        onAiRename={vi.fn()}
        renamingId={bag.id}
        renameCaretMode="all"
        onSelect={vi.fn()}
        onToggleVisible={vi.fn()}
        onToggleLock={vi.fn()}
        onRename={vi.fn()}
        onCancelRename={vi.fn()}
      />,
    );

    expect(html).toContain('class="inline-rename"');
    expect(html).toContain('value="bag"');
    expect(html).toContain("Alt+W 关闭");
  });

  it("switches names without exposing a second PSD hierarchy style", () => {
    const original = renderToStaticMarkup(
      <ControlsPanel
        nodes={[bag]}
        selectedIds={[]}
        nameMode="original"
        onNameModeChange={vi.fn()}
        onAiRename={vi.fn()}
        renamingId={null}
        renameCaretMode="all"
        onSelect={vi.fn()}
        onToggleVisible={vi.fn()}
        onToggleLock={vi.fn()}
        onRename={vi.fn()}
        onCancelRename={vi.fn()}
      />,
    );
    const ai = renderToStaticMarkup(
      <ControlsPanel
        nodes={[bag]}
        selectedIds={[]}
        nameMode="ai"
        onNameModeChange={vi.fn()}
        onAiRename={vi.fn()}
        renamingId={null}
        renameCaretMode="all"
        onSelect={vi.fn()}
        onToggleVisible={vi.fn()}
        onToggleLock={vi.fn()}
        onRename={vi.fn()}
        onCancelRename={vi.fn()}
      />,
    );

    expect(original).toContain(">背包</span>");
    expect(original).not.toContain(">bag</span>");
    expect(ai).toContain(">bag</span>");
    expect(original).toContain("工程名称");
    expect(original).toContain("AI 命名");
    expect(original).not.toContain("PSD 整理");
    expect(original).not.toContain("工程层级");
  });
});
