import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

type MiddlewareRequest = NodeJS.ReadableStream & { method?: string };
type MiddlewareResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

function readBody(req: MiddlewareRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: MiddlewareResponse, value: unknown, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function ensureUiJsonPath(filePath: string): string {
  if (/\.ui\.json$/i.test(filePath)) return filePath;
  if (/\.json$/i.test(filePath)) return filePath.replace(/\.json$/i, ".ui.json");
  return `${filePath}.ui.json`;
}

function projectAssetDirectory(projectPath: string): string {
  const fileName = path.basename(projectPath).replace(/\.ui\.json$/i, "");
  return path.join(path.dirname(projectPath), `${fileName}.assets`);
}

function projectAnalysisPath(projectPath: string): string {
  return path.join(path.dirname(projectPath), `${path.basename(projectPath).replace(/\.ui\.json$/i, "")}.analysis.json`);
}

function safeAssetPath(assetPath: string): string {
  const normalized = assetPath.replace(/\\/g, "/");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`非法资源路径：${assetPath}`);
  }
  return normalized;
}

function collectAssetPaths(project: any): string[] {
  const found = new Set<string>();
  const visit = (nodes: any[]) => {
    for (const node of nodes ?? []) {
      if (typeof node.assetPath === "string") found.add(safeAssetPath(node.assetPath));
      visit(node.children ?? []);
      for (const binding of Object.values(node.resources ?? {}) as any[]) {
        if (binding?.sourceNode) visit([binding.sourceNode]);
      }
    }
  };
  visit(project.nodes ?? []);
  return [...found];
}

function imageMime(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}

function showProjectDialog(kind: "open" | "save", suggestedName = "未命名.ui.json"): Promise<string | null> {
  if (process.platform !== "win32") return Promise.reject(new Error("当前本地文件选择器仅支持 Windows"));
  const script = kind === "open" ? `
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = 'UI 工程 (*.ui.json)|*.ui.json|JSON 文件 (*.json)|*.json'
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }
  ` : `
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'UI 工程 (*.ui.json)|*.ui.json'
    $dialog.FileName = $env:UI_EDITOR_SUGGESTED_NAME
    $dialog.OverwritePrompt = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }
  `;
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, UI_EDITOR_SUGGESTED_NAME: suggestedName },
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim() || null);
    });
  });
}

