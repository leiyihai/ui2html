import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PreviewDeviceFrame from "./PreviewDeviceFrame";

const canvas = <div className="canvas-stack"><canvas /></div>;

describe("PreviewDeviceFrame", () => {
  it("keeps the canvas in the same screen wrapper when the shell is toggled", () => {
    const enabled = renderToStaticMarkup(<PreviewDeviceFrame deviceShell="desktop" portrait={false} showDeviceShell>{canvas}</PreviewDeviceFrame>);
    const disabled = renderToStaticMarkup(<PreviewDeviceFrame deviceShell="desktop" portrait={false} showDeviceShell={false}>{canvas}</PreviewDeviceFrame>);

    for (const html of [enabled, disabled]) {
      expect(html).toContain("preview-device-mockup");
      expect(html).toContain("preview-device-screen");
      expect(html).toContain("canvas-stack");
    }
    expect(enabled).not.toMatch(/preview-device-mockup[^"]*is-hidden/);
    expect(disabled).toMatch(/preview-device-mockup[^"]*is-hidden/);
  });

  it("renders individual mobile hardware parts for both orientations", () => {
    const portrait = renderToStaticMarkup(<PreviewDeviceFrame deviceShell="notch" portrait showDeviceShell>{canvas}</PreviewDeviceFrame>);
    const landscape = renderToStaticMarkup(<PreviewDeviceFrame deviceShell="pill" portrait={false} showDeviceShell>{canvas}</PreviewDeviceFrame>);

    for (const html of [portrait, landscape]) {
      expect(html).toContain("preview-device-button-volume-up");
      expect(html).toContain("preview-device-button-volume-down");
      expect(html).toContain("preview-device-button-power");
      expect(html).toContain("preview-device-button-action");
    }
    expect(portrait).toMatch(/preview-device-mockup[^"]*portrait/);
    expect(landscape).toMatch(/preview-device-mockup[^"]*landscape/);
  });

  it("draws mobile shells with css instead of image templates", () => {
    const iphone = renderToStaticMarkup(<PreviewDeviceFrame deviceShell="notch" portrait showDeviceShell>{canvas}</PreviewDeviceFrame>);
    const androidLandscape = renderToStaticMarkup(<PreviewDeviceFrame deviceShell="waterdrop" portrait={false} showDeviceShell>{canvas}</PreviewDeviceFrame>);

    for (const html of [iphone, androidLandscape]) {
      expect(html).not.toContain("has-device-template");
      expect(html).not.toContain("preview-device-template-overlay");
      expect(html).not.toContain(".png");
    }
    expect(iphone).toContain("preview-device-cutout");
    expect(iphone).toContain("preview-device-cutout-inner");
    expect(iphone).toContain("preview-device-home-indicator");
  });
});
