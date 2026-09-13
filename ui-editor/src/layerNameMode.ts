import type { ProjectAnalysis } from "./types";

/** AI 命名结果已保存时，层级默认展示可导出的工程名称。 */
export function prefersEngineeringNames(analysis: ProjectAnalysis | null | undefined): boolean {
  return analysis?.provider === "codex-cli";
}
