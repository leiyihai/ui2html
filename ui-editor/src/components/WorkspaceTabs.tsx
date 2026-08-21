export type Workspace = "layout" | "controls" | "animation" | "export";

/** 顶层工作区导航：主 tab + 最右侧「导出设置」按钮（独立样式，走同一 tab 流程） */
export default function WorkspaceTabs(p: { ws: Workspace; onWs: (w: Workspace) => void }) {
  const main: [Workspace, string][] = [
    ["layout", "布局适配"],
    ["controls", "控件类型"],
    ["animation", "动画"],
  ];
  return (
    <nav className="ws-tabs">
      {main.map(([w, label]) => (
        <button key={w} className={p.ws === w ? "on" : ""} onClick={() => p.onWs(w)}>{label}</button>
      ))}
      <span className="ws-spacer" />
      <button className={"ws-settings" + (p.ws === "export" ? " on" : "")} onClick={() => p.onWs("export")}>⚙ 导出设置</button>
    </nav>
  );
}
