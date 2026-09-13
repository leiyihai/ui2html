import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UINode } from "../types";
import TypeListMenu, { ListArrangementMenu } from "./TypePieMenu";

const node: UINode = {
  id: "layout-1", name: "布局", image: null, children: [],
  designRect: { x: 0, y: 0, width: 100, height: 100 },
  anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
  scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
  adaptation: { mode: "anchor" }, psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 100, originalHeight: 100 },
  ctrl: { type: "Layout" },
};

describe("TypeListMenu", () => {
  it("renders the four groups in a fixed separated list", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    const html = renderToStaticMarkup(<TypeListMenu x={640} y={360} node={node} onChoose={vi.fn()} onClose={vi.fn()} />);
    expect((html.match(/class="type-list-group"/g) ?? []).length).toBe(4);
    expect(html).toContain("type-list-menu");
    expect(html).not.toContain("type-pie");
    expect(html.indexOf("进度 / 滚动")).toBeLessThan(html.indexOf("容器 / 布局"));
    expect(html.indexOf("容器 / 布局")).toBeLessThan(html.indexOf("交互控件"));
    expect(html.indexOf("交互控件")).toBeLessThan(html.indexOf("内容展示"));
  });

  it("marks the current type and keeps list family as a second choice", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    const html = renderToStaticMarkup(<TypeListMenu x={640} y={360} node={node} onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(html).toContain("当前");
    expect(html).toContain("列表容器");
    expect(html).not.toContain("横向列表");
    expect(html).not.toContain("网格列表");
  });

  it("offers all three final engine types in the list arrangement menu", () => {
    const html = renderToStaticMarkup(<ListArrangementMenu currentType="ListHorizontal" onChoose={vi.fn()} onBack={vi.fn()} />);
    expect(html).toContain("纵向列表");
    expect(html).toContain("横向列表");
    expect(html).toContain("网格列表");
    expect((html.match(/type-list-option active/g) ?? []).length).toBe(1);
  });
});
