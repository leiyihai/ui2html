import type { ImageBinding, InteractionTemplate, ResourceSlot, ScaleMode, UIScene, UINode } from "./types";

/** 独立 UI 工程格式。版本 3 起不再保存 PSD 图层身份或依赖 PSD 重新挂载图片。 */
export const SCENE_PERSISTENCE_VERSION = 3;

export interface SavedImageBinding {
  id: string;
  name: string;
  sourceParentId: string | null;
  sourceIndex: number;
  sourceNode: SavedNode;
}

/** 不包含 Canvas、PSD 来源和撤销历史的可序列化节点。 */
export interface SavedNode {
  id: string;
  name: string;
  assetPath?: string;
  text?: UINode["text"];
  children?: SavedNode[];
  list?: UINode["list"];
  ctrl?: UINode["ctrl"];
  resources?: Partial<Record<ResourceSlot, SavedImageBinding>>;
  designRect: UINode["designRect"];
  anchor: UINode["anchor"];
  scale: UINode["scale"];
  rotation: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  adaptation: UINode["adaptation"];
  locked?: boolean;
}

export interface SavedProjectView {
  viewport: { width: number; height: number };
  safeArea: { left: number; right: number; top: number; bottom: number };
  scaleMode: ScaleMode;
  showSafeArea: boolean;
  showDesignBorder: boolean;
}

export interface SavedScene {
  schemaVersion: typeof SCENE_PERSISTENCE_VERSION;
  designWidth: number;
  designHeight: number;
  nodes: SavedNode[];
  templates: InteractionTemplate[];
  view: SavedProjectView;
}

function serializeNode(node: UINode, includeResources = true): SavedNode {
  const saved: SavedNode = {
    id: node.id,
    name: node.name,
    ...(node.assetPath ? { assetPath: node.assetPath } : {}),
    ...(node.text ? { text: { ...node.text } } : {}),
    ...(node.children ? { children: node.children.map((child) => serializeNode(child)) } : {}),
    ...(node.list ? { list: { ...node.list, padding: { ...node.list.padding } } } : {}),
    ...(node.ctrl ? { ctrl: { ...node.ctrl } } : {}),
    designRect: { ...node.designRect },
    anchor: { ...node.anchor },
    scale: { ...node.scale },
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    zIndex: node.zIndex,
    adaptation: { ...node.adaptation },
    ...(node.locked !== undefined ? { locked: node.locked } : {}),
  };

  if (includeResources && node.resources) {
    const resources = Object.entries(node.resources).flatMap(([slot, binding]) => {
      if (!binding) return [];
      return [[slot, {
        id: binding.id,
        name: binding.name,
        sourceParentId: binding.sourceParentId,
        sourceIndex: binding.sourceIndex,
        sourceNode: serializeNode(binding.sourceNode, false),
      }] as const];
    });
    if (resources.length) saved.resources = Object.fromEntries(resources) as SavedNode["resources"];
  }
  return saved;
}

export function defaultProjectView(width: number, height: number): SavedProjectView {
  return {
    viewport: { width, height },
    safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
    scaleMode: "cover",
    showSafeArea: false,
    showDesignBorder: true,
  };
}

/** 将当前场景转换为完全独立于 PSD 的工程快照。 */
export function serializeScene(scene: UIScene, view: SavedProjectView = defaultProjectView(scene.designWidth, scene.designHeight)): SavedScene {
  return {
    schemaVersion: SCENE_PERSISTENCE_VERSION,
    designWidth: scene.designWidth,
    designHeight: scene.designHeight,
    nodes: scene.nodes.map((node) => serializeNode(node)),
    templates: scene.interactionTemplates ?? [],
    view,
  };
}

let restoredLayerId = -1;

function hydrateNode(saved: SavedNode, assets: Map<string, HTMLCanvasElement>, missing: string[]): UINode {
  const image = saved.assetPath ? assets.get(saved.assetPath) ?? null : null;
  if (saved.assetPath && !image) missing.push(saved.assetPath);

  const resources = Object.entries(saved.resources ?? {}).flatMap(([slot, binding]) => {
    if (!binding) return [];
    const sourceNode = hydrateNode(binding.sourceNode, assets, missing);
    if (!sourceNode.image) return [];
    const restored: ImageBinding = {
      id: binding.id,
      name: binding.name,
      image: sourceNode.image,
      sourceNode,
      sourceParentId: binding.sourceParentId,
      sourceIndex: binding.sourceIndex,
    };
    return [[slot, restored] as const];
  });

  return {
    id: saved.id,
    name: saved.name,
    image,
    ...(saved.assetPath ? { assetPath: saved.assetPath } : {}),
    ...(saved.text ? { text: { ...saved.text } } : {}),
    ...(saved.children ? { children: saved.children.map((child) => hydrateNode(child, assets, missing)) } : {}),
    ...(saved.list ? { list: { ...saved.list, padding: { ...saved.list.padding } } } : {}),
    ...(saved.ctrl ? { ctrl: { ...saved.ctrl } } : {}),
    ...(resources.length ? { resources: Object.fromEntries(resources) as UINode["resources"] } : {}),
    designRect: { ...saved.designRect },
    anchor: { ...saved.anchor },
    scale: { ...saved.scale },
    rotation: saved.rotation,
    opacity: saved.opacity,
    visible: saved.visible,
    zIndex: saved.zIndex,
    adaptation: { ...saved.adaptation },
    psd: {
      layerId: restoredLayerId--,
      originalX: saved.designRect.x,
      originalY: saved.designRect.y,
      originalWidth: saved.designRect.width,
      originalHeight: saved.designRect.height,
    },
    ...(saved.locked !== undefined ? { locked: saved.locked } : {}),
  };
}

/** 从 `.ui.json` 和同名 `.assets` 中恢复场景。 */
export function restoreSceneSnapshot(saved: SavedScene, assets: Map<string, HTMLCanvasElement>): { scene: UIScene; missingAssets: string[] } {
  if (saved.schemaVersion !== SCENE_PERSISTENCE_VERSION) {
    throw new Error(`不支持的工程版本：${String(saved.schemaVersion)}，当前版本为 ${SCENE_PERSISTENCE_VERSION}`);
  }
  const missingAssets: string[] = [];
  return {
    scene: {
      designWidth: saved.designWidth,
      designHeight: saved.designHeight,
      nodes: saved.nodes.map((node) => hydrateNode(node, assets, missingAssets)),
      interactionTemplates: saved.templates ?? [],
      sliceSources: [],
    },
    missingAssets: [...new Set(missingAssets)],
  };
}

/** 服务端与测试使用：列出工程中实际引用的资源相对路径。 */
export function collectSavedAssetPaths(saved: SavedScene): string[] {
  const paths = new Set<string>();
  const visit = (nodes: SavedNode[]) => {
    for (const node of nodes) {
      if (node.assetPath) paths.add(node.assetPath);
      if (node.children) visit(node.children);
      for (const binding of Object.values(node.resources ?? {})) {
        if (binding?.sourceNode) visit([binding.sourceNode]);
      }
    }
  };
  visit(saved.nodes);
  return [...paths];
}
