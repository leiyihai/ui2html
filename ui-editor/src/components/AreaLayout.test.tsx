import { describe, expect, it } from "vitest";
import { areaMenuPosition } from "./AreaLayout";

describe("area options menu positioning", () => {
  it("keeps the menu near the pointer and flips independently at the edges", () => {
    const viewport = { width: 800, height: 600 };
    expect(areaMenuPosition({ x: 100, y: 100 }, { width: 220, height: 240 }, viewport)).toEqual({ left: 108, top: 108 });
    expect(areaMenuPosition({ x: 790, y: 590 }, { width: 220, height: 240 }, viewport)).toEqual({ left: 562, top: 342 });
    expect(areaMenuPosition({ x: 4, y: 300 }, { width: 220, height: 240 }, viewport)).toEqual({ left: 12, top: 308 });
  });
});
