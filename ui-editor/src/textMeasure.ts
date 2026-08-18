// 文本测量/换行（估算制，布局与渲染共用，保证框与显示一致）
// 字符宽：CJK 等宽=字号，ASCII≈0.55×字号，其他≈0.8×字号；行高=字号×1.2

export const LINE_HEIGHT = 1.2;

export function estCharWidth(ch: string, fontSize: number): number {
  const c = ch.codePointAt(0)!;
  if (c > 0x2e7f) return fontSize; // CJK/全角
  if (c <= 0x7f) return fontSize * 0.55; // ASCII
  return fontSize * 0.8;
}

export function estTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += estCharWidth(ch, fontSize);
  return w;
}

/** 按最大宽度换行（估算宽度），返回行数组 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") { lines.push(line); line = ""; continue; }
    if (line && estTextWidth(line + ch, fontSize) > maxWidth) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

/** fit 模式：在 boxW×boxH（设计像素）内找能完整放下的最大字号（≤maxFs，≥minFs） */
export function fitFontSize(content: string, maxFs: number, minFs: number, boxW: number, boxH: number): number {
  for (let f = maxFs; f >= minFs; f--) {
    const lines = wrapText(content, f, boxW);
    if (lines.length * f * LINE_HEIGHT <= boxH) return f;
  }
  return minFs;
}
