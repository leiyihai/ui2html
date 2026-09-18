import type { CtrlType, UINode } from "./types";

const CONTROL_NAME_PREFIXES: Partial<Record<CtrlType, string>> = {
  Layout: "lyt_",
  Button: "btn_",
  CheckBox: "chk_",
  RadioButton: "rdo_",
  Edit: "edt_",
  StaticImage: "img_",
  StaticText: "txt_",
  ProgressBar: "pbr_",
  Slider: "sld_",
  List: "vls_",
  ListHorizontal: "hls_",
  GridView: "grd_",
  empty: "nod_",
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

/** 只用于从已有名称中剥离错误/旧前缀，输出时永远使用 CONTROL_NAME_PREFIXES。 */
const KNOWN_CONTROL_NAME_PREFIXES = [
  ...Object.values(CONTROL_NAME_PREFIXES),
  "layout_", "button_", "checkbox_", "radio_", "edit_", "image_", "text_",
  "staticimage_", "statictext_", "progress_", "pbar_", "slider_", "vlist_", "hlist_",
  "grid_", "node_", "check_", "input_", "list_",
];

/** 返回控件类型对应的自动命名前缀；未知类型统一回退到 node_。 */
export function controlNamePrefix(type: CtrlType | string | null | undefined): string {
  return CONTROL_NAME_PREFIXES[type as CtrlType] ?? "nod_";
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

function semanticSuffixFromName(name: string): string {
  const normalized = name.trim();
  const knownPrefixes = [...new Set(KNOWN_CONTROL_NAME_PREFIXES)].sort((a, b) => b.length - a.length);
  const knownPrefix = knownPrefixes.find((candidate) => normalized.toLowerCase().startsWith(candidate));
  if (knownPrefix) return normalized.slice(knownPrefix.length).replace(/^_+/, "");

  // 未知但明显符合“前缀_语义后缀”的名称，也替换掉第一段前缀，避免生成 btn_wrong_prefix_name。
  const genericPrefix = normalized.match(/^[a-z][a-z0-9]{1,15}_(.+)$/i);
  return genericPrefix?.[1] ?? "";
}

/** 手动切换类型时只替换结构前缀，保留 AI/本地/手动确定的语义后缀。 */
export function renameControlForType(node: UINode, type: CtrlType, siblings: UINode[]): string {
  const prefix = controlNamePrefix(type);
  const recordedSuffix = node.naming?.suffix?.trim().replace(/^_+|_+$/g, "") ?? "";
  const inferredSuffix = semanticSuffixFromName(node.name);
  const suffix = recordedSuffix || inferredSuffix;
  if (!suffix) return autoControlName(type, siblings);

  const base = `${prefix}${suffix}`;
  const occupied = new Set(siblings.map((item) => item.name));
  if (!occupied.has(base)) return base;
  let index = 2;
  while (occupied.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}

/**
 * T 类型转换同时维护两套显示名称：PSD 名称用于美术整理，工程名称用于导出。
 * 已存在的 AI/手动语义后缀只进入工程名称；新打组等没有后缀的节点保留空前缀，
 * 方便用户随后按 F2 补充。
 */
export function typeConversionNames(node: UINode, type: CtrlType, siblings: UINode[]): {
  originalName: string;
  projectName: string;
} {
  const originalNode = { ...node, name: node.originalName ?? node.name };
  const originalSiblings = siblings.map((sibling) => ({
    ...sibling,
    name: sibling.originalName ?? sibling.name,
  }));
  return {
    originalName: quickControlName(originalNode, type, originalSiblings),
    projectName: renameControlForType(node, type, siblings.filter((sibling) => sibling.id !== node.id)),
  };
}
