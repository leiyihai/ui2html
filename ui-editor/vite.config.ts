import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
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

function writeProjectTransaction(projectPathInput: string, project: unknown, assets: Record<string, string>): string {
  const projectPath = ensureUiJsonPath(path.resolve(projectPathInput));
  const parentDirectory = path.dirname(projectPath);
  const assetsDirectory = projectAssetDirectory(projectPath);
  const temporaryDirectory = path.join(parentDirectory, `.ui-editor-save-${randomUUID()}`);
  const temporaryProject = path.join(temporaryDirectory, path.basename(projectPath));
  const temporaryAssets = path.join(temporaryDirectory, path.basename(assetsDirectory));
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  if (fs.existsSync(assetsDirectory)) fs.cpSync(assetsDirectory, temporaryAssets, { recursive: true });
  else fs.mkdirSync(temporaryAssets, { recursive: true });

  let backupDirectory: string | null = null;
  let oldProjectBackup: string | null = null;
  let oldAssetsBackup: string | null = null;
  try {
    fs.writeFileSync(temporaryProject, JSON.stringify(project, null, 2), "utf8");
    for (const [relativePath, dataUrl] of Object.entries(assets)) {
      const safeRelative = safeAssetPath(relativePath);
      const target = path.resolve(temporaryAssets, safeRelative);
      if (!target.startsWith(`${path.resolve(temporaryAssets)}${path.sep}`)) throw new Error(`非法资源路径：${relativePath}`);
      const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
      if (!match) throw new Error(`资源不是有效的 base64 图片：${relativePath}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(match[1], "base64"));
    }

    if (fs.existsSync(projectPath) || fs.existsSync(assetsDirectory)) {
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
    }

    fs.renameSync(temporaryProject, projectPath);
    fs.renameSync(temporaryAssets, assetsDirectory);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    return projectPath;
  } catch (error) {
    if (fs.existsSync(projectPath) && oldProjectBackup) fs.rmSync(projectPath, { force: true });
    if (fs.existsSync(assetsDirectory) && oldAssetsBackup) fs.rmSync(assetsDirectory, { recursive: true, force: true });
    if (oldProjectBackup && fs.existsSync(oldProjectBackup)) fs.renameSync(oldProjectBackup, projectPath);
    if (oldAssetsBackup && fs.existsSync(oldAssetsBackup)) fs.renameSync(oldAssetsBackup, assetsDirectory);
    if (fs.existsSync(temporaryDirectory)) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-ui-projects",
      configureServer(server) {
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
            sendJson(res, { path: projectPath, project, assets });
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
              saveAs?: boolean;
            };
            let target = body.saveAs ? null : body.path ?? null;
            if (!target) target = await showProjectDialog("save", body.suggestedName ?? "未命名.ui.json");
            if (!target) { res.statusCode = 204; return res.end(); }
            sendJson(res, { path: writeProjectTransaction(target, body.project, body.assets ?? {}) });
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
