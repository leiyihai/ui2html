export type Workspace = "controls" | "export";

interface Props {
  ws: Workspace;
  onWs: (workspace: Workspace) => void;
  hasScene: boolean;
}

/** 当前版本只保留编辑层级和导出两个工作区；适配、动画、九宫格以后独立增加。 */
export default function Workbar({ ws, onWs, hasScene }: Props) {
  return (
    <div className="workbar">
      <nav className="ws-tabs" aria-label="工作区">
        <button className={ws === "controls" ? "on" : ""} onClick={() => onWs("controls")}>
          <span className="ws-ic">◎</span>层级
        </button>
        <button className={ws === "export" ? "on" : ""} disabled={!hasScene}
          onClick={() => onWs("export")} title={!hasScene ? "请先打开或导入工程" : "导出自研引擎 JSON"}>
          <span className="ws-ic">⇩</span>导出
        </button>
      </nav>
      <span className="ws-spacer" />
      <span className="workbar-hint">PSD 只负责导入，工程文件独立保存</span>
    </div>
  );
}
