import type { LayoutResultNode, UINode, UIRect } from "./types";
import { hasResourceSlots, resourceSlotDefinitions, type ResourceSlotDefinition } from "./resourceBinding";

export interface ResourceBindingTarget {
  node: UINode;
  path: string[];
  slots: ResourceSlotDefinition[];
  images: UINode[];
}

/**
 * 节点在当前预览视口中的有效范围：先套用父级裁切，再裁到视口边界。
 * 卡片预览和右侧总览共用这条规则，避免一个节点出现两套位置含义。
 */
export function effectivePreviewRect(
  item: LayoutResultNode,
  viewport: { width: number; height: number },
): UIRect | null {
  const clip = item.clipRect;
  const left = Math.max(0, item.rect.x, clip?.x ?? 0);
  const top = Math.max(0, item.rect.y, clip?.y ?? 0);
  const right = Math.min(viewport.width, item.rect.x + item.rect.width, clip ? clip.x + clip.width : viewport.width);
  const bottom = Math.min(viewport.height, item.rect.y + item.rect.height, clip ? clip.y + clip.height : viewport.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function isBindingComplete(target: ResourceBindingTarget): boolean {
  // “完成”表示没有剩余图片可供用户绑定；资源槽位可以按实际需求留空。
  return target.node.resourceBindingComplete === true || target.images.length === 0;
}

export function orderResourceBindingTargets(targets: ResourceBindingTarget[]): ResourceBindingTarget[] {
  return targets
    .map((target, index) => ({ target, index, complete: isBindingComplete(target) }))
    .sort((a, b) => Number(a.complete) - Number(b.complete) || a.index - b.index)
    .map(({ target }) => target);
}

function isNestedBindingControl(node: UINode): boolean {
  const type = node.ctrl?.type;
  // 容器即使没有资源槽位，也不能让父级卡片继续收集其内部图片。
  // 否则 Layout 会把 List/GridView 内的图片误显示为自己的候选资源。
  return type === "Layout" || type === "List" || type === "ListHorizontal" || type === "GridView"
    || (type !== "StaticImage" && hasResourceSlots(type));
}

/**
 * 收集资源绑定工作区的扁平卡片。
 * 父控件只收集自己辖下、且不属于另一个可绑定控件的图片；
 * 因此嵌套 Layout/控件会自然拆成独立卡片。
 */
export function collectResourceBindingTargets(nodes: UINode[]): ResourceBindingTarget[] {
  const targets: ResourceBindingTarget[] = [];

  const collectImages = (node: UINode): UINode[] => {
    const images: UINode[] = [];
    for (const child of node.children ?? []) {
      if (child.image) {
        images.push(child);
      } else if (!isNestedBindingControl(child)) {
        images.push(...collectImages(child));
      }
    }
    return images;
  };

  const visit = (node: UINode, path: string[]) => {
    const slots = resourceSlotDefinitions(node.ctrl?.type);
    if (slots.length && node.ctrl?.type !== "StaticImage") {
      const images = collectImages(node);
      const hasBindings = slots.some((slot) => Boolean(node.resources?.[slot.key]));
      // 没有候选图片且没有既有绑定时，卡片没有可执行操作，直接隐藏。
      if (images.length || hasBindings) targets.push({ node, path: [...path, node.name], slots, images });
    }
    for (const child of node.children ?? []) visit(child, [...path, node.name]);
  };

  for (const node of nodes) visit(node, []);
  return targets;
}

export function imageDataUrl(node: UINode): string {
  return node.image?.toDataURL("image/png") ?? "";
}
