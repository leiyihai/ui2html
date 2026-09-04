import { describe, expect, it, vi } from "vitest";
import { readPsd } from "ag-psd";
import { importPsd } from "./psdImport";

vi.mock("ag-psd", () => ({ readPsd: vi.fn() }));

describe("PSD folder import", () => {
  it("imports root folders as image-free Layout nodes instead of inferring a control", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      children: [{
        id: 1,
        name: "btn_panel",
        children: [{
          id: 2,
          name: "background",
          left: 10,
          top: 20,
          right: 110,
          bottom: 70,
          canvas: {} as HTMLCanvasElement,
        }],
      }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));
    const folder = scene.nodes[0];

    expect(folder.ctrl).toEqual({ type: "Layout" });
    expect(folder.image).toBeNull();
    expect(folder.children?.[0].ctrl).toEqual({ type: "StaticImage" });
    expect(warnings).toEqual([]);
  });

  it("keeps an empty PSD folder as an empty Layout node", () => {
    vi.mocked(readPsd).mockReturnValue({
      width: 200,
      height: 100,
      children: [{ id: 3, name: "empty_group", children: [] }],
    } as never);

    const { scene, warnings } = importPsd(new ArrayBuffer(0));
    const folder = scene.nodes[0];

    expect(folder.ctrl).toEqual({ type: "Layout" });
    expect(folder.image).toBeNull();
    expect(folder.children).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
