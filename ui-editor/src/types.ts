// 数据模型：UIScene 是系统数据核心（UIScene → LayoutEngine → Renderer）

export interface UIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutMode = "anchor" | "scale" | "stretch";

export interface UINode {
  id: string;
  name: string;
  image: HTMLCanvasElement | null;

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
}

export interface LayoutResult {
  nodes: LayoutResultNode[];
  scaleX: number;
  scaleY: number;
  letterbox: { x: number; y: number }; // 容器内居中偏移
}
