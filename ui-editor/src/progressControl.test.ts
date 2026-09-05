import { describe, expect, it } from "vitest";
import { clampProgressValue, defaultProgressConfig, progressConfig } from "./progressControl";

describe("progress control configuration", () => {
  it("infers the default direction from the control dimensions", () => {
    expect(defaultProgressConfig({ designRect: { x: 0, y: 0, width: 200, height: 24 } })).toEqual({
      value: 0, direction: "horizontal", reverse: false,
    });
    expect(defaultProgressConfig({ designRect: { x: 0, y: 0, width: 24, height: 200 } }).direction).toBe("vertical");
  });

  it("clamps and rounds values to two decimal places", () => {
    expect(clampProgressValue(0.256)).toBe(0.26);
    expect(clampProgressValue(-0.2)).toBe(0);
    expect(clampProgressValue(1.2)).toBe(1);
  });

  it("provides legacy defaults while preserving explicit direction and reverse", () => {
    const node = {
      designRect: { x: 0, y: 0, width: 100, height: 20 },
      progress: { value: 0.756, direction: "vertical" as const, reverse: true },
    };
    expect(progressConfig(node)).toEqual({ value: 0.76, direction: "vertical", reverse: true });
    expect(progressConfig({ designRect: node.designRect })).toEqual({ value: 0, direction: "horizontal", reverse: false });
  });
});
