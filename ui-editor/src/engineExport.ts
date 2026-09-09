import { LayoutEngine } from "./layoutEngine";
import { mapToEngineFont } from "./engineFont";
import { resourceSlotDefinitions } from "./resourceBinding";
import { progressConfig } from "./progressControl";
import type { LayoutResult, ResourceSlot, UINode, UIScene } from "./types";

export interface EngineExportResult {
  json: string;
  errors: string[];
  warnings: string[];
}

export interface EngineAssetReference {
  assetPath: string;
  frameName: string;
  reference: string;
}

export interface EngineExportOptions {
  /** imageset 文件名（不含 .json），默认使用 ui-project。 */
  atlasName?: string;
  /** 由测试包生成器提供的稳定资源映射；不传时按工程资源路径自动生成。 */
  assetReferences?: Record<string, string>;
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
  return `{{0,${number(rect.x)}},{0,${number(rect.y)}},{0,${number(rect.x + rect.width)}},{0,${number(rect.y + rect.height)}}}`;
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

function frameNameForAsset(assetPath: string): string {
  const stem = assetPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
  return stem.replace(/[^0-9A-Za-z_-]+/g, "_") || "image";
}

export function collectEngineAssetPaths(nodes: UINode[], paths = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.assetPath) paths.add(node.assetPath.replace(/\\/g, "/"));
    collectEngineAssetPaths(node.children ?? [], paths);
    for (const binding of Object.values(node.resources ?? {})) {
      if (binding?.sourceNode) collectEngineAssetPaths([binding.sourceNode], paths);
    }
  }
  return paths;
}

/** 为引擎 imageset 生成稳定的 frame 名和 set:... image:... 引用。 */
export function createEngineAssetManifest(assetPaths: Iterable<string>, atlasName = "ui-project"): EngineAssetReference[] {
  const used = new Set<string>();
  const safeAtlasName = atlasName.replace(/[^0-9A-Za-z_-]+/g, "_") || "ui-project";
  return [...new Set([...assetPaths].map((item) => item.replace(/\\/g, "/")))].map((assetPath) => {
    const base = frameNameForAsset(assetPath);
    let frameName = base;
    let suffix = 2;
    while (used.has(frameName.toLocaleLowerCase())) frameName = `${base}_${suffix++}`;
    used.add(frameName.toLocaleLowerCase());
    return {
      assetPath,
      frameName,
      reference: `set:${safeAtlasName}.json image:${frameName}`,
    };
  });
}

function imageReference(node: UINode | undefined, assetReferences: Record<string, string>): string | null {
  const assetPath = node?.assetPath?.replace(/\\/g, "/");
  return assetPath ? assetReferences[assetPath] ?? null : null;
}

function bindingReference(node: UINode, slot: ResourceSlot, assetReferences: Record<string, string>): string | null {
  return imageReference(node.resources?.[slot]?.sourceNode, assetReferences);
}

function exportType(node: UINode, warnings: string[]): string {
  if (node.ctrl?.type === "empty") {
    warnings.push(`节点「${node.name}」的编辑器类型 empty 将按 Layout 导出`);
    return "Layout";
  }
  return node.ctrl?.type ?? "Layout";
}

function parentMap(nodes: UINode[], parents = new Map<string, UINode>()): Map<string, UINode> {
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      parents.set(child.id, node);
      parentMap([child], parents);
    }
  }
  return parents;
}

function areaForNode(node: UINode, layout: LayoutResult, parents: Map<string, UINode>, scene: UIScene): string {
  const entry = layout.nodes.find((item) => item.node.id === node.id);
  const visualRect = entry?.rect ?? { ...node.designRect };
  const parentNode = parents.get(node.id);
  const parentEntry = parentNode ? layout.nodes.find((item) => item.node.id === parentNode.id) : undefined;
  const parent = parentEntry?.rect;
  // 文本 auto 模式的编辑器渲染框会按字体行高暂时放大；引擎 Area 仍应使用
  // 工程记录的设计尺寸，否则字体替换会把节点导出成错误的高度。
  const globalRect = { ...visualRect, width: node.designRect.width, height: node.designRect.height };
  const rect = parent
    ? { ...globalRect, x: globalRect.x - parent.x, y: globalRect.y - parent.y }
    : globalRect;
  const parentWidth = parentNode?.designRect.width ?? parent?.width ?? scene.designWidth;
  const parentHeight = parentNode?.designRect.height ?? parent?.height ?? scene.designHeight;

  // 引擎 Area 是 min/max 坐标；对齐点参照的是“父容器减去控件尺寸”后的可放置范围。
  const x = rect.x - alignmentFactor(node.anchor.parentX) * (parentWidth - rect.width);
  const y = rect.y - alignmentFactor(node.anchor.parentY) * (parentHeight - rect.height);
  return area({ ...rect, x, y });
}

