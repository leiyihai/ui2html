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
      measureText: vi.fn(() => ({ width: 0 })),
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
    expect(context.textBaseline).toBe("middle");
    expect(context.font).toContain('"DroidSans"');
    expect(fillText).toHaveBeenCalledWith("标题", 80, 50);
  });

  it("shrinks single-line auto text to its measured width instead of clipping it", () => {
    const fillText = vi.fn();
    const context = {
      canvas: { width: 320, height: 180 },
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fillText,
      measureText: vi.fn(() => ({ width: 240 })),
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
    expect(fillText).toHaveBeenCalledWith("MOSY MEADOW", 80, 20);
  });
});
