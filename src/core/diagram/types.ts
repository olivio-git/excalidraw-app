import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export interface DiagramState {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  isDirty: boolean;
  filePath: string | null; // null = nuevo sin guardar
}

export type DiagramStore = Record<string, DiagramState>;
