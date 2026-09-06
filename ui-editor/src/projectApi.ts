import type { SavedScene } from "./scenePersistence";
import type { ProjectAnalysis } from "./types";
import type { AiNamingResult, NamingManifest } from "./aiNaming";

interface ProjectPayload {
  path: string;
  project: SavedScene;
  assets: Record<string, string>;
  analysis?: ProjectAnalysis | null;
}

async function canvasFromDataUrl(dataUrl: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}

async function decodeAssets(assets: Record<string, string>): Promise<Map<string, HTMLCanvasElement>> {
  const decoded = await Promise.all(Object.entries(assets).map(async ([assetPath, dataUrl]) => (
    [assetPath, await canvasFromDataUrl(dataUrl)] as const
  )));
  return new Map(decoded);
}

export interface OpenedProject {
  path: string;
  project: SavedScene;
  assets: Map<string, HTMLCanvasElement>;
  analysis: ProjectAnalysis | null;
}

export async function openProject(): Promise<OpenedProject | null> {
  const response = await fetch("/api/project/open");
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(await response.text() || "打开工程失败");
  const payload = await response.json() as ProjectPayload;
  return { path: payload.path, project: payload.project, assets: await decodeAssets(payload.assets), analysis: payload.analysis ?? null };
}

export async function saveProject(input: {
  path: string | null;
  suggestedName: string;
  project: SavedScene;
  assets: Record<string, string>;
  analysis?: ProjectAnalysis | null;
  saveAs?: boolean;
}): Promise<string | null> {
  const response = await fetch("/api/project/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(await response.text() || "保存工程失败");
  const result = await response.json() as { path: string };
  return result.path;
}

export async function requestAiNaming(manifest: NamingManifest, referenceDataUrl?: string, signal?: AbortSignal): Promise<{
  available: boolean;
  result?: AiNamingResult;
  message?: string;
}> {
  const response = await fetch("/api/ai/name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ manifest, referenceDataUrl }),
  });
  if (!response.ok) return { available: false, message: await response.text() || "AI 命名服务不可用" };
  return await response.json() as { available: boolean; result?: AiNamingResult; message?: string };
}

export function projectFileName(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").split("/").pop() ?? "未命名.ui.json";
}
