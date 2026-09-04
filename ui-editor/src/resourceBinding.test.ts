import { describe, expect, it } from "vitest";
import { matchResourceSlot, planResourceBindings, resourceSlotDefinitions } from "./resourceBinding";
import type { UINode } from "./types";

const imageNode = (id: string, name: string): UINode => ({
  id, name, image: {} as HTMLCanvasElement,
  designRect: { x: 0, y: 0, width: 10, height: 10 },
  anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
  scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
  adaptation: { mode: "anchor" },
  psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 10, originalHeight: 10 },
});

describe("resource binding", () => {
  it("recognizes common normal and pressed aliases", () => {
    const slots = resourceSlotDefinitions("RadioButton");
    expect(matchResourceSlot("radio_default", slots)).toBe("NormalImage");
    expect(matchResourceSlot("radio_checked", slots)).toBe("PushedImage");
  });

  it("uses selection order when names do not identify a slot", () => {
    const result = planResourceBindings("RadioButton", [imageNode("a", "left"), imageNode("b", "right")]);
    expect(result.assignments.map((item) => item.slot)).toEqual(["NormalImage", "PushedImage"]);
  });

  it("does not overwrite occupied slots", () => {
    const existing = { NormalImage: { id: "old", name: "old", image: {} as HTMLCanvasElement, sourceNode: imageNode("old", "old"), sourceParentId: null, sourceIndex: 0 } };
    const result = planResourceBindings("RadioButton", [imageNode("a", "new")], existing);
    expect(result.assignments[0].slot).toBe("PushedImage");
  });
});
