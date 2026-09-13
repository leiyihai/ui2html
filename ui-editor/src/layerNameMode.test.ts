import { describe, expect, it } from "vitest";
import { prefersEngineeringNames } from "./layerNameMode";

describe("preferred layer name mode", () => {
  it("uses engineering names only after an AI naming analysis", () => {
    expect(prefersEngineeringNames(null)).toBe(false);
    expect(prefersEngineeringNames({ provider: "local" } as never)).toBe(false);
    expect(prefersEngineeringNames({ provider: "codex-cli" } as never)).toBe(true);
  });
});
