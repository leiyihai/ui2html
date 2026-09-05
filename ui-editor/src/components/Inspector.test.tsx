import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UINode } from "../types";
import Inspector from "./Inspector";

function editNode(): UINode {
  return {
    id: "edit",
    name: "名称输入框",
    image: null,
    ctrl: { type: "Edit" },
    designRect: { x: 0, y: 0, width: 180, height: 32 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex: 1,
    adaptation: { mode: "anchor" },
    psd: { layerId: -1, originalX: 0, originalY: 0, originalWidth: 180, originalHeight: 32 },
  };
}

describe("Edit inspector", () => {
  it("shows an editable text property for legacy Edit nodes without text data", () => {
    const html = renderToStaticMarkup(<Inspector
      node={editNode()}
      rect={null}
      viewport={{ width: 1280, height: 720 }}
      onUpdate={() => {}}
      onSetCtrl={() => {}}
      onUnbindResource={() => {}}
      onReanchor={() => {}}
      templates={[]}
      onTemplates={() => {}}
    />);

    expect(html).toContain("输入框文本");
    expect(html).toContain("输入框中显示的文字");
  });

  it("shows bounded progress controls for Slider and ProgressBar", () => {
    const slider = { ...editNode(), id: "slider", name: "slider_volume", ctrl: { type: "Slider" as const },
      designRect: { x: 0, y: 0, width: 200, height: 32 }, progress: { value: 0.25, direction: "horizontal" as const, reverse: false } };
    const html = renderToStaticMarkup(<Inspector
      node={slider}
      rect={null}
      viewport={{ width: 1280, height: 720 }}
      onUpdate={() => {}}
      onSetCtrl={() => {}}
      onUnbindResource={() => {}}
      onReanchor={() => {}}
      templates={[]}
      onTemplates={() => {}}
    />);

    expect(html).toContain("进度控件");
    expect(html).toContain("进度值");
    expect(html).toContain('min="0"');
    expect(html).toContain('max="1"');
    expect(html).toContain('step="0.01"');
    expect(html).toContain("反向");
  });
});
