import type { CtrlType, UINode } from "./types";

const CONTROL_NAME_PREFIXES: Partial<Record<CtrlType, string>> = {
  Layout: "layout_",
  Button: "btn_",
  CheckBox: "chk_",
  RadioButton: "radio_",
  Edit: "edit_",
  StaticImage: "img_",
  StaticText: "txt_",
  ProgressBar: "pbar_",
  Slider: "slider_",
  List: "vlist_",
  ListHorizontal: "hlist_",
  GridView: "grid_",
  empty: "node_",
};

const CONTROL_TYPE_NAMES: Partial<Record<CtrlType, string>> = {
  Layout: "布局",
  Button: "按钮",
  CheckBox: "复选框",
  RadioButton: "单选框",
  Edit: "输入框",
  StaticImage: "静态图片",
  StaticText: "静态文本",
  ProgressBar: "进度条",
  Slider: "滑动条",
  List: "列表",
  ListHorizontal: "横向列表",
  GridView: "网格",
  empty: "空节点",
};

const LEGACY_CONTROL_NAME_PREFIXES = ["check_", "input_", "list_", "text_"];

/** 返回控件类型对应的自动命名前缀；未知类型统一回退到 node_。 */
export function controlNamePrefix(type: CtrlType | string | null | undefined): string {
  return CONTROL_NAME_PREFIXES[type as CtrlType] ?? "node_";
}

/** PSD/UI2HTML 整理阶段使用的中文控件名称。 */
export function controlTypeName(type: CtrlType): string {
  return CONTROL_TYPE_NAMES[type] ?? "节点";
}

/** T 快捷键使用：一次生成中文整理名称，并避开同父级重名。 */
export function quickControlName(node: UINode, type: CtrlType, siblings: UINode[]): string {
  const base = controlTypeName(type);
  const current = node.name.trim();
  if (current === base || current.startsWith(`${base}_`)) return current;
  const occupied = new Set(siblings.filter((item) => item.id !== node.id).map((item) => item.name));
  if (!occupied.has(base)) return base;
  let index = 2;
  while (occupied.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}

/** 在同一父节点的名称集合中生成最小可用的自动名称。 */
export function autoControlName(type: CtrlType | string | null | undefined, siblings: UINode[]): string {
  const prefix = controlNamePrefix(type);
  const occupied = new Set(siblings.map((node) => node.name));
  if (!occupied.has(prefix)) return prefix;
  let index = 1;
  while (occupied.has(`${prefix}${index}_`)) index++;
  return `${prefix}${index}_`;
}

/** 手动切换类型时只替换结构前缀，保留 AI/本地/手动确定的语义后缀。 */
export function renameControlForType(node: UINode, type: CtrlType, siblings: UINode[]): string {
  const prefix = controlNamePrefix(type);
  const recordedSuffix = node.naming?.suffix?.trim().replace(/^_+|_+$/g, "") ?? "";
  const knownPrefixes = [...new Set([...Object.values(CONTROL_NAME_PREFIXES), ...LEGACY_CONTROL_NAME_PREFIXES])]
    .sort((a, b) => b.length - a.length);
  const existingPrefix = knownPrefixes.find((candidate) => node.name.toLowerCase().startsWith(candidate));
  const inferredSuffix = existingPrefix ? node.name.slice(existingPrefix.length).replace(/^_+|_+$/g, "") : "";
  const suffix = recordedSuffix || inferredSuffix;
  if (!suffix) return autoControlName(type, siblings);

  const base = `${prefix}${suffix}`;
  const occupied = new Set(siblings.map((item) => item.name));
  if (!occupied.has(base)) return base;
  let index = 2;
  while (occupied.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}