function writeProjectTransaction(projectPathInput: string, project: unknown, assets: Record<string, string>, analysis: unknown): string {
  const projectPath = ensureUiJsonPath(path.resolve(projectPathInput));
  const parentDirectory = path.dirname(projectPath);
  const assetsDirectory = projectAssetDirectory(projectPath);
  const analysisPath = projectAnalysisPath(projectPath);
  const temporaryDirectory = path.join(parentDirectory, `.ui-editor-save-${randomUUID()}`);
  const temporaryProject = path.join(temporaryDirectory, path.basename(projectPath));
  const temporaryAssets = path.join(temporaryDirectory, path.basename(assetsDirectory));
  const temporaryAnalysis = path.join(temporaryDirectory, path.basename(analysisPath));
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  if (fs.existsSync(assetsDirectory)) fs.cpSync(assetsDirectory, temporaryAssets, { recursive: true });
  else fs.mkdirSync(temporaryAssets, { recursive: true });

  let backupDirectory: string | null = null;
  let oldProjectBackup: string | null = null;
  let oldAssetsBackup: string | null = null;
  let oldAnalysisBackup: string | null = null;
  try {
    fs.writeFileSync(temporaryProject, JSON.stringify(project, null, 2), "utf8");
    if (analysis) fs.writeFileSync(temporaryAnalysis, JSON.stringify(analysis, null, 2), "utf8");
    for (const [relativePath, dataUrl] of Object.entries(assets)) {
      const safeRelative = safeAssetPath(relativePath);
      const target = path.resolve(temporaryAssets, safeRelative);
      if (!target.startsWith(`${path.resolve(temporaryAssets)}${path.sep}`)) throw new Error(`非法资源路径：${relativePath}`);
      const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
      if (!match) throw new Error(`资源不是有效的 base64 图片：${relativePath}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(match[1], "base64"));
    }

    if (fs.existsSync(projectPath) || fs.existsSync(assetsDirectory) || (analysis && fs.existsSync(analysisPath))) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupDirectory = path.join(parentDirectory, ".ui-editor-backups", `${timestamp}-${path.basename(projectPath, ".ui.json")}`);
      fs.mkdirSync(backupDirectory, { recursive: true });
      if (fs.existsSync(projectPath)) {
        oldProjectBackup = path.join(backupDirectory, path.basename(projectPath));
        fs.renameSync(projectPath, oldProjectBackup);
      }
      if (fs.existsSync(assetsDirectory)) {
        oldAssetsBackup = path.join(backupDirectory, path.basename(assetsDirectory));
        fs.renameSync(assetsDirectory, oldAssetsBackup);
      }
      if (analysis && fs.existsSync(analysisPath)) {
        oldAnalysisBackup = path.join(backupDirectory, path.basename(analysisPath));
        fs.renameSync(analysisPath, oldAnalysisBackup);
      }
    }

    fs.renameSync(temporaryProject, projectPath);
    fs.renameSync(temporaryAssets, assetsDirectory);
    if (analysis) fs.renameSync(temporaryAnalysis, analysisPath);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    return projectPath;
  } catch (error) {
    if (fs.existsSync(projectPath) && oldProjectBackup) fs.rmSync(projectPath, { force: true });
    if (fs.existsSync(assetsDirectory) && oldAssetsBackup) fs.rmSync(assetsDirectory, { recursive: true, force: true });
    if (fs.existsSync(analysisPath) && oldAnalysisBackup) fs.rmSync(analysisPath, { force: true });
    if (oldProjectBackup && fs.existsSync(oldProjectBackup)) fs.renameSync(oldProjectBackup, projectPath);
    if (oldAssetsBackup && fs.existsSync(oldAssetsBackup)) fs.renameSync(oldAssetsBackup, assetsDirectory);
    if (oldAnalysisBackup && fs.existsSync(oldAnalysisBackup)) fs.renameSync(oldAnalysisBackup, analysisPath);
    if (fs.existsSync(temporaryDirectory)) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function parseAiJson(output: string): unknown {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned); } catch { /* 继续尝试提取 JSON */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("Codex CLI 未返回有效 JSON");
}

async function runCodexNaming(manifest: unknown, referenceDataUrl?: string): Promise<{ available: boolean; result?: unknown; message?: string }> {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ui-editor-ai-"));
  const outputPath = path.join(temporaryDirectory, "result.txt");
  const imagePath = path.join(temporaryDirectory, "reference.png");
  try {
    if (referenceDataUrl) {
      const match = /^data:image\/png;base64,(.+)$/s.exec(referenceDataUrl);
      if (match) fs.writeFileSync(imagePath, Buffer.from(match[1], "base64"));
    }
    const prompt = [
      "你是 UI 资源命名助手。不要修改任何文件，只返回 JSON。",
      "根据附带的 UI 效果参考图和图层清单，为所有节点生成英文语义后缀，为所有图片资源生成英文语义名。",
      "节点 suffix 不要包含控件类型前缀；图片 name 不要包含 img_ 前缀。只允许小写英文、数字和下划线。",
      "看不清或不确定时仍返回候选名，但 confidence 必须低于 0.5。",
      "严格返回：{\"nodes\":[{\"id\":\"...\",\"suffix\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}],\"assets\":[{\"key\":\"...\",\"name\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}]}。不要返回 Markdown、解释或额外字段。",
      JSON.stringify(manifest),
    ].join("\n");
    const windowsNpmDirectory = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "";
    const windowsCodexJs = windowsNpmDirectory ? path.join(windowsNpmDirectory, "node_modules", "@openai", "codex", "bin", "codex.js") : "";
    const useDirectNode = process.platform === "win32" && Boolean(windowsCodexJs) && fs.existsSync(windowsCodexJs);
    const command = useDirectNode ? process.execPath : "codex";
    await new Promise<void>((resolve, reject) => {
      const args = [...(useDirectNode ? [windowsCodexJs] : []), "exec", "--ephemeral", "--sandbox", "read-only", "--output-last-message", outputPath];
      if (fs.existsSync(imagePath)) args.push("--image", imagePath);
      args.push(prompt);
      execFile(command, args, { windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || stdout.trim() || error.message));
        else resolve();
      });
    });
    const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    return { available: true, result: parseAiJson(output) };
  } catch (error) {
    return { available: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-ui-projects",
      configureServer(server) {
        server.middlewares.use("/api/ai/name", async (req: MiddlewareRequest, res: MiddlewareResponse) => {
          if (req.method !== "POST") { res.statusCode = 405; return res.end("Method Not Allowed"); }
          try {
            const body = JSON.parse(await readBody(req)) as { manifest?: unknown; referenceDataUrl?: string };
            if (!body.manifest || typeof body.manifest !== "object" || !Array.isArray((body.manifest as { nodes?: unknown }).nodes)
              || (body.manifest as { nodes: unknown[] }).nodes.length === 0) {
              return sendJson(res, { available: false, message: "没有可分析的节点" });
            }
            const result = await runCodexNaming(body.manifest ?? {}, body.referenceDataUrl);
            sendJson(res, result);
          } catch (error) {
            sendJson(res, { available: false, message: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/project/open", async (req: MiddlewareRequest, res: MiddlewareResponse) => {
          if (req.method !== "GET") { res.statusCode = 405; return res.end("Method Not Allowed"); }
          try {
            const selected = await showProjectDialog("open");
            if (!selected) { res.statusCode = 204; return res.end(); }
            const projectPath = path.resolve(selected);
            const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
            const assetsDirectory = projectAssetDirectory(projectPath);
            const assets: Record<string, string> = {};
            for (const relativePath of collectAssetPaths(project)) {
              const filePath = path.resolve(assetsDirectory, relativePath);
              if (!filePath.startsWith(`${path.resolve(assetsDirectory)}${path.sep}`) || !fs.existsSync(filePath)) continue;
              assets[relativePath] = `data:${imageMime(filePath)};base64,${fs.readFileSync(filePath).toString("base64")}`;
            }
            const analysisPath = projectAnalysisPath(projectPath);
            let analysis: unknown = null;
            if (fs.existsSync(analysisPath)) {
              try { analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8")); }
              catch { analysis = null; }
            }
            sendJson(res, { path: projectPath, project, assets, analysis });
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : String(error));
          }
        });

        server.middlewares.use("/api/project/save", async (req: MiddlewareRequest, res: MiddlewareResponse) => {
          if (req.method !== "POST") { res.statusCode = 405; return res.end("Method Not Allowed"); }
          try {
        const body = JSON.parse(await readBody(req)) as {
              path?: string | null;
              suggestedName?: string;
              project: unknown;
          assets: Record<string, string>;
          analysis?: unknown;
          saveAs?: boolean;
        };
            let target = body.saveAs ? null : body.path ?? null;
            if (!target) target = await showProjectDialog("save", body.suggestedName ?? "未命名.ui.json");
            if (!target) { res.statusCode = 204; return res.end(); }
          sendJson(res, { path: writeProjectTransaction(target, body.project, body.assets ?? {}, body.analysis ?? null) });
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : String(error));
          }
        });

        // 保留现有 HTML 导出入口；不再用它保存 UI 工程。
        server.middlewares.use("/save-export", async (req: MiddlewareRequest, res: MiddlewareResponse) => {
          try {
            const { name, html } = JSON.parse(await readBody(req));
            if (html) {
              const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
              const output = path.resolve(import.meta.dirname, "../export", `${safe}.html`);
              fs.mkdirSync(path.dirname(output), { recursive: true });
              fs.writeFileSync(output, html, "utf8");
            }
            res.statusCode = 200;
            res.end("ok");
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : String(error));
          }
        });
      },
    },
  ],
});
