import type { ScaleMode } from "./types";

export type DeviceShell =
  | "desktop"
  | "tablet"
  | "ultrawide"
  | "notch"
  | "waterdrop"
  | "pill"
  | "punch-hole"
  | "island"
  | "fullscreen";

export type DevicePresetGroup = "手机" | "平板" | "桌面";

export interface DevicePreset {
  id: string;
  label: string;
  group: DevicePresetGroup;
  width: number;
  height: number;
  shell: DeviceShell;
}

export const PREVIEW_SCALE_MODES: ReadonlyArray<{ value: ScaleMode; label: string }> = [
  { value: "contain", label: "完整显示" },
  { value: "width", label: "按宽度" },
  { value: "height", label: "按高度" },
  { value: "cover", label: "等比铺满" },
  { value: "fill", label: "拉伸铺满" },
];

export function nextPreviewPreset(presets: DevicePreset[], currentId: string): DevicePreset | null {
  if (!presets.length) return null;
  const currentIndex = presets.findIndex((item) => item.id === currentId);
  return presets[(currentIndex + 1 + presets.length) % presets.length] ?? presets[0];
}

export function nextPreviewScaleMode(current: ScaleMode): ScaleMode {
  const currentIndex = PREVIEW_SCALE_MODES.findIndex((item) => item.value === current);
  return PREVIEW_SCALE_MODES[(currentIndex + 1 + PREVIEW_SCALE_MODES.length) % PREVIEW_SCALE_MODES.length]?.value
    ?? PREVIEW_SCALE_MODES[0].value;
}

export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

/**
 * 设备预设：覆盖主流屏幕比例与常见前置摄像头形态。尺寸一律按横屏书写，
 * 竖屏工程由 size() 翻转，比例标签也一起翻转（19.5:9 -> 9:19.5）。
 */
export function presetsForDesign(width: number, height: number): DevicePreset[] {
  const portrait = isPortrait(width, height);
  const size = (w: number, h: number) => portrait ? { width: h, height: w } : { width: w, height: h };
  const ratio = (landscape: string) => portrait ? landscape.split(":").reverse().join(":") : landscape;
  if (width === height) {
    return [{ id: "square", label: "方形 1:1", group: "平板", ...size(1080, 1080), shell: "tablet" }];
  }
  return [
    { id: "notch", label: `刘海 ${ratio("19.5:9")}`, group: "手机", ...size(1792, 828), shell: "notch" },
    { id: "island", label: `灵动岛 ${ratio("19.5:9")}`, group: "手机", ...size(1792, 828), shell: "island" },
    { id: "waterdrop", label: `水滴 ${ratio("20:9")}`, group: "手机", ...size(2400, 1080), shell: "waterdrop" },
    { id: "punch-hole", label: `打孔 ${ratio("18:9")}`, group: "手机", ...size(2160, 1080), shell: "punch-hole" },
    { id: "pill", label: `药丸 ${ratio("20:9")}`, group: "手机", ...size(2400, 1080), shell: "pill" },
    { id: "fullscreen", label: `全面屏 ${ratio("16:9")}`, group: "手机", ...size(1920, 1080), shell: "fullscreen" },
    { id: "long-phone", label: `长屏 ${ratio("21:9")}`, group: "手机", ...size(2520, 1080), shell: "punch-hole" },
    { id: "tablet-4-3", label: `平板 ${ratio("4:3")}`, group: "平板", ...size(1536, 1152), shell: "tablet" },
    { id: "tablet-3-2", label: `平板 ${ratio("3:2")}`, group: "平板", ...size(1500, 1000), shell: "tablet" },
    { id: "desktop", label: `桌面 ${ratio("16:9")}`, group: "桌面", ...size(1920, 1080), shell: "desktop" },
    { id: "desktop-16-10", label: `桌面 ${ratio("16:10")}`, group: "桌面", ...size(1680, 1050), shell: "desktop" },
    { id: "ultrawide", label: `超宽 ${ratio("21:9")}`, group: "桌面", ...size(2520, 1080), shell: "ultrawide" },
  ];
}
