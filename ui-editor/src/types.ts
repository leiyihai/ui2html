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
}

export interface LayoutResult {
  nodes: LayoutResultNode[];
  scaleX: number;
  scaleY: number;
  letterbox: { x: number; y: number }; // 容器内居中偏移
}
