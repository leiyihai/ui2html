import type { ImageBinding, UIScene, UINode } from "./types";
import { generateNineSliceImage } from "./nineSlice";
import { findSceneBackgroundNode } from "./sceneBackground";

export interface PreparedProjectAssets {
  scene: UIScene;
  assets: Record<string, string>;
}

export interface PrepareSceneAssetsOptions {
  /** 仅引擎导出包启用：场景级背景按比例缩小，工程文件仍保留原图。 */
  scaleSceneBackground?: boolean;
}

export function sanitizeAssetBase(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || "image";
}

function cloneNode(node: UINode): UINode {
  const resources = node.resources
    ? Object.fromEntries(Object.entries(node.resources).map(([slot, binding]) => {
      if (!binding) return [slot, binding];
      const sourceNode = cloneNode(binding.sourceNode);
      const cloned: ImageBinding = { ...binding, sourceNode, image: sourceNode.image ?? binding.image };
      return [slot, cloned];
    })) as UINode["resources"]
    : undefined;
  return {
    ...node,
    designRect: { ...node.designRect },
    ...(node.layout ? { layout: {
      x: { ...node.layout.x }, y: { ...node.layout.y },
      width: { ...node.layout.width }, height: { ...node.layout.height },
    } } : {}),
    anchor: { ...node.anchor },
    scale: { ...node.scale },
    adaptation: { ...node.adaptation },
    ...(node.text ? { text: { ...node.text } } : {}),
    ...(node.ctrl ? { ctrl: { ...node.ctrl } } : {}),
    ...(node.list ? { list: { ...node.list, padding: { ...node.list.padding } } } : {}),
    ...(node.slice ? { slice: { ...node.slice } } : {}),
    ...(node.children ? { children: node.children.map(cloneNode) } : {}),
    ...(resources ? { resources } : {}),
  };
}

function preferredAssetName(node: UINode): string {
  if (node.assetName) return `${sanitizeAssetBase(node.assetName)}.png`;
  if (node.assetPath) {
    const parts = node.assetPath.replace(/\\/g, "/").split("/");
    return `${sanitizeAssetBase(parts[parts.length - 1])}.png`;
  }
  return `${sanitizeAssetBase(node.name)}.png`;
}

