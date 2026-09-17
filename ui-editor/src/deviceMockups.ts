import type { DeviceShell } from "./devicePreview";

export interface DeviceCutout {
  /** 沿屏幕短边的长度（px）。 */
  width: number;
  /** 垂直短边的厚度（px）。 */
  height: number;
  /** 圆角（px）；0 表示由 CSS 用 50% / 999px 处理（圆形、胶囊或水滴弧）。 */
  radius: number;
  /** 距屏幕顶边（px）。 */
  offsetTop: number;
  /** 贴屏幕右边缘定位时距右边的距离（px）；顶部居中时为 null。 */
  offsetRight: number | null;
  /** 刘海两侧与屏幕边缘过渡的内凹圆角尺寸（px），其他形态为 0。 */
  ear: number;
}

export interface DeviceShellMetrics {
  /** 机身横向 / 纵向厚度（px，作用于预览渲染尺寸）。 */
  bezelX: number;
  bezelY: number;
  /** 机身外圆角与屏幕内圆角（px）。 */
  outerRadius: number;
  screenRadius: number;
  /** 统一缩放单位 = 屏幕短边（px），供挖孔、侧键等细节按比例取值。 */
  unit: number;
  cutout: DeviceCutout | null;
}

/** 由 CSS 绘制的移动端壳；桌面 / 平板 / 超宽壳沿用基础边框样式。 */
const CSS_SHELLS: ReadonlySet<DeviceShell> = new Set<DeviceShell>([
  "waterdrop", "notch", "pill", "punch-hole", "island", "fullscreen",
]);

// 机身比例采用通用手机外壳比例基准：bezel 横向 8px / 屏幕宽 110，纵向 10px / 屏高 232，
// 机身圆角 17px / 机身宽 126，屏幕圆角 14px / 屏宽 110。
const BEZEL_X_RATIO = 8 / 110;
const BEZEL_Y_RATIO = 10 / 232;
const OUTER_RADIUS_RATIO = 17 / 126;
const SCREEN_RADIUS_RATIO = 14 / 110;

const BEZEL_MIN = 7;
const BEZEL_MAX = 34;
const RADIUS_MIN = 10;
const OUTER_RADIUS_MAX = 54;
// 机身圆角始终包住屏幕圆角，上限留出差值，避免放大后两者相等。
const SCREEN_RADIUS_MAX = 44;

// 挖孔几何：宽 / 高 / 圆角 / 距边 / 内凹角全部以屏幕短边为基准，任意预览尺寸下形状不变形。
// 数据来自 picturepan2/devices.css（MIT）与 LineageOS 设备树里 AOSP 的 config_mainBuiltInDisplayCutout，
// 均按原始 px 除以该机屏幕宽度换算成「相对屏幕宽度」的比例：
//
//   iPhone X      刘海 204×30     @375  屏，底部圆角 20，两侧内凹角 10、听筒 50×6、镜头 ⌀10
//                 https://raw.githubusercontent.com/picturepan2/devices.css/master/src/_iphone-x.scss
//   iPhone 14 Pro 灵动岛 120×35   @390  屏，圆角 20，距屏幕顶 9
//                 https://raw.githubusercontent.com/picturepan2/devices.css/master/src/_iphone-14-pro.scss
//   三星 Note 10  打孔 ⌀72        @1080 屏，AOSP cutout 框 72×90、孔居中于框内（距顶 9）
//                 M 0,0 H -36 V 90 H 36 V 0 H 0 Z            （居中，贴屏幕顶）
//   一加 6T/7     水滴 170×79     @1080 屏，取 AOSP 的 RectApproximation（最接近视觉外观）
//                 M -85,0 V 79 H 85 V 0 Z                    （顶部居中，贴屏幕顶）
//   三星 S10+     药丸 326×142    @1440 屏，贴屏幕右上角（AOSP path 带 @right）
//                 M 0,0 H -326 V 142 H 0 V 0 Z @right
//
// 注意：AOSP 的 cutout 是「系统不可用区」，厂商常填安全区矩形而非视觉形状（如一加 8 的
// 164×123 覆盖整个状态栏左侧，真机孔只有 ~4%）。这里只采用有视觉语义的定义：一加 6T 的
// RectApproximation 明确标注「应尽量匹配视觉外观」，三星两项是纯矩形，形状靠 CSS 补圆角。
const CUTOUT_SPECS: Partial<Record<DeviceShell, { width: number; height: number; radius: number; top: number; right: number | null; ear: number }>> = {
  notch: { width: 0.544, height: 0.08, radius: 0.0533, top: 0, right: null, ear: 0.0267 },
  island: { width: 0.308, height: 0.09, radius: 0.0513, top: 0.023, right: null, ear: 0 },
  "punch-hole": { width: 0.0667, height: 0.0667, radius: 0, top: 0.0083, right: null, ear: 0 },
  // 水滴与药丸的形状统一为「黑色圆角矩形」，圆角比例与灵动岛一致（同一套视觉语言）
  waterdrop: { width: 0.1574, height: 0.0731, radius: 0.0513, top: 0, right: null, ear: 0 },
  pill: { width: 0.2264, height: 0.0986, radius: 0.0513, top: 0, right: 0, ear: 0 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isCssDeviceShell(shell: DeviceShell): boolean {
  return CSS_SHELLS.has(shell);
}

/**
 * 按画布渲染尺寸推算纯 CSS 机身的厚度、圆角与挖孔几何，让外壳随预览等比缩放，
 * 而不是固定像素在放大时显得过薄、缩小时显得过厚。
 */
export function deviceMockupMetrics(
  shell: DeviceShell,
  width: number,
  height: number,
): DeviceShellMetrics | null {
  if (!isCssDeviceShell(shell) || width <= 0 || height <= 0) return null;
  const shortSide = Math.min(width, height);
  const spec = CUTOUT_SPECS[shell];
  return {
    bezelX: clamp(width * BEZEL_X_RATIO, BEZEL_MIN, BEZEL_MAX),
    bezelY: clamp(height * BEZEL_Y_RATIO, BEZEL_MIN, BEZEL_MAX),
    outerRadius: clamp(shortSide * OUTER_RADIUS_RATIO, RADIUS_MIN, OUTER_RADIUS_MAX),
    screenRadius: clamp(shortSide * SCREEN_RADIUS_RATIO, RADIUS_MIN, SCREEN_RADIUS_MAX),
    unit: shortSide,
    cutout: spec
      ? {
        width: spec.width * shortSide,
        height: spec.height * shortSide,
        radius: spec.radius * shortSide,
        offsetTop: spec.top * shortSide,
        offsetRight: spec.right === null ? null : spec.right * shortSide,
        ear: spec.ear * shortSide,
      }
      : null,
  };
}
