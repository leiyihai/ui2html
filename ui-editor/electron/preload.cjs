const { contextBridge } = require("electron");

// 第一阶段只提供桌面运行标识；文件读写继续复用 Vite 本地服务，
// 后续可在这里逐步迁移为原生 IPC，而不改动 React 功能页。
contextBridge.exposeInMainWorld("uiEditorDesktop", {
  isDesktop: true,
  platform: process.platform,
});
