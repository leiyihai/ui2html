const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const builderCli = path.join(projectRoot, "node_modules", "electron-builder", "cli.js");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui2html-package-"));
const releaseDir = path.join(projectRoot, "release");

const result = spawnSync(
  process.execPath,
  [builderCli, "--win", "portable", `--config.directories.output=${outputDir}`],
  { cwd: projectRoot, stdio: "inherit" },
);

if (result.error) {
  console.error(`无法启动 Electron Builder：${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Electron Builder 打包失败。");
  process.exit(result.status ?? 1);
}

const artifacts = fs
  .readdirSync(outputDir)
  .filter((fileName) => fileName.toLowerCase().endsWith("-portable.exe"));

if (artifacts.length !== 1) {
  console.error(`未找到唯一的免安装版 EXE，当前找到 ${artifacts.length} 个。`);
  process.exit(1);
}

fs.mkdirSync(releaseDir, { recursive: true });
const artifactPath = path.join(outputDir, artifacts[0]);
const releasePath = path.join(releaseDir, artifacts[0]);
fs.copyFileSync(artifactPath, releasePath);

console.log(`免安装版已生成：${releasePath}`);
fs.rmSync(outputDir, { recursive: true, force: true });
