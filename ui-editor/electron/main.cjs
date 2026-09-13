const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEV_HOST = "127.0.0.1";
const DEV_PORT = 5173;
let viteProcess = null;

function probeDevServer() {
  return new Promise((resolve) => {
    const request = http.get({ host: DEV_HOST, port: DEV_PORT, path: "/", timeout: 350 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
  });
}

function startDevServer() {
  if (process.platform === "win32") {
    // Electron 主进程里直接 spawn npm.cmd 在部分 Windows 环境会返回 EINVAL，
    // 通过系统命令解释器启动 npm 与 ArtistToolkit 的开发壳行为一致。
    viteProcess = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT}`], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    viteProcess = spawn("npm", ["run", "dev", "--", "--host", DEV_HOST, "--port", String(DEV_PORT)], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
    });
  }
  viteProcess.on("exit", () => { viteProcess = null; });
}

async function waitForDevServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await probeDevServer()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("UI2HTML 开发服务启动超时");
}

function resolveAppIcon(isDist = false) {
  const candidates = isDist
    ? [path.join(PROJECT_ROOT, "dist", "app-icon.ico"), path.join(PROJECT_ROOT, "dist", "app-icon.png")]
    : [path.join(PROJECT_ROOT, "public", "app-icon.ico"), path.join(PROJECT_ROOT, "public", "app-icon.png")];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createWindow(url, isDist = false) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#1c2026",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#161b22",
      symbolColor: "#c9d7e0",
      height: 30,
    },
    icon: resolveAppIcon(isDist),
    title: "UI2HTML",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.loadURL(url);
  window.maximize();
  window.show();
  return window;
}

function openApplicationWindow() {
  const isDist = process.argv.includes("--dist") || app.isPackaged;
  if (isDist) {
    return createWindow(pathToFileURL(path.join(PROJECT_ROOT, "dist", "index.html")).toString(), true);
  }
  return createWindow(`http://${DEV_HOST}:${DEV_PORT}`);
}

app.whenReady().then(async () => {
  if (process.argv.includes("--dist") || app.isPackaged) {
    openApplicationWindow();
  } else {
    if (!(await probeDevServer())) startDevServer();
    await waitForDevServer();
    openApplicationWindow();
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) openApplicationWindow(); });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (viteProcess) viteProcess.kill();
});
