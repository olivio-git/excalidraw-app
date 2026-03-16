import { readTextFile, writeTextFile, create } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

interface DiagramFileData {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
}

const EMPTY_DIAGRAM: DiagramFileData = {
  elements: [],
  appState: { collaborators: new Map() },
};

const readDiagram = async (filePath: string): Promise<DiagramFileData> => {
  const content = await readTextFile(filePath);
  if (!content.trim()) return EMPTY_DIAGRAM;

  const parsed = JSON.parse(content);
  return {
    elements: parsed.elements ?? [],
    appState: { ...(parsed.appState ?? {}), collaborators: new Map() },
  };
};

const writeDiagram = async (filePath: string, data: DiagramFileData): Promise<void> => {
  const { collaborators: _collaborators, ...serializableAppState } =
    data.appState as Partial<AppState> & { collaborators?: unknown };
  const content = JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-app",
      elements: data.elements,
      appState: serializableAppState,
    },
    null,
    2
  );
  await writeTextFile(filePath, content);
};

const createNewDiagram = async (dir: string, name: string): Promise<string> => {
  const fileName = name.endsWith(".excalidraw") ? name : `${name}.excalidraw`;
  const filePath = await join(dir, fileName);
  const content = JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-app",
      elements: [],
      appState: {},
    },
    null,
    2
  );
  await create(filePath);
  await writeTextFile(filePath, content);
  return filePath;
};

export const diagramFileService = {
  readDiagram,
  writeDiagram,
  createNewDiagram,
};
