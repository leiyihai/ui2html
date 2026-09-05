import { describe, expect, it, vi } from "vitest";
import { renderUi } from "./renderer";
import type { UINode } from "./types";

function renderBoundControl(type: string, slotNames: string[]): HTMLCanvasElement[] {
  const drawImage = vi.fn();
  const context = {
    canvas: { width: 800, height: 600 },
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  const resources = Object.fromEntries(slotNames.map((slot) => [slot, {
    id: slot,
    name: slot,
    image: { name: slot } as unknown as HTMLCanvasElement,
  }]));
  const node = {
    id: type,
    name: type,
    image: null,
    ctrl: { type },
    resources,
    designRect: { x: 0, y: 0, width: 100, height: 30 },
    anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex: 1,
    children: [],
    ...(type === "ProgressBar" || type === "Slider" ? { progress: { value: 1, direction: "horizontal", reverse: false } } : {}),
  };
  const render = renderUi as unknown as (...args: unknown[]) => void;
  render(context, {
    nodes: [{ node, rect: { x: 10, y: 20, width: 100, height: 30 }, visible: true, opacity: 1 }],
    scaleX: 1,
    scaleY: 1,
    letterbox: { x: 0, y: 0, width: 800, height: 600 },
  });
  return drawImage.mock.calls.map(([image]) => image as HTMLCanvasElement);
}

describe("bound resource rendering", () => {
  it("draws the images bound to a ProgressBar instead of making them disappear", () => {
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const background = { name: "progress background" } as unknown as HTMLCanvasElement;
    const progress = { name: "progress fill" } as unknown as HTMLCanvasElement;
    const progressNode = {
      id: "progress",
      name: "pbar",
      image: null,
      ctrl: { type: "ProgressBar" },
      resources: {
        ProgressBackImage: { id: "back", name: "back", image: background },
        ProgressImage: { id: "fill", name: "fill", image: progress },
      },
      designRect: { x: 0, y: 0, width: 337, height: 24 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
      adaptation: { mode: "anchor" },
      psd: { layerId: -1, originalX: 0, originalY: 0, originalWidth: 200, originalHeight: 40 },
      children: [],
      progress: { value: 1, direction: "horizontal", reverse: false },
    };

    const render = renderUi as unknown as (...args: unknown[]) => void;
    render(context, {
      nodes: [{
        node: progressNode,
        rect: { x: 100, y: 50, width: 337, height: 24 },
        visible: true,
        opacity: 1,
      }],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0, width: 800, height: 600 },
    });

    expect(drawImage.mock.calls.map(([image]) => image)).toEqual([background, progress]);
  });

  it("keeps a bound progress header at its source visual size and moves it by value", () => {
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const header = { width: 38, height: 38, name: "thumb" } as unknown as HTMLCanvasElement;
    const fill = { width: 200, height: 40, name: "fill" } as unknown as HTMLCanvasElement;
    const node = {
      id: "slider",
      name: "slider_volume",
      image: null,
      ctrl: { type: "Slider" as const },
      progress: { value: 0.5, direction: "horizontal" as const, reverse: false },
      resources: {
        ProgressImage: {
          id: "fill",
          name: "fill",
          image: fill,
          sourceNode: {} as UINode,
          sourceParentId: null,
          sourceIndex: 0,
        },
        ProgressHeaderImage: {
          id: "thumb",
          name: "thumb",
          image: header,
          sourceNode: {
            designRect: { x: 0, y: 0, width: 38, height: 38 },
            scale: { x: 1, y: 1 },
          } as UINode,
          sourceParentId: null,
          sourceIndex: 0,
        },
      },
      designRect: { x: 0, y: 0, width: 200, height: 40 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
      adaptation: { mode: "anchor" },
      psd: { layerId: -1, originalX: 0, originalY: 0, originalWidth: 200, originalHeight: 40 },
      children: [],
    };

    renderUi(context, {
      nodes: [{ node: node as unknown as UINode, rect: { x: 0, y: 0, width: 200, height: 40 }, visible: true, opacity: 1 }],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0 },
    });

    expect(drawImage).toHaveBeenLastCalledWith(header, 81, 1, 38, 38);
    expect(context.rect).toHaveBeenCalledWith(0, 0, 100, 40);
  });

  it("hides the progress image at zero while leaving the header at the track start", () => {
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const background = { name: "background" } as unknown as HTMLCanvasElement;
    const fill = { name: "fill" } as unknown as HTMLCanvasElement;
    const header = { width: 20, height: 20, name: "header" } as unknown as HTMLCanvasElement;
    const node = {
      id: "slider",
      name: "slider",
      image: null,
      ctrl: { type: "Slider" as const },
      progress: { value: 0, direction: "horizontal" as const, reverse: false },
      resources: {
        ProgressBackImage: { id: "back", name: "back", image: background, sourceNode: {} as UINode, sourceParentId: null, sourceIndex: 0 },
        ProgressImage: { id: "fill", name: "fill", image: fill, sourceNode: {} as UINode, sourceParentId: null, sourceIndex: 1 },
        ProgressHeaderImage: {
          id: "head", name: "head", image: header,
          sourceNode: {} as UINode,
          sourceParentId: null,
          sourceIndex: 2,
        },
      },
      designRect: { x: 0, y: 0, width: 100, height: 20 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
      adaptation: { mode: "anchor" },
      psd: { layerId: -1, originalX: 0, originalY: 0, originalWidth: 100, originalHeight: 20 },
      children: [],
    };

    renderUi(context, {
      nodes: [{ node: node as unknown as UINode, rect: { x: 0, y: 0, width: 100, height: 20 }, visible: true, opacity: 1 }],
      scaleX: 1,
      scaleY: 1,
      letterbox: { x: 0, y: 0 },
    });

    expect(drawImage.mock.calls.map(([image]) => image)).toEqual([background, header]);
    expect(drawImage).toHaveBeenLastCalledWith(header, -10, 0, 20, 20);
    expect(drawImage).not.toHaveBeenCalledWith(fill, expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("renders the visible resource slots for every bindable control type", () => {
    const cases = [
      ["StaticImage", ["ImageName"], ["ImageName"]],
      ["Button", ["NormalImage", "PushedImage"], ["NormalImage"]],
      ["CheckBox", ["NormalImage", "PushedImage"], ["NormalImage"]],
      ["RadioButton", ["NormalImage", "PushedImage"], ["NormalImage"]],
      ["ProgressBar", ["ProgressBackImage", "ProgressImage", "ProgressHeaderImage"], ["ProgressBackImage", "ProgressImage", "ProgressHeaderImage"]],
      ["Slider", ["ProgressBackImage", "ProgressImage", "ProgressHeaderImage"], ["ProgressBackImage", "ProgressImage", "ProgressHeaderImage"]],
      ["Edit", ["EditBackImage"], ["EditBackImage"]],
    ] as const;

    for (const [type, slots, expected] of cases) {
      const drawn = renderBoundControl(type, [...slots]);
      expect(drawn.map((image) => (image as unknown as { name: string }).name), type).toEqual(expected);
    }
  });

  it("falls back to the pushed image when an interactive control has no normal image", () => {
    const drawn = renderBoundControl("Button", ["PushedImage"]);
    expect((drawn[0] as unknown as { name: string }).name).toBe("PushedImage");
  });

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
