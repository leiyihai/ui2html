export type ExportTarget = "engine" | "figma" | "godot" | "unity";

interface ExportTargetDefinition {
  id: ExportTarget;
  label: string;
  detail: string;
  status: "ready" | "planned";
}

const EXPORT_TARGETS: ExportTargetDefinition[] = [
  { id: "engine", label: "自研引擎 JSON", detail: "正式导出", status: "ready" },
  { id: "figma", label: "Figma", detail: "目标适配预留", status: "planned" },
  { id: "godot", label: "Godot", detail: "目标适配预留", status: "planned" },
  { id: "unity", label: "Unity", detail: "目标适配预留", status: "planned" },
];

interface Props {
  target: ExportTarget;
  onTarget: (target: ExportTarget) => void;
}

/** 导出工作区的目标格式导航。具体转换器由右侧目标面板负责。 */
export default function ExportTargetPanel({ target, onTarget }: Props) {
  return (
    <aside className="export-target-panel" aria-label="转换目标">
      <div className="export-target-heading">
        <span className="workspace-kicker">TARGETS</span>
        <strong>转换目标</strong>
        <small>同一份 UI 工程，可转换为不同目标格式</small>
      </div>
      <nav className="export-target-list" aria-label="目标格式">
        {EXPORT_TARGETS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`export-target-item${target === item.id ? " on" : ""}`}
            aria-current={target === item.id ? "page" : undefined}
            onClick={() => onTarget(item.id)}
          >
            <span className="export-target-mark" aria-hidden="true">{item.id === "engine" ? "{}" : "·"}</span>
            <span className="export-target-copy">
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <span className={`export-target-state ${item.status}`} aria-label={item.status === "ready" ? "已支持" : "计划支持"}>
              {item.status === "ready" ? "可用" : "计划"}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
