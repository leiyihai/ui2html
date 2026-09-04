import type { ImageBinding, UIScene, UINode } from "./types";

export interface PreparedProjectAssets {
  scene: UIScene;
  assets: Record<string, string>;
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

/**
 * 为场景中的所有图片分配稳定的 `.assets` 相对路径，并收集待写入的 PNG。
 * 相同像素内容自动复用同一个资源文件；不同内容永不覆盖同名资源。
 */
export function prepareSceneAssets(source: UIScene): PreparedProjectAssets {
  const scene: UIScene = {
    ...source,
    nodes: source.nodes.map(cloneNode),
    interactionTemplates: source.interactionTemplates?.map((template) => ({ ...template })),
    sliceSources: source.sliceSources,
  };
  const assets: Record<string, string> = {};
  const used = new Set<string>();
  const contentPaths = new Map<string, string>();

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
  return { scene, assets };
}
