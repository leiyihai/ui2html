import type { UIScene, UINode } from "./types";

export interface CroppedCanvas {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** 裁切 alpha>0 的最小包围盒；全透明图片返回 null。 */
export function cropCanvasToVisiblePixels(source: HTMLCanvasElement): CroppedCanvas | null {
  if (typeof source.getContext !== "function") return { canvas: source, offsetX: 0, offsetY: 0, sourceWidth: source.width, sourceHeight: source.height };
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context || source.width < 1 || source.height < 1) return null;
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (pixels[(y * source.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return { canvas: source, offsetX: 0, offsetY: 0, sourceWidth: source.width, sourceHeight: source.height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = maxX - minX + 1;
  canvas.height = maxY - minY + 1;
  canvas.getContext("2d")!.drawImage(source, minX, minY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return { canvas, offsetX: minX, offsetY: minY, sourceWidth: source.width, sourceHeight: source.height };
}

/** 对 PSD 导入结果执行有效像素裁切，同时修正位置，保证视觉不移动。 */
export function cropImportedSceneImages(scene: UIScene, warnings: string[]): UIScene {
  const visit = (nodes: UINode[]): UINode[] => nodes.flatMap((source) => {
    const node: UINode = { ...source };
    if (node.children) node.children = visit(node.children);
    if (!node.image) return [node];
    const cropped = cropCanvasToVisiblePixels(node.image);
    if (!cropped) {
      warnings.push(`跳过图层「${node.name}」：图片完全透明`);
      return [];
    }
    node.image = cropped.canvas;
    node.designRect = {
      x: node.designRect.x + cropped.offsetX,
      y: node.designRect.y + cropped.offsetY,
      width: cropped.canvas.width,
      height: cropped.canvas.height,
    };
    node.anchor = {
      ...node.anchor,
      offsetX: node.anchor.offsetX + cropped.offsetX,
      offsetY: node.anchor.offsetY + cropped.offsetY,
    };
    node.psd = {
      ...node.psd,
      originalX: node.psd.originalX + cropped.offsetX,
      originalY: node.psd.originalY + cropped.offsetY,
      originalWidth: cropped.canvas.width,
      originalHeight: cropped.canvas.height,
    };
    return [node];
  });
  return { ...scene, nodes: visit(scene.nodes) };
}

export async function canvasFromImageFile(file: File): Promise<CroppedCanvas | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return cropCanvasToVisiblePixels(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let importedNodeId = 1;

export function createImageNode(name: string, cropped: CroppedCanvas, x: number, y: number, zIndex: number): UINode {
  const id = `asset-${Date.now()}-${importedNodeId++}`;
  return {
    id,
    name: name.replace(/\.[^.]+$/, "") || "图片",
    image: cropped.canvas,
    ctrl: { type: "StaticImage" },
    designRect: { x, y, width: cropped.canvas.width, height: cropped.canvas.height },
    anchor: {
      parentX: 0,
      parentY: 0,
      selfX: 0,
      selfY: 0,
      offsetX: x,
      offsetY: y,
      safeArea: false,
    },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    visible: true,
    zIndex,
    adaptation: { mode: "anchor" },
    psd: {
      layerId: -Date.now() - importedNodeId,
      originalX: x,
      originalY: y,
      originalWidth: cropped.canvas.width,
      originalHeight: cropped.canvas.height,
    },
  };
}
