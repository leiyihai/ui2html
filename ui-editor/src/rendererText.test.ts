import { describe, expect, it, vi } from "vitest";
import { renderUi } from "./renderer";

describe("text rendering defaults", () => {
  it("centers text horizontally and vertically in the node rectangle", () => {
    const fillText = vi.fn();
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 0, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 })),
      globalAlpha: 1,
      textAlign: "left",
      textBaseline: "alphabetic",
    } as unknown as CanvasRenderingContext2D;
    const node = {
      id: "title",
      name: "title",
      image: null,
      text: { content: "标题", fontSize: 16, color: "#fff", mode: "auto" as const, minFontSize: 8 },
      designRect: { x: 0, y: 0, width: 120, height: 40 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
      children: [],
      adaptation: { mode: "anchor" as const },
      psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 120, originalHeight: 40 },
    };

    renderUi(context, {
      nodes: [{ node, rect: { x: 20, y: 30, width: 120, height: 40 }, visible: true, opacity: 1 }],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0 },
    });

    expect(context.textAlign).toBe("center");
    expect(context.textBaseline).toBe("alphabetic");
    expect(context.font).toContain('"DroidSans"');
    expect(fillText).toHaveBeenCalledWith("标题", 80, 54);
  });

  it("shrinks single-line auto text to its measured width instead of clipping it", () => {
    const fillText = vi.fn();
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 240, actualBoundingBoxAscent: 28, actualBoundingBoxDescent: 6 })),
      globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", font: "",
    } as unknown as CanvasRenderingContext2D;
    const node = {
      id: "title", name: "title", image: null,
      text: { content: "MOSY MEADOW", fontSize: 48, color: "#fff", mode: "auto" as const, minFontSize: 24 },
      designRect: { x: 0, y: 0, width: 160, height: 40 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 1,
      children: [], adaptation: { mode: "anchor" as const },
      psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 160, originalHeight: 40 },
    };

    renderUi(context, {
      nodes: [{ node, rect: { x: 0, y: 0, width: 160, height: 40 }, visible: true, opacity: 1 }],
      scaleX: 1, scaleY: 1, letterbox: { x: 0, y: 0 },
    });

    expect(context.font).toContain("32px");
    expect(fillText).toHaveBeenCalledWith("MOSY MEADOW", 80, 31);
  });

  it("uses the actual glyph box to keep imported PSD text on its visual baseline", () => {
    const fillText = vi.fn();
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 63, actualBoundingBoxAscent: 26, actualBoundingBoxDescent: 1 })),
      globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", font: "",
    } as unknown as CanvasRenderingContext2D;
    const node = {
      id: "score", name: "score", image: null,
      text: { content: "+13", fontSize: 36, color: "#ffe786", mode: "fixed" as const, minFontSize: 18 },
      designRect: { x: 0, y: 0, width: 63, height: 27 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 1,
      children: [], adaptation: { mode: "anchor" as const },
      psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 63, originalHeight: 27 },
    };

    renderUi(context, {
      nodes: [{ node, rect: { x: 10, y: 20, width: 63, height: 27 }, visible: true, opacity: 1 }],
      scaleX: 1, scaleY: 1, letterbox: { x: 0, y: 0 },
    });

    expect(context.textBaseline).toBe("alphabetic");
    expect(fillText).toHaveBeenCalledWith("+13", 41.5, 46);
  });

  it("does not clip fixed text when the current font glyphs exceed the source box", () => {
    const rectCalls: number[][] = [];
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
      rect: vi.fn((...args: number[]) => rectCalls.push(args)), clip: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 52, actualBoundingBoxLeft: 1, actualBoundingBoxRight: 51, actualBoundingBoxAscent: 18, actualBoundingBoxDescent: 5 })),
      globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", font: "",
    } as unknown as CanvasRenderingContext2D;
    const node = {
      id: "score", name: "score", image: null,
      text: { content: "+13", fontSize: 36, color: "#fff", mode: "fixed" as const, minFontSize: 18, horizontalAlign: "left" as const, verticalAlign: "bottom" as const },
      designRect: { x: 0, y: 0, width: 20, height: 20 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 1,
      children: [], adaptation: { mode: "anchor" as const },
      psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 20, originalHeight: 20 },
    };

    renderUi(context, {
      nodes: [{ node, rect: { x: 10, y: 20, width: 20, height: 20 }, visible: true, opacity: 1 }],
      scaleX: 1, scaleY: 1, letterbox: { x: 0, y: 0 },
    });

    expect(rectCalls.some(([x, , width]) => x < 10 || width > 20)).toBe(true);
  });

  it("recomputes the baseline from the active font metrics after a font switch", () => {
    const fillText = vi.fn();
    let descent = 2;
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 40, actualBoundingBoxAscent: 18, actualBoundingBoxDescent: descent })),
      globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", font: "",
    } as unknown as CanvasRenderingContext2D;
    const node = {
      id: "score", name: "score", image: null,
      text: { content: "+13", fontSize: 20, color: "#fff", font: "FontA", mode: "fixed" as const, minFontSize: 10, verticalAlign: "bottom" as const },
      designRect: { x: 0, y: 0, width: 40, height: 20 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 1,
      children: [], adaptation: { mode: "anchor" as const },
      psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 40, originalHeight: 20 },
    };
    const result = { nodes: [{ node, rect: { x: 10, y: 20, width: 40, height: 20 }, visible: true, opacity: 1 }], scaleX: 1, scaleY: 1, letterbox: { x: 0, y: 0 } };

    renderUi(context, result);
    const firstBaseline = fillText.mock.calls.at(-1)?.[2] as number;
    descent = 6;
    node.text.font = "FontB";
    renderUi(context, result);
    const secondBaseline = fillText.mock.calls.at(-1)?.[2] as number;

    expect(firstBaseline + 2).toBe(40);
    expect(secondBaseline + 6).toBe(40);
    expect(firstBaseline).not.toBe(secondBaseline);
  });

  it("uses the PSD source baseline for imported text instead of re-centering the glyph", () => {
    const fillText = vi.fn();
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 40, actualBoundingBoxAscent: 18, actualBoundingBoxDescent: 4 })),
      globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", font: "",
    } as unknown as CanvasRenderingContext2D;
    const node = {
      id: "score", name: "score", image: null,
      text: { content: "+13", fontSize: 36, color: "#fff", mode: "fixed" as const, minFontSize: 18, verticalAlign: "center" as const },
      designRect: { x: 0, y: 0, width: 63, height: 27 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 1,
      children: [], adaptation: { mode: "anchor" as const },
      psd: { layerId: 1, originalX: 0, originalY: 100, originalWidth: 63, originalHeight: 27, originalBaseline: 127.2 },
    };

    renderUi(context, {
      nodes: [{ node, rect: { x: 10, y: 100, width: 63, height: 27 }, visible: true, opacity: 1 }],
      scaleX: 1, scaleY: 1, letterbox: { x: 0, y: 0 },
    });

    expect(fillText).toHaveBeenCalledWith("+13", 41.5, 127.2);
  });
});
