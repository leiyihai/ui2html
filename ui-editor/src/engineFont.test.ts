import { describe, expect, it } from "vitest";
import { ENGINE_EDITOR_FONT_FAMILY, mapToEngineFont, normalizeEditorFontSize, parseEngineFontSize } from "./engineFont";

describe("engine font mapping", () => {
  it("uses the bundled engine font family", () => {
    expect(ENGINE_EDITOR_FONT_FAMILY).toBe("DroidSans");
  });

  it("rounds up to the nearest supported engine size", () => {
    expect(mapToEngineFont(15)).toMatchObject({ name: "HT16", size: 16, clamped: false });
    expect(mapToEngineFont(17)).toMatchObject({ name: "HT18", size: 18, clamped: false });
    expect(normalizeEditorFontSize(24)).toBe(24);
  });

  it("clamps sizes outside the engine range", () => {
    expect(mapToEngineFont(3)).toMatchObject({ name: "HT8", size: 8, clamped: true });
    expect(mapToEngineFont(200)).toMatchObject({ name: "HT160", size: 160, clamped: true });
  });

  it("recognizes HT and DEFAULT_HT aliases", () => {
    expect(parseEngineFontSize("HT16")).toBe(16);
    expect(parseEngineFontSize("DEFAULT_HT16")).toBe(16);
    expect(parseEngineFontSize("NotoSansSC-Black")).toBeNull();
  });
});
