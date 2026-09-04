import type { CtrlType, UINode } from "./types";

const CONTROL_NAME_PREFIXES: Partial<Record<CtrlType, string>> = {
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

/** 返回控件类型对应的自动命名前缀；未知类型统一回退到 node_。 */
export function controlNamePrefix(type: CtrlType | string | null | undefined): string {
  return CONTROL_NAME_PREFIXES[type as CtrlType] ?? "node_";
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
