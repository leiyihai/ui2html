import { describe, expect, it, vi } from "vitest";
import { readPsd } from "ag-psd";
import { importPsd } from "./psdImport";

vi.mock("ag-psd", () => ({ readPsd: vi.fn() }));

describe("PSD folder import", () => {
  it("prefers a layer's own pixels when vector or smart-object metadata remains", () => {
    const layerCanvas = { width: 40, height: 20 } as HTMLCanvasElement;
    const compositeCanvas = { width: 200, height: 100 } as HTMLCanvasElement;
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      canvas: compositeCanvas,
      children: [{
        id: 1,
        name: "shape",
        left: 10,
        top: 20,
        right: 50,
        bottom: 40,
        canvas: layerCanvas,
        vectorMask: { paths: [] },
        placedLayer: { type: "raster" },
      }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));

    expect(scene.nodes[0].image).toBe(layerCanvas);
    expect(warnings).toContain("图层「shape」已按自身像素结果导入，忽略残留的矢量/智能对象元数据");
  });

  it("rasterizes enabled layer styles from the composite while masking to the layer pixels", () => {
    const layerCanvas = { width: 40, height: 20 } as HTMLCanvasElement;
    const compositeCanvas = { width: 200, height: 100 } as HTMLCanvasElement;
    const croppedCanvas = { width: 40, height: 20 } as HTMLCanvasElement;
    const drawImage = vi.fn();
    const context = {
      drawImage,
      globalCompositeOperation: "source-over",
      getImageData: () => ({ data: new Uint8ClampedArray(40 * 20 * 4).fill(255) }),
    };
    const outputCanvas = {
      ...croppedCanvas,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: vi.fn(() => outputCanvas) });
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      canvas: compositeCanvas,
      children: [{
        id: 2,
        name: "styled-shape",
        left: 10,
        top: 20,
        right: 50,
        bottom: 40,
        canvas: layerCanvas,
        vectorMask: { paths: [] },
        effects: { stroke: [{ enabled: true, present: true }] },
      }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));

    expect(scene.nodes[0].image).toBe(outputCanvas);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(warnings).toContain("图层「styled-shape」已栅格化图层样式，并按图层像素范围裁切");
    vi.unstubAllGlobals();
  });

  it("imports root folders as image-free Layout nodes instead of inferring a control", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      children: [{
        id: 1,
        name: "btn_panel",
        children: [{
          id: 2,
          name: "background",
          left: 10,
          top: 20,
          right: 110,
          bottom: 70,
          canvas: {} as HTMLCanvasElement,
        }],
      }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));
    const folder = scene.nodes[0];

    expect(folder.ctrl).toEqual({ type: "Layout" });
    expect(folder.image).toBeNull();
    expect(folder.children?.[0].ctrl).toEqual({ type: "StaticImage" });
    expect(folder.zIndex).toBeLessThan(folder.children?.[0].zIndex ?? -Infinity);
    expect(warnings).toEqual([]);
  });

  it("keeps an empty PSD folder as an empty Layout node", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      children: [{ id: 3, name: "empty_group", children: [] }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));
    const folder = scene.nodes[0];

    expect(folder.ctrl).toEqual({ type: "Layout" });
    expect(folder.image).toBeNull();
    expect(folder.children).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("uses an explicit Chinese control folder name for non-root folders", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      children: [{ id: 10, name: "panel", children: [{ id: 11, name: "按钮", children: [{
        id: 12, name: "确认", left: 10, top: 10, right: 60, bottom: 40, canvas: {} as HTMLCanvasElement,
      }] }] }],
    } as never);

    const { scene } = importPsd(new ArrayBuffer(0));
    expect(scene.nodes[0].ctrl).toEqual({ type: "Layout" });
    expect(scene.nodes[0].children?.[0].ctrl).toEqual({ type: "Button" });
  });

  it("keeps the PSD font size in the editor and uses a fixed source text box", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 320,
      height: 180,
      children: [{ id: 20, name: "标题", left: 20, top: 30, right: 180, bottom: 54,
        text: { text: "标题", style: { font: { name: "SomePsdFont" }, fontSize: 17 } },
      }],
    } as never);

    const { scene } = importPsd(new ArrayBuffer(0));
    expect(scene.nodes[0].text).toMatchObject({ font: "DroidSans", fontSize: 17, mode: "fixed" });
  });

  it("splits rich text runs into aligned text controls without changing the source bounds", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 320,
      height: 180,
      children: [{ id: 21, name: "experience", left: 40, top: 30, right: 160, bottom: 54,
        text: {
          text: "50/120",
          transform: [1, 0, 0, 1, 80, 56.2],
          style: { fontSize: 16, fillColor: { r: 255, g: 255, b: 255 } },
          styleRuns: [
            { length: 2, style: { fontSize: 17, fillColor: { r: 255, g: 220, b: 40 } } },
            { length: 4, style: { fontSize: 13, fillColor: { r: 220, g: 220, b: 220 } } },
          ],
        },
      }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));
    expect(scene.nodes).toHaveLength(2);
    expect(scene.nodes.map((node) => node.name)).toEqual(["experience", "experience_2"]);
    expect(scene.nodes.map((node) => node.text?.content)).toEqual(["50", "/120"]);
    expect(scene.nodes.map((node) => node.text?.fontSize)).toEqual([17, 13]);
    expect(scene.nodes.map((node) => node.text?.horizontalAlign)).toEqual(["right", "left"]);
    expect(scene.nodes.map((node) => node.text?.verticalAlign)).toEqual(["bottom", "bottom"]);
    expect(scene.nodes.map((node) => node.text?.mode)).toEqual(["fixed", "fixed"]);
    expect(scene.nodes[0].text?.color).toBe("rgb(255,220,40)");
    expect(scene.nodes[1].text?.color).toBe("rgb(220,220,220)");
    expect(scene.nodes.map((node) => node.psd.originalBaseline)).toEqual([56.2, 56.2]);
    expect(scene.nodes[0].designRect.x).toBe(40);
    expect(scene.nodes[0].designRect.width + scene.nodes[1].designRect.width).toBeCloseTo(120);
    expect(warnings).toContain("文字图层「experience」包含多种字号或颜色，已拆分为 2 个文字控件");
  });

  it("applies a PSD text transform scale to each rich text segment", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 320,
      height: 180,
      children: [{ id: 22, name: "scaled_experience", left: 40, top: 30, right: 160, bottom: 54,
        text: {
          text: "50/120",
          transform: [1.6, 0, 0, 1.6, 0, 0],
          style: { fontSize: 16, fillColor: { r: 255, g: 255, b: 255 } },
          styleRuns: [
            { length: 2, style: { fontSize: 17, fillColor: { r: 255, g: 220, b: 40 } } },
            { length: 4, style: { fontSize: 13, fillColor: { r: 220, g: 220, b: 220 } } },
          ],
        },
      }],
    } as never);

    const { scene } = importPsd(new ArrayBuffer(0));
    expect(scene.nodes.map((node) => node.text?.fontSize)).toEqual([expect.closeTo(27.2), expect.closeTo(20.8)]);
  });
});
