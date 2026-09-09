import { LayoutEngine } from "./layoutEngine";
import { mapToEngineFont } from "./engineFont";
import { resourceSlotDefinitions } from "./resourceBinding";
import { progressConfig } from "./progressControl";
import type { LayoutResult, LayoutValue, NineSliceGroup, ResourceSlot, UINode, UIScene } from "./types";

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

interface UDim {
  relative: number;
  absolute: number;
}

function uDim(relative: number, absolute: number): UDim {
  return { relative, absolute };
}

function uDimValue(value: LayoutValue | undefined, fallback: number): UDim {
  if (!value) {
    return uDim(0, fallback);
  }
  return uDim(Number(value.relative) || 0, Number(value.absolute) || 0);
}

function addUDim(a: UDim, b: UDim): UDim {
  return uDim(a.relative + b.relative, a.absolute + b.absolute);
}

function subtractUDim(a: UDim, b: UDim): UDim {
  return uDim(a.relative - b.relative, a.absolute - b.absolute);
}

function areaFromUDims(x: UDim, y: UDim, width: UDim, height: UDim): string {
  const right = addUDim(x, width);
  const bottom = addUDim(y, height);
  return `{{${number(x.relative)},${number(x.absolute)}},{${number(y.relative)},${number(y.absolute)}},` +
    `{${number(right.relative)},${number(right.absolute)}},{${number(bottom.relative)},${number(bottom.absolute)}}}`;
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

function normalizedAssetPath(assetPath: string | undefined): string | null {
  return assetPath ? assetPath.replace(/\\/g, "/") : null;
}

/** 找到节点所属的已确认九宫格逻辑图片组，兼容保存前后的两种关联方式。 */
function nineSliceGroupForNode(node: UINode, scene: UIScene): NineSliceGroup | undefined {
  return scene.nineSliceGroups?.find((group) =>
    (node.nineSliceGroupId && group.id === node.nineSliceGroupId)
    || group.memberNodeIds.includes(node.id));
}

/** 九宫格确认后，导出必须使用 .assets/9 中的公共源图。 */
function effectiveAssetPath(node: UINode | undefined, scene: UIScene): string | null {
  if (!node) return null;
  const group = nineSliceGroupForNode(node, scene);
  return normalizedAssetPath(group?.generatedAssetPath)
    ?? normalizedAssetPath(group?.sourceAssetPath)
    ?? normalizedAssetPath(node.assetPath);
}

function marginsForNode(node: UINode, scene: UIScene): NineSliceGroup | undefined {
  const direct = nineSliceGroupForNode(node, scene);
  if (direct) return direct;
  for (const binding of Object.values(node.resources ?? {})) {
    const group = binding?.sourceNode ? nineSliceGroupForNode(binding.sourceNode, scene) : undefined;
    if (group) return group;
  }
  return undefined;
}

function nineSliceOffset(group: NineSliceGroup): string {
  return [group.margins.left, group.margins.top, group.margins.right, group.margins.bottom]
    .map(number)
    .join(" ");
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

function imageReference(node: UINode | undefined, scene: UIScene, assetReferences: Record<string, string>): string | null {
  const assetPath = effectiveAssetPath(node, scene);
  return assetPath ? assetReferences[assetPath] ?? null : null;
}

function bindingReference(node: UINode, slot: ResourceSlot, scene: UIScene,
  assetReferences: Record<string, string>): string | null {
  return imageReference(node.resources?.[slot]?.sourceNode, scene, assetReferences);
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

  // 用户在属性面板切换为相对值后，直接保留 UDim 的表达式导出。
  // 这样引擎可以继续按父节点尺寸适配，同时仍用 Horizontal/VerticalAlignment
  // 解释“父锚点到控件矩形”的关系。没有 layout 数据的旧工程继续走绝对值兼容路径。
  if (node.layout) {
    const width = uDimValue(node.layout.width, node.designRect.width);
    const height = uDimValue(node.layout.height, node.designRect.height);
    const x = uDimValue(node.layout.x, rect.x);
    const y = uDimValue(node.layout.y, rect.y);
    const fx = alignmentFactor(node.anchor.parentX);
    const fy = alignmentFactor(node.anchor.parentY);
    const parentWidthDim = uDim(0, parentWidth * fx);
    const parentHeightDim = uDim(0, parentHeight * fy);
    return areaFromUDims(
      addUDim(subtractUDim(x, parentWidthDim), uDim(fx * width.relative, fx * width.absolute)),
      addUDim(subtractUDim(y, parentHeightDim), uDim(fy * height.relative, fy * height.absolute)),
      width,
      height,
    );
  }

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
    if (node.resources?.[slot.key] && !bindingReference(node, slot.key, scene, assetReferences)) {
      errors.push(`节点「${node.name}」的资源槽位「${slot.key}」没有可用工程资源`);
    }
    const reference = bindingReference(node, slot.key, scene, assetReferences);
    if (reference) addProperty(properties, slot.key, reference);
  }

  if (type === "StaticImage" && !node.resources?.ImageName) {
    const reference = imageReference(node, scene, assetReferences);
    if (!reference && node.image) errors.push(`节点「${node.name}」的图片尚未生成工程资源`);
    addProperty(properties, "ImageName", reference);
  }
  const nineSliceGroup = marginsForNode(node, scene);
  if (nineSliceGroup) {
    addProperty(properties, "StretchType", "NineGrid");
    addProperty(properties, "StretchOffset", nineSliceOffset(nineSliceGroup));
  }
  if (node.text) {
    const text = node.text;
    const font = mapToEngineFont(text.fontSize);
    addProperty(properties, "Text", text.content);
    addProperty(properties, "Font", font.name);
    addProperty(properties, "TextHorzAlignment", text.horizontalAlign === "left" ? "Left" : text.horizontalAlign === "right" ? "Right" : "Centre");
    addProperty(properties, "TextVertAlignment", text.verticalAlign === "top" ? "Top" : text.verticalAlign === "bottom" ? "Bottom" : "Centre");
    addProperty(properties, "TextColor", text.textColor ?? text.color);
    addProperty(properties, "TextWordWrap", String(text.wordWrap ?? false));
    addProperty(properties, "TextSelfAdaptHigh", String(text.selfAdaptHeight ?? false));
    addProperty(properties, "TextShadow", String(text.shadow ?? false));
    if (text.shadow) {
      addProperty(properties, "TextShadowColor", text.shadowColor ?? "#000000");
      warnings.push(`节点「${node.name}」的投影距离由引擎固定，已保留投影开关和颜色`);
    }
    addProperty(properties, "TextBorder", String(text.border ?? false));
    if (text.border) {
      addProperty(properties, "TextBorderColor", text.borderColor ?? "#000000");
      warnings.push(`节点「${node.name}」的描边粗细由引擎固定，已保留描边开关和颜色`);
    }
    addProperty(properties, "TextScale", number(text.scale ?? 1));
    addProperty(properties, "TextLineExtraSpace", number(text.lineExtraSpace ?? 0));
    addProperty(properties, "TextAutoOmission", String(text.autoOmission ?? false));
    if (font.clamped) {
      warnings.push(`节点「${node.name}」的字号 ${String(text.fontSize)} 超出引擎范围，已映射为 ${font.name}`);
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

  const assetPaths = collectEngineAssetPaths(layoutScene.nodes);
  for (const group of layoutScene.nineSliceGroups ?? []) {
    if (group.sourceAssetPath) assetPaths.add(group.sourceAssetPath.replace(/\\/g, "/"));
    if (group.generatedAssetPath) assetPaths.add(group.generatedAssetPath.replace(/\\/g, "/"));
  }
  const manifest = createEngineAssetManifest(assetPaths, options.atlasName ?? "ui-project");
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
