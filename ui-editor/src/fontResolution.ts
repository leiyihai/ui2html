import { ENGINE_EDITOR_FONT_FAMILY } from "./engineFont";
import { BUNDLED_HTML_FONTS } from "./htmlFonts";

const BUNDLED_EDITOR_FONT_ALIASES: Readonly<Record<string, string>> = {
  notosanshansblack: "NotoSansSC-Black",
  notosanschinese: "NotoSansSC-Black",
  notosansscblack: "NotoSansSC-Black",
};

function fontAliasKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

/** 将 PSD 内部字体名映射为编辑器注册的字体族名。 */
export function normalizeEditorFontFamily(family: string): string {
  return BUNDLED_EDITOR_FONT_ALIASES[fontAliasKey(family)] ?? family;
}

/** 从 ag-psd 的字体对象或旧工程字符串中取出 CSS 字体族名。 */
export function normalizePsdFontName(raw: unknown): string | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    return value || null;
  }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { name?: unknown; family?: unknown; fontFamily?: unknown };
  for (const candidate of [value.name, value.family, value.fontFamily]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** 检查字体是否能被当前 UI2HTML 编辑器使用。 */
export function isEditorFontAvailable(
  family: string,
  checker?: (family: string) => boolean,
): boolean {
  if (BUNDLED_HTML_FONTS[family]) return true;
  if (family === ENGINE_EDITOR_FONT_FAMILY) return true;
  if (checker) return checker(family);
  if (typeof document === "undefined" || !document.fonts || typeof document.fonts.check !== "function") return false;
  try {
    return document.fonts.check(`16px "${family.replaceAll('"', "\\\"")}"`);
  } catch {
    return false;
  }
}

/** PSD 导入时优先保留可用原字体，否则回退到引擎默认字体。 */
export function resolvePsdFont(
  raw: unknown,
  checker?: (family: string) => boolean,
): string {
  const family = normalizePsdFontName(raw);
  if (!family) return ENGINE_EDITOR_FONT_FAMILY;
  const normalizedFamily = normalizeEditorFontFamily(family);
  return isEditorFontAvailable(normalizedFamily, checker)
    ? normalizedFamily
    : ENGINE_EDITOR_FONT_FAMILY;
}
