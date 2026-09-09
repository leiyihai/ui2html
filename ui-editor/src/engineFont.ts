/** 引擎 UIEditor 当前登记的 DroidSans 字体预设。 */
export const ENGINE_EDITOR_FONT_FAMILY = "DroidSans";

/** GUIResConfig.json 中的实际字号；DEFAULT_HTn 是同字号的别名。 */
export const ENGINE_FONT_SIZES = [
  8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 48, 64, 72, 120, 160,
] as const;

export interface EngineFontMapping {
  name: string;
  size: number;
  /** 输入字号是否被限制到引擎支持范围。 */
  clamped: boolean;
}

/**
 * 映射到不小于输入字号的最近引擎预设，避免导出后文字视觉上缩小。
 * 引擎字号是离散值，因此 17 会映射为 HT18，15 会映射为 HT16。
 */
export function mapToEngineFont(fontSize: number): EngineFontMapping {
  const value = Number.isFinite(fontSize) ? fontSize : 16;
  const size = ENGINE_FONT_SIZES.find((candidate) => candidate >= value)
    ?? ENGINE_FONT_SIZES[ENGINE_FONT_SIZES.length - 1];
  return {
    name: `HT${size}`,
    size,
    clamped: value < ENGINE_FONT_SIZES[0] || value > ENGINE_FONT_SIZES[ENGINE_FONT_SIZES.length - 1],
  };
}

/** PSD/旧工程文字进入 UI2HTML 时使用的引擎字号。 */
export function normalizeEditorFontSize(fontSize: number): number {
  return mapToEngineFont(fontSize).size;
}

/** 从引擎字体名读取字号；无法识别时返回 null。 */
export function parseEngineFontSize(fontName: string | undefined): number | null {
  const match = String(fontName ?? "").match(/^(?:DEFAULT_)?HT(\d+)$/i);
  if (!match) return null;
  const size = Number(match[1]);
  return ENGINE_FONT_SIZES.includes(size as typeof ENGINE_FONT_SIZES[number]) ? size : null;
}
