import { describe, expect, it } from "vitest";
import { isPortrait, presetsForDesign } from "./devicePreview";

describe("device preview presets", () => {
  it("uses PSD dimensions to select the default orientation", () => {
    expect(isPortrait(1280, 720)).toBe(false);
    expect(isPortrait(720, 1280)).toBe(true);
    expect(presetsForDesign(720, 1280).map((item) => item.label)).toContain("水滴 9:20");
  });

  it("covers the mainstream aspect ratios grouped by device kind", () => {
    const presets = presetsForDesign(1280, 720);
    expect(presets.map((item) => item.label)).toEqual([
      "刘海 19.5:9", "灵动岛 19.5:9", "水滴 20:9", "打孔 18:9", "药丸 20:9", "全面屏 16:9", "长屏 21:9",
      "平板 4:3", "平板 3:2",
      "桌面 16:9", "桌面 16:10", "超宽 21:9",
    ]);
    expect(presets.map((item) => item.group)).toEqual([
      "手机", "手机", "手机", "手机", "手机", "手机", "手机",
      "平板", "平板",
      "桌面", "桌面", "桌面",
    ]);
  });

  it("covers every front-camera shape", () => {
    const shells = presetsForDesign(1280, 720).map((item) => item.shell);
    for (const shell of ["notch", "waterdrop", "pill", "punch-hole", "island", "fullscreen"]) {
      expect(shells).toContain(shell);
    }
  });

  it("flips the ratio label and size for portrait designs", () => {
    const presets = presetsForDesign(720, 1280);
    const notch = presets.find((item) => item.id === "notch");
    expect(notch?.label).toBe("刘海 9:19.5");
    expect(notch?.width).toBe(828);
    expect(notch?.height).toBe(1792);
  });

  it("falls back to a single square preset for square designs", () => {
    expect(presetsForDesign(1080, 1080).map((item) => item.id)).toEqual(["square"]);
  });
});
