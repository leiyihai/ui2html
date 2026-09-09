import { LayoutEngine } from "./layoutEngine";
import { resourceSlotDefinitions } from "./resourceBinding";
import { progressConfig } from "./progressControl";
import type { LayoutResult, ResourceSlot, UINode, UIScene } from "./types";

export interface EngineExportResult {
  json: string;
  errors: string[];
  warnings: string[];
}

interface EngineWindow {
  Type: string;
  Name: string;
  Property: { Name: string; Value: string }[];
  Window?: EngineWindow[];
}

function number(value: number): string {
  const rounded = Math.round((Object.is(value, -0) ? 0 : value) * 10000) / 10000;
  return String(rounded);
}

function area(rect: { x: number; y: number; width: number; height: number }): string {
  return `{{0,${number(rect.x)}},{0,${number(rect.y)}},{0,${number(rect.width)}},{0,${number(rect.height)}}}`;
}

function alignmentFactor(value: number): number {
  if (value >= 0.75) return 1;
  if (value >= 0.25) return 0.5;
  return 0;
}

function horizontalAlignment(value: number): string {
  if (value >= 0.75) return "Right";
  if (value >= 0.25) return "Centre";
  return "Left";
}

function verticalAlignment(value: number): string {
  if (value >= 0.75) return "Bottom";
  if (value >= 0.25) return "Centre";
  return "Top";
}

function imageReference(node: UINode | undefined): string | null {
  const path = node?.assetPath;
  return path ? path.replace(/\\/g, "/") : null;
}

function bindingReference(node: UINode, slot: ResourceSlot): string | null {
  return imageReference(node.resources?.[slot]?.sourceNode);
}

function exportType(node: UINode, warnings: string[]): string {
  if (node.ctrl?.type === "empty") {
    warnings.push(`节点「${node.name}」的编辑器类型 empty 将按 Layout 导出`);
    return "Layout";
  }
  return node.ctrl?.type ?? "Layout";
}

function rectInParent(node: UINode, layout: LayoutResult): LayoutResult["nodes"][number]["rect"] {
  const entry = layout.nodes.find((item) => item.node.id === node.id);
  if (!entry) return { ...node.designRect };
  if (!entry.parent) return { ...entry.rect };
  return {
    x: entry.rect.x - entry.parent.x,
    y: entry.rect.y - entry.parent.y,
    width: entry.rect.width,
    height: entry.rect.height,
  };
}

function areaForNode(node: UINode, layout: LayoutResult): string {
  const entry = layout.nodes.find((item) => item.node.id === node.id);
  const rect = rectInParent(node, layout);
  const parent = entry?.parent;
  if (!parent) return area(rect);

  // The engine interprets Area's position relative to the declared alignment.
  // Convert the editor's visual top-left position back to that offset first.
  const x = rect.x - alignmentFactor(node.anchor.parentX) * parent.width;
  const y = rect.y - alignmentFactor(node.anchor.parentY) * parent.height;
  return area({ ...rect, x, y });
}

function addProperty(properties: { Name: string; Value: string }[], name: string, value: string | null | undefined) {
  if (value != null && value !== "") properties.push({ Name: name, Value: value });
}

function buildWindow(node: UINode, layout: LayoutResult, warnings: string[], errors: string[]): EngineWindow {
  if (!node.ctrl) errors.push(`节点「${node.name}」未指定控件类型`);
  if (!node.name.trim()) errors.push(`存在未命名节点（${node.id}）`);

  const properties: { Name: string; Value: string }[] = [
    { Name: "Area", Value: areaForNode(node, layout) },
    { Name: "HorizontalAlignment", Value: horizontalAlignment(node.anchor.parentX) },
    { Name: "VerticalAlignment", Value: verticalAlignment(node.anchor.parentY) },
  ];
  const type = exportType(node, warnings);
  const slots = resourceSlotDefinitions(node.ctrl?.type);
  for (const slot of slots) {
    if (node.resources?.[slot.key] && !bindingReference(node, slot.key)) {
      errors.push(`节点「${node.name}」的资源槽位「${slot.key}」没有可用工程资源`);
    }
    const reference = bindingReference(node, slot.key);
    if (reference) addProperty(properties, slot.key, reference);
  }

  if (type === "StaticImage" && !node.resources?.ImageName) {
    const reference = imageReference(node);
    if (!reference && node.image) errors.push(`节点「${node.name}」的图片尚未生成工程资源`);
    addProperty(properties, "ImageName", reference);
  }
  if (node.text) {
    addProperty(properties, "Text", node.text.content);
    addProperty(properties, "Font", node.text.font);
    addProperty(properties, "TextColor", node.text.color);
  }
  if (type === "ProgressBar" || type === "Slider") {
    const progress = progressConfig(node);
    addProperty(properties, "Progress", number(progress.value));
    if (progress.direction === "vertical") addProperty(properties, "ProgressIsVertical", "true");
  }
  if (node.rotation) addProperty(properties, "Rotate", number(node.rotation));
  if (node.children?.length === 0) warnings.push(`节点「${node.name}」包含空子节点列表，导出为空 Window`);

  const children = node.children?.map((child) => buildWindow(child, layout, warnings, errors));
  return {
    Type: type,
    Name: node.name,
    Property: properties,
    ...(children?.length ? { Window: children } : {}),
  };
}

function hasFullCanvasRect(node: UINode, scene: UIScene): boolean {
  return node.ctrl?.type === "Layout"
    && node.designRect.x === 0 && node.designRect.y === 0
    && node.designRect.width === scene.designWidth && node.designRect.height === scene.designHeight;
}

/** 将编辑器工程转换为基础自研引擎 Dialog/Window JSON。 */
export function buildEngineJson(scene: UIScene): EngineExportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const isCanvasRoot = scene.nodes.length === 1 && hasFullCanvasRect(scene.nodes[0], scene);
  const layoutScene = isCanvasRoot
    ? {
      ...scene,
      nodes: [{
        ...scene.nodes[0],
        anchor: { ...scene.nodes[0].anchor, parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0 },
      }],
    }
    : scene;
  const layout = new LayoutEngine().layoutScene(layoutScene, {
    designWidth: scene.designWidth,
    designHeight: scene.designHeight,
    viewportWidth: scene.designWidth,
    viewportHeight: scene.designHeight,
    safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
    scaleMode: "cover",
  });

  if (!scene.nodes.length) errors.push("工程没有可导出的节点");
  const root = isCanvasRoot
    ? buildWindow(scene.nodes[0], layout, warnings, errors)
    : {
      Type: "Layout",
      Name: "root",
      Property: [{ Name: "Area", Value: `{{0,0},{0,0},{0,${number(scene.designWidth)}},{0,${number(scene.designHeight)}}}` }],
      Window: scene.nodes.map((node) => buildWindow(node, layout, warnings, errors)),
    } satisfies EngineWindow;

  return {
    json: JSON.stringify({ Dialog: { Window: root } }, null, 2),
    errors,
    warnings,
  };
}
