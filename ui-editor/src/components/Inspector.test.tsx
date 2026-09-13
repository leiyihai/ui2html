import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UINode } from "../types";
import Inspector, { arrowStepDirection, horizontalPointerDelta } from "./Inspector";

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
  it("keeps mouse adjustment horizontal and maps arrow keys to step directions", () => {
    expect(horizontalPointerDelta(140, 100)).toBe(40);
    expect(horizontalPointerDelta(60, 100)).toBe(-40);
    expect(arrowStepDirection("ArrowUp")).toBe(1);
    expect(arrowStepDirection("ArrowRight")).toBe(1);
    expect(arrowStepDirection("ArrowDown")).toBe(-1);
    expect(arrowStepDirection("ArrowLeft")).toBe(-1);
    expect(arrowStepDirection("Enter")).toBe(0);
  });

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
    expect(html).toContain('class="node-name-field"');
    expect(html).toContain('class="drag-number"');
    expect(html).toContain('title="按住左右拖动调整数值"');
    expect(html).toContain('class="value-drag-zone"');
    expect(html).toContain("聚焦后使用方向键调整");
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

describe("selectable control inspector", () => {
  it("shows the initial selected state for CheckBox and RadioButton", () => {
    const radio = { ...editNode(), id: "radio", name: "radio_tab", ctrl: { type: "RadioButton" as const, selected: true } };
    const html = renderToStaticMarkup(<Inspector
      node={radio}
      rect={null}
      onUpdate={() => {}}
      onSetCtrl={() => {}}
      onUnbindResource={() => {}}
      onReanchor={() => {}}
      templates={[]}
      onTemplates={() => {}}
    />);

    expect(html).toContain("初始选中");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});

describe("layout alignment inspector", () => {
  it("uses Chinese tabs and shows only the parent alignment grid by default", () => {
    const html = renderToStaticMarkup(<Inspector
      node={editNode()}
      rect={null}
      onUpdate={() => {}}
      onSetCtrl={() => {}}
      onUnbindResource={() => {}}
      onReanchor={() => {}}
      templates={[]}
      onTemplates={() => {}}
    />);

    expect(html).toContain("父级对齐");
    expect(html).toContain("自身锚点");
    expect(html).toContain("对齐位置");
    expect(html).toContain("位置与尺寸");
    expect(html).not.toContain("位置与尺寸校正");
    expect(html).toContain('class="inspector-help"');
    expect(html).toContain("父级对齐对应引擎");
    expect(html).toContain('class="layout-mode-button"');
    expect(html).toContain('title="点击切换相对/绝对值"');
    expect(html).toContain("⇄");
    expect(html).not.toContain("Parent Anchor");
    expect(html).not.toContain("Self Anchor");
  });
});
