import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasZoomControl, PreviewToolActions } from "./AreaToolActions";

describe("area tool actions", () => {
  it("renders canvas zoom controls inside an area toolbar", () => {
    const html = renderToStaticMarkup(<CanvasZoomControl zoom={1.2} onAdjust={vi.fn()} />);
    expect(html).toContain('aria-label="画布缩放"');
    expect(html).toContain("120%");
  });

  it("keeps preview controls available for the preview area", () => {
    const html = renderToStaticMarkup(<PreviewToolActions
      hasScene viewport={{ width: 1280, height: 720 }} onViewport={vi.fn()}
      safeArea={{ left: 0, right: 0, top: 0, bottom: 0 }} onSafeArea={vi.fn()}
      scaleMode="cover" onScaleMode={vi.fn()} showSafeArea={false}
      designWidth={1280} designHeight={720} deviceShell="desktop" onDeviceShell={vi.fn()}
      showDeviceShell={true} onToggleDeviceShell={vi.fn()}
      useNineSlicePreview={false} onToggleNineSlicePreview={vi.fn()}
      previewLayoutMode="pure" onTogglePreviewLayout={vi.fn()} />);
    expect(html).toContain('aria-label="设备预设"');
    expect(html).toContain('aria-label="循环切换设备预设"');
    expect(html).toContain('aria-label="显示设备壳"');
    expect(html).toContain('aria-label="九宫格预览"');
    expect(html).toContain('aria-label="切换编辑检查布局"');
  });
});
