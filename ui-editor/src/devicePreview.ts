export type DeviceShell = "desktop" | "tablet" | "waterdrop" | "pill" | "ultrawide";

export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  shell: DeviceShell;
}

export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

export function presetsForDesign(width: number, height: number): DevicePreset[] {
  if (width === height) return [{ id: "square", label: "方形 1:1", width: 1080, height: 1080, shell: "tablet" }];
  const portrait = isPortrait(width, height);
  const size = (w: number, h: number) => portrait ? { width: h, height: w } : { width: w, height: h };
  const ratio = (landscape: string) => portrait ? landscape.split(":").reverse().join(":") : landscape;
  return [
    { id: "desktop", label: `桌面 ${ratio("16:9")}`, ...size(1920, 1080), shell: "desktop" },
    { id: "tablet", label: `平板 ${ratio("4:3")}`, ...size(1536, 1152), shell: "tablet" },
    { id: "waterdrop", label: `水滴 ${ratio("20:9")}`, ...size(2400, 1080), shell: "waterdrop" },
    { id: "pill", label: `药丸 ${ratio("19.5:9")}`, ...size(2340, 1080), shell: "pill" },
    { id: "ultrawide", label: `超宽 ${ratio("21:9")}`, ...size(2520, 1080), shell: "ultrawide" },
  ];
}
