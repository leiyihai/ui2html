const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEV_HOST = "127.0.0.1";
const DEV_PORT = 5173;
let viteProcess = null;

// 某些 Windows 环境的 GPU 进程无法启动（缺少驱动 DLL 或远程桌面环境），
// Electron 会在 GPU 多次崩溃后直接退出。UI2HTML 以 2D 画布为主，软件渲染足够，
// 因此在创建窗口前关闭硬件加速，保证桌面版能稳定启动。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("in-process-gpu");

function probeDevServer(port = DEV_PORT) {
  return new Promise((resolve) => {
    const request = http.get({ host: DEV_HOST, port, path: "/", timeout: 350 }, (response) => {
      response.resume();
      const isUi2HtmlServer = response.headers["x-ui2html-dev-server"] === "1";
      resolve(response.statusCode >= 200 && response.statusCode < 500 && isUi2HtmlServer);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
  });
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > startPort + 100) {
        reject(new Error("找不到可用的 UI2HTML 开发端口"));
        return;
      }
      const probe = net.createServer();
      probe.unref();
      probe.once("error", (error) => {
        if (error.code === "EADDRINUSE") return tryPort(port + 1);
        reject(error);
      });
      probe.listen(port, DEV_HOST, () => {
        probe.close((error) => error ? reject(error) : resolve(port));
      });
    };
    tryPort(startPort);
  });
}

function startDevServer(port) {
  if (process.platform === "win32") {
    // Electron 主进程里直接 spawn npm.cmd 在部分 Windows 环境会返回 EINVAL，
    // 通过系统命令解释器启动 npm 与 ArtistToolkit 的开发壳行为一致。
    viteProcess = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run dev -- --host ${DEV_HOST} --port ${port} --strictPort`], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    viteProcess = spawn("npm", ["run", "dev", "--", "--host", DEV_HOST, "--port", String(port), "--strictPort"], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
    });
  }
  viteProcess.on("exit", () => { viteProcess = null; });
}

async function waitForDevServer(port) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await probeDevServer(port)) return;
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

function openApplicationWindow(devPort = DEV_PORT) {
  const isDist = process.argv.includes("--dist") || app.isPackaged;
  if (isDist) {
    return createWindow(pathToFileURL(path.join(PROJECT_ROOT, "dist", "index.html")).toString(), true);
  }
  return createWindow(`http://${DEV_HOST}:${devPort}`);
}

async function resolveDevelopmentPort() {
  if (await probeDevServer(DEV_PORT)) return DEV_PORT;
  // 默认端口有其他服务时，绝不复用它；桌面版自行启一个带专属标记的新服务。
  const port = await findAvailablePort(DEV_PORT + 1);
  startDevServer(port);
  await waitForDevServer(port);
  return port;
}

let activeDevPort = DEV_PORT;

app.whenReady().then(async () => {
  if (process.argv.includes("--dist") || app.isPackaged) {
    openApplicationWindow();
  } else {
    activeDevPort = await resolveDevelopmentPort();
    openApplicationWindow(activeDevPort);
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) openApplicationWindow(activeDevPort); });
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
