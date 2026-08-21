// 数据模型：UIScene 是系统数据核心（UIScene → LayoutEngine → Renderer）

export interface UIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutMode = "anchor" | "scale" | "stretch";

export type ListType = "horizontal" | "vertical" | "grid";

export interface ListConfig {
  type: ListType;
  /** 项间距（设计像素） */
  spacing: number;
  /** 容器内边距（设计像素） */
  padding: { left: number; right: number; top: number; bottom: number };
  /** grid 列数 */
  columns: number;
}

export type TextMode = "auto" | "fixed" | "fit";

/** 控件类型标签 */
export type CtrlType =
  | "empty" | "button" | "image" | "text" | "panel"
  | "list" | "listitem" | "progress" | "slider" | "scrollbar" | "input";

export const CTRL_TYPES: { value: CtrlType; label: string }[] = [
  { value: "empty", label: "空节点" },
  { value: "button", label: "按钮" },
  { value: "image", label: "图片" },
  { value: "text", label: "文本" },
  { value: "panel", label: "面板" },
  { value: "list", label: "列表" },
  { value: "listitem", label: "列表项" },
  { value: "progress", label: "进度条" },
  { value: "slider", label: "滑动条" },
  { value: "scrollbar", label: "滚动条" },
  { value: "input", label: "输入框" },
];

/** 交互样式模板（可交互控件引用，改模板批量生效） */
export interface InteractionTemplate {
  id: string;
  name: string;
  /** 点击时缩放比（0.95 = 缩小 5%） */
  pressScale: number;
  /** 点击时透明度 */
  pressOpacity: number;
  /** 点击高亮叠加色（#rrggbbaa），null = 不高亮 */
  pressTint: string | null;
  /** 动画时长（秒） */
  duration: number;
}

export interface UINode {
  id: string;
  name: string;
  image: HTMLCanvasElement | null;
  /** 文本节点内容（image 为 null 时按文本绘制） */
  text?: {
    content: string;
    fontSize: number;
    color: string;
    font?: string;
    /** auto=单行随内容延伸；fixed=固定框内换行+裁切；fit=固定框内字号自适应 */
    mode: TextMode;
    /** fit 模式最小字号 */
    minFontSize: number;
  };
  /** 组节点（PSD 文件夹）：子节点相对该组定位，自身不绘制 */
  children?: UINode[];
  /** list 节点（文件夹名为 list）：li 按类型重排、容器尺寸自适应 */
  list?: ListConfig;
  /** 九宫格边距（设计像素，相对图片原尺寸）；有值时按九宫格渲染 */
  slice?: { left: number; top: number; right: number; bottom: number };
  /** 九宫格替换图（来自 "9" 文件夹的同名图片） */
  sliceImage?: HTMLCanvasElement | null;
  /** 控件类型标签 + 交互模板引用 */
  ctrl?: { type: CtrlType; templateId?: string };

  /** PSD 导入时的原始布局（只在导入时写入，编辑不改它） */
  designRect: UIRect;

  anchor: {
    parentX: number; // 0..1，父容器横向位置
    parentY: number; // 0..1
    selfX: number;   // 0..1，节点自身定位点
    selfY: number;
    offsetX: number; // 相对 Parent Anchor 的偏移（绝对像素，Top-Left 坐标）
    offsetY: number;
    safeArea: boolean; // true = 锚点绑定 Safe Area 而非整个 Viewport
  };

  scale: { x: number; y: number };
  rotation: number;
  opacity: number; // 0..1
  visible: boolean;
  zIndex: number; // 越大越靠上

  adaptation: { mode: LayoutMode };

  psd: {
    layerId: number;
    originalX: number;
    originalY: number;
    originalWidth: number;
    originalHeight: number;
  };

  locked?: boolean;
}

export interface UIScene {
  designWidth: number;
  designHeight: number;
  nodes: UINode[];
  /** "9" 文件夹内的图片（九宫格替换源），不进场景布局 */
  sliceSources?: { name: string; canvas: HTMLCanvasElement }[];
  /** 交互样式模板（控件工作区管理） */
  interactionTemplates?: InteractionTemplate[];
}

export type ScaleMode = "contain" | "width" | "height" | "fill" | "cover";

export interface LayoutContext {
  designWidth: number;
  designHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  safeArea: { left: number; right: number; top: number; bottom: number };
  scaleMode: ScaleMode; // 整体缩放策略：contain | 按宽度 | 按高度 | fill
}

export interface LayoutResultNode {
  node: UINode;
  rect: UIRect;
  /** 组内子节点的父组矩形（用于锚点参照 / reanchor） */
  parent?: UIRect;
  /** 有效可见性（组不可见时其后代也为 false） */
  visible: boolean;
  /** 有效透明度（父组透明度 × 自身透明度，累乘） */
  opacity: number;
  /** 所属 list 容器的矩形：超出部分渲染时裁切 */
  clipRect?: UIRect;
}

export interface LayoutResult {
  nodes: LayoutResultNode[];
  scaleX: number;
  scaleY: number;
  letterbox: { x: number; y: number }; // 容器内居中偏移
}
