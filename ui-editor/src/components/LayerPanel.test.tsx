import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UINode } from "../types";
import LayerPanel from "./LayerPanel";

function node(id: string, zIndex: number): UINode {
  return {
    id, name: id, image: null, children: [],
    designRect: { x: 0, y: 0, width: 10, height: 10 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex,
    adaptation: { mode: "anchor" },
    psd: { layerId: zIndex, originalX: 0, originalY: 0, originalWidth: 10, originalHeight: 10 },
  };
}

describe("LayerPanel multi-selection", () => {
  it("renders all selected nodes as selected rows", () => {
    const html = renderToStaticMarkup(<LayerPanel
      nodes={[node("top", 2), node("bottom", 1)]}
      selectedId="bottom"
      selectedIds={["top", "bottom"]}
      onSelect={vi.fn()}
      onToggleVisible={vi.fn()}
      onToggleLock={vi.fn()}
    />);

    expect((html.match(/class="sel"/g) ?? []).length).toBe(2);
  });
});
