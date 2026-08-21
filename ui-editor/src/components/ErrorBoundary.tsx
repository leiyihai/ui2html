import { Component, type ReactNode } from "react";

/** 错误边界：渲染异常时显示错误信息而不是白屏 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("UI 渲染错误:", err); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, color: "#e6ebf2", font: "13px/1.6 sans-serif" }}>
          <h2 style={{ color: "#e06c6c" }}>界面渲染出错</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#9fb0c3" }}>{this.state.err.message}</pre>
          <button style={{ marginTop: 12, padding: "6px 14px" }} onClick={() => this.setState({ err: null })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}
