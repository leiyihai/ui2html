import { describe, expect, it, vi } from "vitest";
import { renderUi } from "./renderer";

describe("layout resource rendering", () => {
  it("draws the LayoutBackImage resource bound to a layout", () => {
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage,
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;

    const boundImage = { width: 296, height: 404 } as HTMLCanvasElement;
    const layoutNode = {
      id: "node-82",
      name: "bag",
      ctrl: { type: "Layout" },
      resources: {
        LayoutBackImage: {
          id: "node-83",
          name: "img_panel_bd",
          image: boundImage,
        },
      },
      designRect: { x: 0, y: 0, width: 296, height: 404 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: 0,
      children: [],
    };

    const render = renderUi as unknown as (...args: unknown[]) => void;
    render(context, {
      nodes: [
        {
          node: layoutNode,
          rect: { x: 20, y: 30, width: 296, height: 404 },
          visible: true,
          opacity: 1,
        },
      ],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0, width: 296, height: 404 },
    });

    expect(drawImage).toHaveBeenCalledWith(boundImage, 20, 30, 296, 404);
  });

  it("draws a lower-z scene background before higher-z content", () => {
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const background = { name: "img_bg" } as unknown as HTMLCanvasElement;
    const content = { name: "content" } as unknown as HTMLCanvasElement;
    const node = (name: string, zIndex: number, image: HTMLCanvasElement) => ({
      id: name,
      name,
      image,
      designRect: { x: 0, y: 0, width: 100, height: 100 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex,
    });
    const render = renderUi as unknown as (...args: unknown[]) => void;
    render(context, {
      nodes: [
        { node: node("img_bg", 1, background), rect: { x: 0, y: 0, width: 100, height: 100 }, visible: true, opacity: 1 },
        { node: node("content", 2, content), rect: { x: 0, y: 0, width: 100, height: 100 }, visible: true, opacity: 1 },
      ],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0, width: 100, height: 100 },
    });

    expect(drawImage.mock.calls.map(([image]) => image)).toEqual([background, content]);
  });

  it("draws a layout background before descendants without reversing scene z-order", () => {
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    const funcImage = { name: "func background" } as unknown as HTMLCanvasElement;
    const titleImage = { name: "title" } as unknown as HTMLCanvasElement;
    const listImage = { name: "列表" } as unknown as HTMLCanvasElement;
    const node = (name: string, zIndex: number, image: HTMLCanvasElement) => ({
      id: name,
      name,
      image,
      designRect: { x: 0, y: 0, width: 100, height: 100 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex,
    });
    const titleNode = node("title", 78, titleImage);
    const listNode = node("列表", 75, listImage);
    const funcNode = {
      ...node("func", 79, funcImage),
      image: null,
      ctrl: { type: "Layout" },
      children: [titleNode, listNode],
      resources: {
        LayoutBackImage: {
          id: "func-background",
          name: "func background",
          image: funcImage,
        },
      },
    };
    const render = renderUi as unknown as (...args: unknown[]) => void;
    render(context, {
      nodes: [
        { node: funcNode, rect: { x: 0, y: 0, width: 100, height: 100 }, visible: true, opacity: 1 },
        { node: titleNode, rect: { x: 0, y: 0, width: 100, height: 100 }, visible: true, opacity: 1 },
        { node: listNode, rect: { x: 0, y: 0, width: 100, height: 100 }, visible: true, opacity: 1 },
      ],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0, width: 100, height: 100 },
    });

    expect(drawImage.mock.calls.map(([image]) => image)).toEqual([
      funcImage,
      listImage,
      titleImage,
    ]);
  });
});
