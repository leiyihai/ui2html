import { describe, expect, it } from "vitest";
import { nextFontInCycle } from "./fontPicker";

describe("font picker cycle", () => {
  it("returns null when no fonts are available", () => {
    expect(nextFontInCycle([], "DroidSans")).toBeNull();
  });

  it("advances in order and wraps from the last font to the first", () => {
    const fonts = ["DroidSans", "NotoSansSC-Black", "System UI"];
    expect(nextFontInCycle(fonts, "DroidSans")).toBe("NotoSansSC-Black");
    expect(nextFontInCycle(fonts, "System UI")).toBe("DroidSans");
  });

  it("starts from the first font when the current font is not listed", () => {
    expect(nextFontInCycle(["DroidSans", "System UI"], "MissingFont")).toBe("DroidSans");
  });
});
