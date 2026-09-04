import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UINode } from "../types";
import TypePieMenu from "./TypePieMenu";

const node: UINode = {
  id: "layout-1",
  name: "布局",
  image: null,
  children: [],
  designRect: { x: 0, y: 0, width: 100, height: 100 },
  anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  visible: true,
  zIndex: 0,
  adaptation: { mode: "anchor" },
  psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 100, originalHeight: 100 },
  ctrl: { type: "Layout" },
};

describe("TypePieMenu", () => {
  it("renders four directional groups in the confirmed order", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    const html = renderToStaticMarkup(<TypePieMenu
      x={640}
      y={360}
      node={node}
      onChoose={vi.fn()}
      onClose={vi.fn()}
    />);

    expect((html.match(/type-pie-group type-pie-group-/g) ?? []).length).toBe(4);
    expect(html.indexOf("进度 / 滚动")).toBeLessThan(html.indexOf("容器 / 布局"));
    expect(html.indexOf("容器 / 布局")).toBeLessThan(html.indexOf("交互控件"));
    expect(html.indexOf("交互控件")).toBeLessThan(html.indexOf("内容展示"));
    expect(html.indexOf("布局")).toBeLessThan(html.indexOf("空节点"));
    expect(html.indexOf("空节点")).toBeLessThan(html.indexOf("列表"));
    expect(html.indexOf("按钮")).toBeLessThan(html.indexOf("复选框"));
    expect(html.indexOf("复选框")).toBeLessThan(html.indexOf("单选框"));
  });

  it("keeps the current type in the center", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    const html = renderToStaticMarkup(<TypePieMenu
      x={640}
      y={360}
      node={node}
      onChoose={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(html).toContain("控件类型");
    expect(html).toContain("移动鼠标选择");
    expect((html.match(/type-pie-item active/g) ?? []).length).toBe(1);
  });
});
