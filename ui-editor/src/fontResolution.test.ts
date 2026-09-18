import { describe, expect, it } from "vitest";
import { ENGINE_EDITOR_FONT_FAMILY } from "./engineFont";
import { resolvePsdFont } from "./fontResolution";

describe("PSD font resolution", () => {
  it("prefers the PSD font when the editor reports it as available", () => {
    expect(resolvePsdFont({ name: "SomePsdFont" }, (family) => family === "SomePsdFont"))
      .toBe("SomePsdFont");
  });

  it("falls back to the editor font when the PSD font is unavailable", () => {
    expect(resolvePsdFont({ name: "MissingPsdFont" }, () => false))
      .toBe(ENGINE_EDITOR_FONT_FAMILY);
  });

  it("maps the PSD Noto Sans Chinese alias to the bundled editor font", () => {
    expect(resolvePsdFont({ name: "NotoSansHans-Black" }, () => false))
      .toBe("NotoSansSC-Black");
    expect(resolvePsdFont({ name: "Noto Sans Chinese" }, () => false))
      .toBe("NotoSansSC-Black");
  });
});
