import { describe, expect, it } from "vitest";
import { collectResourceBindingTargets, effectivePreviewRect, isBindingComplete, orderResourceBindingTargets, resolveOverviewRect } from "./resourceBindingWorkspace";
import type { UINode } from "./types";

const imageNode = (id: string, name: string): UINode => ({
  id, name, image: {} as HTMLCanvasElement,
  designRect: { x: 0, y: 0, width: 10, height: 10 },
  anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
  scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: 0,
  adaptation: { mode: "anchor" }, psd: { layerId: 1, originalX: 0, originalY: 0, originalWidth: 10, originalHeight: 10 },
});

const groupNode = (id: string, name: string, type: UINode["ctrl"]) => ({
  ...imageNode(id, name), image: null, ctrl: type,
});

describe("resource binding workspace", () => {
  it("flattens nested bindable layouts into separate cards", () => {
    const child = {
      ...groupNode("child", "layout_child", { type: "Layout" }),
      children: [imageNode("child-image", "child_image")],
    };
    const parent = {
      ...groupNode("parent", "layout_parent", { type: "Layout" }),
      children: [imageNode("parent-image", "parent_image"), child],
    };

    const targets = collectResourceBindingTargets([parent]);
    expect(targets.map((target) => target.node.id)).toEqual(["parent", "child"]);
    expect(targets.find((target) => target.node.id === "parent")?.images.map((node) => node.id)).toEqual(["parent-image"]);
    expect(targets.find((target) => target.node.id === "child")?.images.map((node) => node.id)).toEqual(["child-image"]);
  });

  it("does not leak images from a list container into its parent layout card", () => {
    const list = {
      ...groupNode("list", "list_bag_list", { type: "List" }),
      children: [imageNode("list-background", "img_bag_panel_background")],
    };
    const parent = {
      ...groupNode("parent", "layout_bag_panel", { type: "Layout" }),
      children: [imageNode("parent-image", "img_bag_panel_frame"), list],
    };

    const parentTarget = collectResourceBindingTargets([parent]).find((target) => target.node.id === "parent");
    expect(parentTarget?.images.map((node) => node.id)).toEqual(["parent-image"]);
  });

  it("hides a bindable control card when it has no images or existing bindings", () => {
    const button = groupNode("button", "btn_confirm", { type: "Button" });
    expect(collectResourceBindingTargets([button])).toHaveLength(0);
  });

  it("clips a card preview to the visible node range and parent clip", () => {
    expect(effectivePreviewRect({
      node: imageNode("preview", "preview"),
      rect: { x: -20, y: 40, width: 180, height: 120 },
      clipRect: { x: 0, y: 50, width: 100, height: 70 },
      visible: true,
      opacity: 1,
    }, { width: 1280, height: 720 })).toEqual({ x: 0, y: 50, width: 100, height: 70 });
  });

  it("resolves a bound image to the owning control in the scene overview", () => {
    const source = imageNode("source-image", "img_background");
    const control = {
      ...groupNode("control", "layout_panel", { type: "Layout" }),
      resources: {
        LayoutBackImage: {
          id: "binding",
          name: source.name,
          image: source.image!,
          sourceNode: source,
          sourceParentId: "control",
          sourceIndex: 0,
        },
      },
    };
    expect(resolveOverviewRect({ nodes: [{
      node: control,
      rect: { x: 80, y: 40, width: 320, height: 180 },
      visible: true,
      opacity: 1,
    }] }, "source-image", { width: 1280, height: 720 })).toEqual({
      x: 80, y: 40, width: 320, height: 180,
    });
  });

  it("reports completion only when every resource slot is filled", () => {
    const image = imageNode("normal", "normal");
    const [target] = collectResourceBindingTargets([{ ...groupNode("button", "btn", { type: "Button" }), children: [image] }]);
    expect(target).toBeDefined();
    expect(isBindingComplete(target!)).toBe(false);
    target!.node.resources = {
      NormalImage: { id: "normal", name: "normal", image: image.image!, sourceNode: image, sourceParentId: target!.node.id, sourceIndex: 0 },
      PushedImage: { id: "pushed", name: "pushed", image: image.image!, sourceNode: image, sourceParentId: target!.node.id, sourceIndex: 0 },
    };
    target!.images = [];
    expect(isBindingComplete(target!)).toBe(true);
    target!.node.resources = { NormalImage: target!.node.resources!.NormalImage };
    expect(isBindingComplete(target!)).toBe(true);
    target!.images = [image];
    target!.node.resourceBindingComplete = true;
    expect(isBindingComplete(target!)).toBe(true);
  });

  it("keeps incomplete cards first and preserves their original order", () => {
    const first = collectResourceBindingTargets([{ ...groupNode("first", "first", { type: "Button" }), children: [imageNode("first-image", "first-image")] }])[0];
    const second = collectResourceBindingTargets([{ ...groupNode("second", "second", { type: "Button" }), children: [imageNode("second-image", "second-image")] }])[0];
    const complete = collectResourceBindingTargets([{ ...groupNode("complete", "complete", { type: "Button" }), children: [imageNode("complete-image", "complete-image")] }])[0];
    complete.node.resources = {
      NormalImage: { id: "normal", name: "normal", image: complete.images[0].image!, sourceNode: complete.images[0], sourceParentId: complete.node.id, sourceIndex: 0 },
      PushedImage: { id: "pushed", name: "pushed", image: complete.images[0].image!, sourceNode: complete.images[0], sourceParentId: complete.node.id, sourceIndex: 0 },
    };
    complete.images = [];
    expect(orderResourceBindingTargets([complete, first, second]).map((target) => target.node.id)).toEqual(["first", "second", "complete"]);
  });

  it("prioritizes controls whose appearance depends most on bound images", () => {
    const targetFor = (id: string, type: NonNullable<UINode["ctrl"]>["type"]) =>
      collectResourceBindingTargets([{ ...groupNode(id, id, { type }), children: [imageNode(`${id}-image`, `${id}-image`)] }])[0];
    const layout = targetFor("layout", "Layout");
    const button = targetFor("button", "Button");
    const progress = targetFor("progress", "ProgressBar");
    const slider = targetFor("slider", "Slider");
    const edit = targetFor("edit", "Edit");
    const list = targetFor("list", "ListHorizontal");
    expect(orderResourceBindingTargets([layout, button, progress, slider, edit, list]).map((target) => target.node.id)).toEqual([
      "progress", "slider", "button", "edit", "list", "layout",
    ]);
  });
});
