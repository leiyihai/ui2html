import { describe, expect, it } from "vitest";
import {
  areaLeaves,
  createDefaultAreaLayout,
  createDefaultWorkspaceLayouts,
  joinArea,
  migrateWorkspaceLayout,
  resizeAreaSplit,
  sanitizeAreaLayout,
  splitArea,
  swapAreaSplit,
  updateAreaTool,
} from "./areaLayout";

describe("area layout tree", () => {
  it("splits an area and copies its tool", () => {
    const root = splitArea(createDefaultAreaLayout("canvas"), "area-1", "vertical", 0.35);
    expect(root.kind).toBe("split");
    expect(root).toMatchObject({ axis: "vertical", ratio: 0.35 });
    expect(areaLeaves(root)).toEqual([
      { kind: "area", id: "area-1", tool: "canvas" },
      { kind: "area", id: "area-2", tool: "canvas" },
    ]);
  });

  it("supports nested splits with unique ids", () => {
    const first = splitArea(createDefaultAreaLayout(), "area-1", "vertical");
    const nested = splitArea(first, "area-2", "horizontal");
    expect(areaLeaves(nested).map((item) => item.id)).toEqual(["area-1", "area-2", "area-3"]);
    expect(nested.kind === "split" && nested.second.kind === "split" ? nested.second.axis : null).toBe("horizontal");
  });

  it("updates only the selected area's tool", () => {
    const root = splitArea(createDefaultAreaLayout(), "area-1", "vertical");
    const next = updateAreaTool(root, "area-2", "preview");
    expect(areaLeaves(next).map((item) => item.tool)).toEqual(["canvas", "preview"]);
  });

  it("resizes, swaps and joins direct sibling areas", () => {
    const root = splitArea(createDefaultAreaLayout(), "area-1", "vertical");
    const resized = resizeAreaSplit(root, "split-1", 0.9);
    expect(resized.kind === "split" ? resized.ratio : 0).toBe(0.8);
    const swapped = swapAreaSplit(resized, "split-1");
    expect(areaLeaves(swapped).map((item) => item.id)).toEqual(["area-2", "area-1"]);
    expect(areaLeaves(joinArea(swapped, "area-2", "current")).map((item) => item.id)).toEqual(["area-2"]);
  });

  it("rejects malformed persisted layout and clamps ratios", () => {
    expect(sanitizeAreaLayout({ kind: "area", id: "a", tool: "bad" })).toBeNull();
    expect(sanitizeAreaLayout({ kind: "area", id: "legacy-export-details", tool: "export-details" })).toBeNull();
    const value = sanitizeAreaLayout({ kind: "split", id: "s", axis: "vertical", ratio: 0.01,
      first: { kind: "area", id: "a", tool: "canvas" },
      second: { kind: "area", id: "b", tool: "preview" } });
    expect(value).toMatchObject({ ratio: 0.2 });
  });

  it("provides separate default compositions for each workflow", () => {
    const layouts = createDefaultWorkspaceLayouts(["custom-1"]);
    expect(areaLeaves(layouts.controls).map((item) => item.tool)).toEqual(["layers", "canvas", "properties"]);
    expect(areaLeaves(layouts.bindings).map((item) => item.tool)).toEqual(["layers", "bindings", "overview"]);
    expect(areaLeaves(layouts.slice).map((item) => item.tool)).toEqual(["slice-candidates", "slice-marker", "overview"]);
    expect(areaLeaves(layouts.preview).map((item) => item.tool)).toEqual(["preview"]);
    expect(areaLeaves(layouts.export).map((item) => item.tool)).toEqual(["export-targets"]);
    expect(areaLeaves(layouts["custom-1"]).map((item) => item.tool)).toEqual(["canvas"]);
  });

  it("migrates the old single nine-slice area without replacing custom layouts", () => {
    const defaults = createDefaultWorkspaceLayouts();
    expect(migrateWorkspaceLayout("slice", { kind: "area", id: "area-slice", tool: "slice" }, defaults.slice)).toEqual(defaults.slice);
    const custom = splitArea(createDefaultAreaLayout("slice"), "area-1", "vertical");
    expect(migrateWorkspaceLayout("slice", custom, defaults.slice)).toEqual(custom);
  });
});
