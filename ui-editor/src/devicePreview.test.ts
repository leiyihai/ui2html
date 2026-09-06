import { describe, expect, it } from "vitest";
import { isPortrait, presetsForDesign } from "./devicePreview";

describe("device preview presets", () => {
  it("uses PSD dimensions to select the default orientation", () => {
    expect(isPortrait(1280, 720)).toBe(false);
    expect(isPortrait(720, 1280)).toBe(true);
    expect(presetsForDesign(720, 1280).map((item) => item.label)).toContain("水滴 9:20");
  });

  it("provides representative landscape shells with their aspect ratios", () => {
    const presets = presetsForDesign(1280, 720);
    expect(presets.map((item) => item.label)).toEqual([
      "桌面 16:9", "平板 4:3", "水滴 20:9", "药丸 19.5:9", "超宽 21:9",
    ]);
    expect(presets.find((item) => item.id === "pill")?.shell).toBe("pill");
  });
});
