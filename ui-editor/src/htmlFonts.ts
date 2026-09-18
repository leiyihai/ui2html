import type { UINode, UIScene } from "./types";

export interface HtmlFontAsset {
  family: string;
  format: "truetype" | "opentype";
  data: string;
}

interface BundledFont {
  url: string;
  format: "truetype" | "opentype";
}

/**
 * Fonts shipped with UI2HTML and therefore safe to inline into a standalone
 * HTML export. System fonts intentionally do not appear here: a browser
 * cannot read the user's local font file through the editor's web APIs.
 */
export const BUNDLED_HTML_FONTS: Readonly<Record<string, BundledFont>> = {
  DroidSans: { url: "/fonts/DroidSans.ttf", format: "truetype" },
  // Keep the canonical editor family name, but use the exact Noto Sans Hans
  // OpenType file referenced by the PSD importer.
  "NotoSansSC-Black": { url: "/fonts/NotoSansHans-Black.otf", format: "opentype" },
};

function visitTextFonts(nodes: UINode[], families: Set<string>): void {
  for (const node of nodes) {
    if (node.text) families.add(node.text.font?.trim() || "DroidSans");
    if (node.children?.length) visitTextFonts(node.children, families);
  }
}

/** Collect fonts that can actually affect text in the exported scene. */
export function collectUsedHtmlFontFamilies(scene: UIScene): string[] {
  const families = new Set<string>();
  visitTextFonts(scene.nodes, families);
  return [...families];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export interface LoadedHtmlFonts {
  assets: HtmlFontAsset[];
  unavailable: string[];
}

/**
 * Read only the bundled font files referenced by the scene. Missing bundled
 * files and system/external fonts are reported so the UI can warn the user;
 * the export still keeps their family names and normal CSS fallbacks.
 */
export async function loadUsedHtmlFonts(
  scene: UIScene,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<LoadedHtmlFonts> {
  const assets: HtmlFontAsset[] = [];
  const unavailable: string[] = [];

  for (const family of collectUsedHtmlFontFamilies(scene)) {
    const bundled = BUNDLED_HTML_FONTS[family];
    if (!bundled) {
      unavailable.push(family);
      continue;
    }
    try {
      const response = await fetcher(bundled.url);
      if (!response.ok) throw new Error(`font request failed: ${response.status}`);
      assets.push({ family, format: bundled.format, data: arrayBufferToBase64(await response.arrayBuffer()) });
    } catch {
      unavailable.push(family);
    }
  }

  return { assets, unavailable };
}
