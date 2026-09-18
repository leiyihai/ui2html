import { describe, expect, it } from "vitest";
import { buildExportHtml } from "./exportHtml";
import { collectUsedHtmlFontFamilies, loadUsedHtmlFonts } from "./htmlFonts";
import type { UIScene } from "./types";

function sceneWithFonts(fonts: (string | undefined)[]): UIScene {
  return {
    designWidth: 1280,
    designHeight: 720,
    nodes: fonts.map((font, index) => ({
      id: `text-${index}`,
      name: `text-${index}`,
      image: null,
      text: { content: "text", fontSize: 16, color: "#fff", font, mode: "fixed", minFontSize: 12 },
      designRect: { x: 0, y: 0, width: 100, height: 20 },
      anchor: { parentX: 0, parentY: 0, selfX: 0, selfY: 0, offsetX: 0, offsetY: 0, safeArea: false },
      scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, visible: true, zIndex: index,
      adaptation: { mode: "anchor" }, psd: { layerId: index, originalX: 0, originalY: 0, originalWidth: 100, originalHeight: 20 },
    })),
  } as UIScene;
}

describe("HTML export font assets", () => {
  it("collects bundled and external fonts once, with DroidSans as the fallback", () => {
    expect(collectUsedHtmlFontFamilies(sceneWithFonts([undefined, "NotoSansSC-Black", "NotoSansSC-Black", "System UI"])))
      .toEqual(["DroidSans", "NotoSansSC-Black", "System UI"]);
  });

  it("embeds available bundled fonts and reports fonts that cannot be packaged", async () => {
    const fetched: string[] = [];
    const result = await loadUsedHtmlFonts(sceneWithFonts([undefined, "NotoSansSC-Black", "System UI"]), async (url) => {
      fetched.push(String(url));
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer } as Response;
    });

    expect(fetched).toEqual(["/fonts/DroidSans.ttf", "/fonts/NotoSansHans-Black.otf"]);
    expect(result.assets).toEqual([
      { family: "DroidSans", format: "truetype", data: "AAEC" },
      { family: "NotoSansSC-Black", format: "opentype", data: "AAEC" },
    ]);
    expect(result.unavailable).toEqual(["System UI"]);
  });

  it("writes embedded font faces and waits for them before the first canvas draw", () => {
    const html = buildExportHtml(sceneWithFonts([undefined]), "contain", { left: 0, right: 0, top: 0, bottom: 0 }, [
      { family: "DroidSans", format: "truetype", data: "AAEC" },
    ]);

    expect(html).toContain('@font-face{font-family:"DroidSans";src:url(data:font/ttf;base64,AAEC)');
    expect(html).toContain("var FONT_READY");
    expect(html).toContain("FONT_READY.then(draw);");
  });
});
