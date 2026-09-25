import { readTextFile } from "@tauri-apps/plugin-fs";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export async function renderDiagramPreview(path: string, dark: boolean): Promise<Blob> {
  const data = JSON.parse(await readTextFile(path)) as {
    elements?: ExcalidrawElement[];
    appState?: Partial<AppState>;
    files?: BinaryFiles;
  };
  if (!Array.isArray(data.elements)) throw new Error("Invalid diagram file.");
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    elements: data.elements,
    files: data.files ?? {},
    appState: { ...data.appState, exportWithDarkMode: dark, exportBackground: true },
  });
  return new Blob([svg.outerHTML], { type: "image/svg+xml" });
}
