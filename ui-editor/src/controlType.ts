import type { CtrlType, UINode } from "./types";
import { ENGINE_EDITOR_FONT_FAMILY, normalizeEditorFontSize } from "./engineFont";
import { defaultProgressConfig } from "./progressControl";

const LIST_TYPES: Partial<Record<CtrlType, "vertical" | "horizontal" | "grid">> = {
  List: "vertical",
  ListHorizontal: "horizontal",
  GridView: "grid",
};

/** PSD 文件夹导入后的控件类型：根文件夹固定为空 Layout，其余中文类型名可直接标记。 */
export function defaultFolderCtrlType(name?: string, isRoot = false): CtrlType {
  if (isRoot) return "Layout";
  const normalized = (name ?? "").trim().toLowerCase();
  const mappings: Array<[string[], CtrlType]> = [
    [["按钮", "button"], "Button"],
    [["复选框", "checkbox", "check_box"], "CheckBox"],
    [["输入框", "编辑框", "edit", "input"], "Edit"],
    [["网格", "网格视图", "grid", "gridview"], "GridView"],
    [["列表", "list"], "List"],
    [["横向列表", "水平列表", "hlist", "listhorizontal"], "ListHorizontal"],
    [["进度条", "progress", "progressbar"], "ProgressBar"],
    [["单选框", "单选按钮", "radiobutton", "radio"], "RadioButton"],
    [["滑块", "滑动条", "slider"], "Slider"],
    [["静态图片", "图片", "image", "staticimage"], "StaticImage"],
    [["静态文本", "文本", "文字", "text", "statictext"], "StaticText"],
  ];
  return mappings.find(([aliases]) => aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias}_`)))?.[1] ?? "Layout";
}

/** Edit 控件默认显示文本；旧工程缺少该字段时属性面板也使用同一默认值。 */
export function createDefaultEditText(): NonNullable<UINode["text"]> {
  return {
    content: "",
    fontSize: normalizeEditorFontSize(20),
    color: "#ffffff",
    font: ENGINE_EDITOR_FONT_FAMILY,
    mode: "fixed",
    minFontSize: 12,
  };
}

/** 应用控件类型标记，并清理与目标类型冲突的结构配置。 */
export function markControlType(node: UINode, type: CtrlType | null): UINode {
  const hasChildren = Boolean(node.children?.length);
  const isContainer = type === "Layout";

  // 图片节点转为 Layout 时，把原图片变成 Layout 的图片子节点，避免素材丢失。
  if (isContainer && node.image && !hasChildren) {
    const imageChild: UINode = {
      ...node,
      id: `${node.id}-image`,
      name: `${node.name} Image`,
      image: node.image,
      children: undefined,
      ctrl: { type: "StaticImage" },
      list: undefined,
      anchor: { ...node.anchor, parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      adaptation: { mode: "anchor" },
      designRect: { x: 0, y: 0, width: node.designRect.width, height: node.designRect.height },
      psd: { ...node.psd },
    };
    return {
      ...node,
      image: null,
      children: [imageChild],
      ctrl: { type },
      list: undefined,
      slice: undefined,
      sliceImage: undefined,
    };
  }

  const templateId = type === "Button" || type === "CheckBox" ? node.ctrl?.templateId : undefined;
  const marked: UINode = {
    ...node,
    ctrl: type ? { type, ...(templateId ? { templateId } : {}) } : undefined,
  };
  if (type === "Edit" && !marked.text) marked.text = createDefaultEditText();
  const listType = type ? LIST_TYPES[type] : undefined;
  if (listType) {
    marked.list = node.list ?? {
      type: listType,
      spacing: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      columns: 3,
    };
    marked.list = { ...marked.list, type: listType };
  } else {
    marked.list = undefined;
  }
  if (type === "ProgressBar" || type === "Slider") {
    marked.progress = node.progress ? { ...node.progress } : defaultProgressConfig(node);
  } else {
    marked.progress = undefined;
  }
  return marked;
}