function addProperty(properties: { Name: string; Value: string }[], name: string, value: string | null | undefined) {
  if (value != null && value !== "") properties.push({ Name: name, Value: value });
}

function buildWindow(node: UINode, layout: LayoutResult, parents: Map<string, UINode>, scene: UIScene,
  assetReferences: Record<string, string>, warnings: string[], errors: string[]): EngineWindow {
  if (!node.ctrl) errors.push(`节点「${node.name}」未指定控件类型`);
  if (!node.name.trim()) errors.push(`存在未命名节点（${node.id}）`);

  const properties: { Name: string; Value: string }[] = [
    { Name: "Area", Value: areaForNode(node, layout, parents, scene) },
    { Name: "HorizontalAlignment", Value: horizontalAlignment(node.anchor.parentX) },
    { Name: "VerticalAlignment", Value: verticalAlignment(node.anchor.parentY) },
  ];
  const type = exportType(node, warnings);
  const slots = resourceSlotDefinitions(node.ctrl?.type);
  for (const slot of slots) {
    if (node.resources?.[slot.key] && !bindingReference(node, slot.key, assetReferences)) {
      errors.push(`节点「${node.name}」的资源槽位「${slot.key}」没有可用工程资源`);
    }
    const reference = bindingReference(node, slot.key, assetReferences);
    if (reference) addProperty(properties, slot.key, reference);
  }

  if (type === "StaticImage" && !node.resources?.ImageName) {
    const reference = imageReference(node, assetReferences);
    if (!reference && node.image) errors.push(`节点「${node.name}」的图片尚未生成工程资源`);
    addProperty(properties, "ImageName", reference);
  }
  if (node.text) {
    const font = mapToEngineFont(node.text.fontSize);
    addProperty(properties, "Text", node.text.content);
    addProperty(properties, "Font", font.name);
    addProperty(properties, "TextHorzAlignment", "Centre");
    addProperty(properties, "TextVertAlignment", "Centre");
    addProperty(properties, "TextColor", node.text.color);
    if (font.clamped) {
      warnings.push(`节点「${node.name}」的字号 ${String(node.text.fontSize)} 超出引擎范围，已映射为 ${font.name}`);
    }
  }
  if (type === "ProgressBar" || type === "Slider") {
    const progress = progressConfig(node);
    addProperty(properties, "Progress", number(progress.value));
    if (progress.direction === "vertical") addProperty(properties, "ProgressIsVertical", "true");
  }
  if (node.rotation) addProperty(properties, "Rotate", number(node.rotation));
  if (node.children?.length === 0) warnings.push(`节点「${node.name}」包含空子节点列表，导出为空 Window`);

  const children = node.children?.map((child) => buildWindow(child, layout, parents, scene, assetReferences, warnings, errors));
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
export function buildEngineJson(scene: UIScene, options: EngineExportOptions = {}): EngineExportResult {
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

  const manifest = createEngineAssetManifest(collectEngineAssetPaths(layoutScene.nodes), options.atlasName ?? "ui-project");
  const assetReferences = options.assetReferences ?? Object.fromEntries(manifest.map((item) => [item.assetPath, item.reference]));
  const parents = parentMap(scene.nodes);

  if (!scene.nodes.length) errors.push("工程没有可导出的节点");
  const exportRoot: UINode = isCanvasRoot
    ? {
      ...scene.nodes[0],
      anchor: { ...scene.nodes[0].anchor, parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0 },
    }
    : scene.nodes[0]!;
  const root = isCanvasRoot
    ? buildWindow(exportRoot, layout, parents, scene, assetReferences, warnings, errors)
    : {
      Type: "Layout",
      Name: "root",
      Property: [{ Name: "Area", Value: `{{0,0},{0,0},{0,${number(scene.designWidth)}},{0,${number(scene.designHeight)}}}` }],
      Window: scene.nodes.map((node) => buildWindow(node, layout, parents, scene, assetReferences, warnings, errors)),
    } satisfies EngineWindow;

  return {
    json: JSON.stringify({ Dialog: { Window: root } }, null, 2),
    errors,
    warnings,
  };
}