function uniqueAssetName(preferred: string, used: Set<string>): string {
  const base = preferred.replace(/\.png$/i, "");
  let candidate = `${base}.png`;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${base}_${suffix++}.png`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function scaledImageDataUrl(image: HTMLCanvasElement, scale: number): string | null {
  if (typeof document === "undefined" || scale <= 0 || scale >= 1) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function findNode(nodes: UINode[], id: string): UINode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = node.children ? findNode(node.children, id) : null;
    if (nested) return nested;
    for (const binding of Object.values(node.resources ?? {})) {
      if (!binding) continue;
      const source = findNode([binding.sourceNode], id);
      if (source) return source;
    }
  }
  return null;
}

/**
 * 为场景中的所有图片分配稳定的 `.assets` 相对路径，并收集待写入的 PNG。
 * 相同像素内容自动复用同一个资源文件；不同内容永不覆盖同名资源。
 */
export function prepareSceneAssets(source: UIScene, options: PrepareSceneAssetsOptions = {}): PreparedProjectAssets {
  const scene: UIScene = {
    ...source,
    nodes: source.nodes.map(cloneNode),
    interactionTemplates: source.interactionTemplates?.map((template) => ({ ...template })),
    sliceSources: source.sliceSources,
    nineSliceCandidates: source.nineSliceCandidates?.map((candidate) => ({
      ...candidate,
      memberNodeIds: [...candidate.memberNodeIds],
      suggestedMargins: { ...candidate.suggestedMargins },
    })),
    nineSliceGroups: source.nineSliceGroups?.map((group) => ({
      ...group,
      memberNodeIds: [...group.memberNodeIds],
      margins: { ...group.margins },
    })),
    useNineSlicePreview: source.useNineSlicePreview ?? false,
  };
  const assets: Record<string, string> = {};
  const used = new Set<string>();
  const contentPaths = new Map<string, string>();
  const nineUsed = new Set<string>();
  const nineContentPaths = new Map<string, string>();
  const generatedContentPaths = new Map<string, string>();

  const reserveNinePath = (path: string) => {
    nineUsed.add(path.replace(/^9\//i, "").toLocaleLowerCase());
  };

  const visit = (node: UINode) => {
    if (node.image) {
      const dataUrl = node.image.toDataURL("image/png");
      const known = contentPaths.get(dataUrl);
      const assetPath = known ?? uniqueAssetName(preferredAssetName(node), used);
      node.assetPath = assetPath;
      if (!known) {
        contentPaths.set(dataUrl, assetPath);
        assets[assetPath] = dataUrl;
      }
    }
    node.children?.forEach(visit);
    for (const binding of Object.values(node.resources ?? {})) {
      if (!binding) continue;
      visit(binding.sourceNode);
      binding.image = binding.sourceNode.image ?? binding.image;
    }
  };
  scene.nodes.forEach(visit);

  // 场景氛围背景是唯一允许在引擎图集中缩小的普通图片。
  // 不改 scene 中的 Canvas，只替换引擎导出副本的 assetPath，避免 UI2HTML 工程预览变小。
  if (options.scaleSceneBackground) {
    const background = findSceneBackgroundNode(scene);
    const isNineSlice = background && (scene.nineSliceGroups ?? []).some((group) =>
      group.sourceNodeId === background.id || group.memberNodeIds.includes(background.id));
    if (background?.image && background.assetPath && !isNineSlice) {
      const originalPath = background.assetPath;
      const scaledData = scaledImageDataUrl(background.image, 0.5);
      if (scaledData) {
        const scaledPath = `background/${uniqueAssetName(preferredAssetName(background), used)}`;
        background.assetPath = scaledPath;
        assets[scaledPath] = scaledData;
        const referenced = new Set<string>();
        const collectReferences = (nodes: UINode[]) => nodes.forEach((node) => {
          if (node.assetPath) referenced.add(node.assetPath.replace(/\\/g, "/"));
          if (node.children) collectReferences(node.children);
          for (const binding of Object.values(node.resources ?? {})) if (binding) collectReferences([binding.sourceNode]);
        });
        collectReferences(scene.nodes);
        if (!referenced.has(originalPath.replace(/\\/g, "/"))) delete assets[originalPath];
      }
    }
  }

  // 九宫格源图始终作为 `.assets/9` 的独立副本保存，不替换普通资源。
  for (const group of scene.nineSliceGroups ?? []) {
    const sourceNode = findNode(scene.nodes, group.sourceNodeId);
    if (!sourceNode?.image) continue;
    const dataUrl = sourceNode.image.toDataURL("image/png");
    const existing = nineContentPaths.get(dataUrl);
    const preferred = group.sourceAssetPath ?? `9/${preferredAssetName(sourceNode)}`;
    const relative = existing ?? (group.sourceAssetPath ?? `9/${uniqueAssetName(preferred.replace(/^9\//, ""), nineUsed)}`);
    group.sourceAssetPath = relative.replace(/\\/g, "/");
    reserveNinePath(group.sourceAssetPath);
    nineContentPaths.set(dataUrl, group.sourceAssetPath);
    assets[group.sourceAssetPath] = dataUrl;
    const generated = generateNineSliceImage(sourceNode.image, group.margins);
    if (generated) {
      const generatedData = generated.toDataURL("image/png");
      const generatedPreferred = group.generatedAssetPath ?? `9/${sanitizeAssetBase(preferredAssetName(sourceNode).replace(/\.png$/i, ""))}.9.png`;
      const generatedPath = generatedContentPaths.get(generatedData)
        ?? group.generatedAssetPath
        ?? `9/${uniqueAssetName(generatedPreferred.replace(/^9\//, ""), nineUsed)}`;
      group.generatedAssetPath = generatedPath.replace(/\\/g, "/");
      generatedContentPaths.set(generatedData, group.generatedAssetPath);
      reserveNinePath(group.generatedAssetPath);
      assets[group.generatedAssetPath] = generatedData;
      for (const memberId of group.memberNodeIds) {
        const node = findNode(scene.nodes, memberId);
        if (node) node.sliceImage = generated;
      }
    }
    for (const memberId of group.memberNodeIds) {
      const node = findNode(scene.nodes, memberId);
      if (!node) continue;
      node.nineSliceGroupId = group.id;
      node.slice = { ...group.margins };
      node.sliceImage = generated ?? sourceNode.image;
    }
  }
  return { scene, assets };
}
