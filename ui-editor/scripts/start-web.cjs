const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const FIRST_PORT = 5174;
const MARKER = "1";

function probe(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: HOST, port, path: "/", timeout: 500 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500
        && response.headers["x-ui2html-dev-server"] === MARKER);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
  });
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > startPort + 100) {
        reject(new Error("找不到可用的网页版开发端口"));
        return;
      }
      const server = net.createServer();
      server.unref();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") return tryPort(port + 1);
        reject(error);
      });
      server.listen(port, HOST, () => {
        server.close((error) => error ? reject(error) : resolve(port));
      });
    };
    tryPort(startPort);
  });
}

function startServer(port) {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run dev -- --host ${HOST} --port ${port} --strictPort`]
    : ["run", "dev", "--", "--host", HOST, "--port", String(port), "--strictPort"];
  return spawn(command, args, { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: false });
}

function waitForServer(port) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = async () => {
      if (await probe(port)) return resolve();
      attempts += 1;
      if (attempts >= 80) return reject(new Error(`网页版开发服务启动超时：${port}`));
      setTimeout(check, 150);
    };
    check();
  });
}

function openBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], {
      windowsHide: true,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  const existing = await probe(FIRST_PORT);
  const port = existing ? FIRST_PORT : await findAvailablePort(FIRST_PORT);
  const server = existing ? null : startServer(port);
  await waitForServer(port);
  const url = `http://${HOST}:${port}`;
  console.log(`UI2HTML 网页版已启动：${url}`);
  openBrowser(url);
  if (!server) return;
  server.once("exit", (code) => process.exit(code ?? 0));
  const stop = () => { if (!server.killed) server.kill(); };
  process.once("SIGINT", () => { stop(); process.exit(130); });
  process.once("SIGTERM", () => { stop(); process.exit(143); });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
