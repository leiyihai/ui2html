import type { CtrlType, ImageBinding, ResourceSlot, UINode } from "./types";

export interface ResourceSlotDefinition {
  key: ResourceSlot;
  label: string;
  aliases: string[];
}

const definitions: Partial<Record<CtrlType, ResourceSlotDefinition[]>> = {
  Layout: [{ key: "LayoutBackImage", label: "布局底图", aliases: ["layout back image", "layoutbackimage", "background", "back"] }],
  StaticImage: [{ key: "ImageName", label: "图片资源", aliases: ["imagename", "image", "icon", "sprite", "pic"] }],
  Button: [
    { key: "NormalImage", label: "普通状态", aliases: ["normalimage", "normal", "default", "idle", "off"] },
    { key: "PushedImage", label: "按下状态", aliases: ["pushedimage", "pushed", "pressed", "selected", "checked", "on"] },
  ],
  CheckBox: [
    { key: "NormalImage", label: "未选中", aliases: ["normalimage", "normal", "default", "idle", "off"] },
    { key: "PushedImage", label: "已选中", aliases: ["pushedimage", "pushed", "pressed", "selected", "checked", "on"] },
  ],
  RadioButton: [
    { key: "NormalImage", label: "未选中", aliases: ["normalimage", "normal", "default", "idle", "off"] },
    { key: "PushedImage", label: "已选中", aliases: ["pushedimage", "pushed", "pressed", "selected", "checked", "on"] },
  ],
  ProgressBar: [
    { key: "ProgressBackImage", label: "进度背景", aliases: ["progressbackimage", "progress back", "background", "back"] },
    { key: "ProgressImage", label: "进度图片", aliases: ["progressimage", "progress", "fill", "foreground", "value"] },
    { key: "ProgressHeaderImage", label: "进度头", aliases: ["progressheaderimage", "progress header", "header", "thumb", "handle"] },
  ],
  Slider: [
    { key: "ProgressBackImage", label: "滑动背景", aliases: ["progressbackimage", "progress back", "background", "back"] },
    { key: "ProgressImage", label: "进度图片", aliases: ["progressimage", "progress", "fill", "foreground", "value"] },
    { key: "ProgressHeaderImage", label: "滑块头", aliases: ["progressheaderimage", "progress header", "header", "thumb", "handle"] },
  ],
  Edit: [{ key: "EditBackImage", label: "输入框底图", aliases: ["editbackimage", "edit back", "background", "back", "input"] }],
};

export const resourceSlotDefinitions = (type?: CtrlType): ResourceSlotDefinition[] =>
  type ? definitions[type] ?? [] : [];

export const hasResourceSlots = (type?: CtrlType): boolean => resourceSlotDefinitions(type).length > 0;

function normalizeName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

/** 根据完整字段名和常见状态词匹配槽位；返回 null 表示按选择顺序兜底。 */
export function matchResourceSlot(name: string, slots: readonly ResourceSlotDefinition[]): ResourceSlot | null {
  const normalized = normalizeName(name).replace(/ /g, "");
  const words = new Set(normalizeName(name).split(" ").filter(Boolean));
  const exact = slots.find((slot) => slot.aliases.some((alias) => normalized === alias.replace(/ /g, "")));
  if (exact) return exact.key;
  const partial = slots.find((slot) => slot.aliases.some((alias) => {
    const aliasWords = normalizeName(alias).split(" ").filter(Boolean);
    return aliasWords.length === 1 ? words.has(aliasWords[0]) : aliasWords.every((word) => words.has(word));
  }));
  return partial?.key ?? null;
}

export interface ResourceBindingPlan {
  assignments: { slot: ResourceSlot; node: UINode }[];
  skipped: UINode[];
}

/** 按名称优先、选择顺序兜底，只规划空槽位，不修改节点。 */
export function planResourceBindings(
  type: CtrlType | undefined,
  nodes: readonly UINode[],
  existing: Partial<Record<ResourceSlot, ImageBinding>> = {},
): ResourceBindingPlan {
  const available = resourceSlotDefinitions(type)
    .filter((slot) => !existing[slot.key])
    .map((slot) => slot.key);
  const slots = resourceSlotDefinitions(type);
  const assignments: { slot: ResourceSlot; node: UINode }[] = [];
  const skipped: UINode[] = [];

  for (const node of nodes) {
    const named = matchResourceSlot(node.name, slots);
    const slot = named && available.includes(named) ? named : available[0];
    if (!slot) { skipped.push(node); continue; }
    assignments.push({ slot, node });
    available.splice(available.indexOf(slot), 1);
  }
  return { assignments, skipped };
}
