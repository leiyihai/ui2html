/** 返回字体列表中的下一项；末项之后循环回到首项。 */
export function nextFontInCycle(fonts: string[], current: string): string | null {
  if (!fonts.length) return null;
  const currentIndex = fonts.indexOf(current);
  if (currentIndex < 0) return fonts[0];
  return fonts[(currentIndex + 1) % fonts.length];
}
