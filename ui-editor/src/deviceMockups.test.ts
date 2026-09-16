import { describe, expect, it } from "vitest";
import { deviceMockupMetrics, isCssDeviceShell } from "./deviceMockups";

describe("device shell metrics", () => {
  it("draws css frames for every mobile shell only", () => {
    for (const shell of ["notch", "waterdrop", "pill", "punch-hole", "island", "fullscreen"] as const) {
      expect(isCssDeviceShell(shell)).toBe(true);
    }
    for (const shell of ["desktop", "tablet", "ultrawide"] as const) {
      expect(isCssDeviceShell(shell)).toBe(false);
    }
  });

  it("scales bezel and radius with the preview size", () => {
    const small = deviceMockupMetrics("notch", 120, 260)!;
    const large = deviceMockupMetrics("notch", 1200, 2600)!;
    expect(large.bezelX).toBeGreaterThan(small.bezelX);
    expect(large.outerRadius).toBeGreaterThan(small.outerRadius);
    expect(large.screenRadius).toBeGreaterThan(small.screenRadius);
  });

  it("clamps outliers instead of growing without bound", () => {
    const huge = deviceMockupMetrics("notch", 100000, 100000)!;
    expect(huge.bezelX).toBeLessThanOrEqual(34);
    expect(huge.bezelY).toBeLessThanOrEqual(34);
    expect(huge.outerRadius).toBeLessThanOrEqual(54);

    const tiny = deviceMockupMetrics("notch", 1, 1)!;
    expect(tiny.bezelX).toBeGreaterThanOrEqual(7);
    expect(tiny.outerRadius).toBeGreaterThanOrEqual(10);
  });

  it("keeps the screen radius tighter than the body radius", () => {
    const metrics = deviceMockupMetrics("waterdrop", 900, 2000)!;
    expect(metrics.screenRadius).toBeLessThan(metrics.outerRadius);
  });

  it("matches the real device cutout proportions from devices.css and AOSP", () => {
    // iPhone X：刘海 204×30 @375 屏宽，贴屏幕顶，两侧有内凹过渡圆角
    const notch = deviceMockupMetrics("notch", 375, 812)!;
    expect(notch.cutout!.width / 375).toBeCloseTo(0.544, 3);
    expect(notch.cutout!.height / 375).toBeCloseTo(0.08, 3);
    expect(notch.cutout!.offsetTop).toBe(0);
    expect(notch.cutout!.ear).toBeGreaterThan(0);

    // iPhone 14 Pro：灵动岛 120×35 @390 屏宽，距屏幕顶 9
    const island = deviceMockupMetrics("island", 390, 844)!;
    expect(island.cutout!.width / 390).toBeCloseTo(0.308, 3);
    expect(island.cutout!.height / 390).toBeCloseTo(0.09, 3);
    expect(island.cutout!.offsetTop).toBeGreaterThan(0);

    // 三星 Note 10：打孔 ⌀72 @1080 屏宽（AOSP cutout 72×90，孔居中于框内）
    const punch = deviceMockupMetrics("punch-hole", 1080, 2280)!;
    expect(punch.cutout!.width / 1080).toBeCloseTo(0.0667, 3);
    expect(punch.cutout!.width).toBeCloseTo(punch.cutout!.height, 5);

    // 一加 6T/7：水滴凹口 170×79 @1080 屏宽（AOSP RectApproximation）
    const drop = deviceMockupMetrics("waterdrop", 1080, 2340)!;
    expect(drop.cutout!.width / 1080).toBeCloseTo(0.1574, 3);
    expect(drop.cutout!.height / 1080).toBeCloseTo(0.0731, 3);
    expect(drop.cutout!.offsetTop).toBe(0);

    // 三星 S10+：药丸 326×142 @1440 屏宽，贴屏幕右上角
    const pill = deviceMockupMetrics("pill", 1440, 3040)!;
    expect(pill.cutout!.width / 1440).toBeCloseTo(0.2264, 3);
    expect(pill.cutout!.height / 1440).toBeCloseTo(0.0986, 3);
    expect(pill.cutout!.offsetRight).toBe(0);
  });

  it("distinguishes the waterdrop notch, the isolated punch hole and the corner pill", () => {
    const drop = deviceMockupMetrics("waterdrop", 1080, 2340)!.cutout!;
    const punch = deviceMockupMetrics("punch-hole", 1080, 2280)!.cutout!;
    const pill = deviceMockupMetrics("pill", 1440, 3040)!.cutout!;

    // 水滴和打孔都是顶部居中（没有右边距）
    expect(drop.offsetRight).toBeNull();
    expect(punch.offsetRight).toBeNull();
    // 水滴是横向的浅凹口（宽大于高），打孔是正圆
    expect(drop.width).toBeGreaterThan(drop.height);
    expect(punch.width).toBeCloseTo(punch.height, 5);
    // 药丸贴屏幕右上角
    expect(pill.offsetRight).toBe(0);
    // 真机上水滴凹口本来就比单孔大得多
    expect(drop.width).toBeGreaterThan(punch.width * 2);
  });

  it("gives the waterdrop and pill the same rounded-rectangle style as the island", () => {
    const island = deviceMockupMetrics("island", 390, 844)!.cutout!;
    const drop = deviceMockupMetrics("waterdrop", 1080, 2340)!.cutout!;
    const pill = deviceMockupMetrics("pill", 1440, 3040)!.cutout!;
    expect(drop.radius).toBeGreaterThan(0);
    expect(pill.radius).toBeGreaterThan(0);
    expect(drop.radius / 1080).toBeCloseTo(island.radius / 390, 5);
    expect(pill.radius / 1440).toBeCloseTo(island.radius / 390, 5);
  });

  it("has no cutout for fullscreen and nothing for non-mobile or degenerate sizes", () => {
    expect(deviceMockupMetrics("fullscreen", 400, 800)!.cutout).toBeNull();
    expect(deviceMockupMetrics("desktop", 800, 600)).toBeNull();
    expect(deviceMockupMetrics("notch", 0, 0)).toBeNull();
    expect(deviceMockupMetrics("notch", -10, 500)).toBeNull();
  });
});
