/** 顶部流程工作区；与区域内可切换的 AreaTool 不是同一层概念。 */
export type BuiltInWorkspace = "controls" | "bindings" | "slice" | "preview" | "export";
/** 自定义工作区使用稳定的字符串 id，布局只属于编辑器本地偏好。 */
export type Workspace = string;
export type Workflow = Workspace;
export interface WorkspaceOption {
  value: Workspace;
  label: string;
  builtIn?: boolean;
}
export const WORKFLOW_OPTIONS: WorkspaceOption[] = [
  { value: "controls", label: "层级", builtIn: true },
  { value: "bindings", label: "资源绑定", builtIn: true },
  { value: "slice", label: "九宫格", builtIn: true },
  { value: "preview", label: "预览", builtIn: true },
  { value: "export", label: "导出", builtIn: true },
];
/** 旧导入路径兼容名；新代码优先使用 WORKFLOW_OPTIONS 表达语义。 */
export const WORKSPACE_OPTIONS = WORKFLOW_OPTIONS;
/** 工作区上下文栏已并入当前流程工具栏；保留文件供旧导入路径兼容。 */
export default function Workbar() { return null; }
