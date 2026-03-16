// DiagramController.ts
// Singleton imperative API registry for Excalidraw canvas instances
import { exportToSvg } from "@excalidraw/excalidraw";
import { readFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/core/tabs/store/tab-store";
import type { ExcalidrawImperativeAPI, BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export interface DiagramControllerAPI {
  register(instanceId: string, api: ExcalidrawImperativeAPI): void;
  unregister(instanceId: string): void;
  getApi(instanceId: string): ExcalidrawImperativeAPI | undefined;
  waitForInstance(instanceId: string, timeoutMs?: number): Promise<ExcalidrawImperativeAPI>;
  getActiveInstanceId(): string | undefined;
  getElements(instanceId: string | undefined): readonly ExcalidrawElement[];
  setElements(instanceId: string | undefined, elements: ExcalidrawElement[]): void;
  addElements(instanceId: string | undefined, elements: ExcalidrawElement[]): void;
  updateScene(
    instanceId: string | undefined,
    sceneData: {
      elements?: ExcalidrawElement[];
      appState?: Partial<AppState>;
      files?: Record<string, BinaryFileData>;
    }
  ): void;
  scrollToContent(instanceId: string | undefined): void;
  exportToSVG(instanceId: string | undefined): Promise<SVGSVGElement | null>;
  insertImages(instanceId: string, filePaths: string[]): Promise<void>;
}

export class DiagramControllerClass implements DiagramControllerAPI {
  private instances = new Map<string, ExcalidrawImperativeAPI>();
  private waiters = new Map<string, Array<(api: ExcalidrawImperativeAPI) => void>>();

  register(instanceId: string, api: ExcalidrawImperativeAPI): void {
    this.instances.set(instanceId, api);

    const pending = this.waiters.get(instanceId);
    if (pending && pending.length > 0) {
      for (const resolve of pending) {
        resolve(api);
      }
      this.waiters.delete(instanceId);
    }
  }

  unregister(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  getApi(instanceId: string): ExcalidrawImperativeAPI | undefined {
    return this.instances.get(instanceId);
  }

  waitForInstance(instanceId: string, timeoutMs = 5000): Promise<ExcalidrawImperativeAPI> {
    const existing = this.instances.get(instanceId);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<ExcalidrawImperativeAPI>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.waiters.get(instanceId);
        if (waiters) {
          const index = waiters.indexOf(resolve);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
        }
        reject(new Error(`DiagramController: timed out waiting for instance "${instanceId}"`));
      }, timeoutMs);

      const resolveAndClear = (api: ExcalidrawImperativeAPI) => {
        clearTimeout(timer);
        resolve(api);
      };

      const existing = this.waiters.get(instanceId);
      if (existing) {
        existing.push(resolveAndClear);
      } else {
        this.waiters.set(instanceId, [resolveAndClear]);
      }
    });
  }

  getActiveInstanceId(): string | undefined {
    const state = useTabStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!activeTab) return undefined;
    if (activeTab.routeId !== "diagram") return undefined;
    return activeTab.instanceId;
  }

  getElements(instanceId: string | undefined): readonly ExcalidrawElement[] {
    if (!instanceId) return [];
    const api = this.instances.get(instanceId);
    if (!api) return [];
    return api.getSceneElements();
  }

  setElements(instanceId: string | undefined, elements: ExcalidrawElement[]): void {
    if (!instanceId) return;
    const api = this.instances.get(instanceId);
    if (!api) return;
    api.updateScene({ elements });
  }

  addElements(instanceId: string | undefined, elements: ExcalidrawElement[]): void {
    if (!instanceId) return;
    const api = this.instances.get(instanceId);
    if (!api) return;
    const existing = api.getSceneElements();
    api.updateScene({ elements: [...existing, ...elements] });
  }

  updateScene(
    instanceId: string | undefined,
    sceneData: {
      elements?: ExcalidrawElement[];
      appState?: Partial<AppState>;
      files?: Record<string, BinaryFileData>;
    }
  ): void {
    if (!instanceId) return;
    const api = this.instances.get(instanceId);
    if (!api) return;
    api.updateScene(sceneData);
  }

  scrollToContent(instanceId: string | undefined): void {
    if (!instanceId) return;
    const api = this.instances.get(instanceId);
    if (!api) return;
    api.scrollToContent();
  }

  async exportToSVG(instanceId: string | undefined): Promise<SVGSVGElement | null> {
    if (!instanceId) return null;
    const api = this.instances.get(instanceId);
    if (!api) return null;

    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const svg = await exportToSvg({
        elements,
        appState,
        files,
      });
      return svg;
    } catch {
      return null;
    }
  }

  async insertImages(instanceId: string, filePaths: string[]): Promise<void> {
    const api = this.getApi(instanceId);
    if (!api) {
      console.warn(
        `DiagramController.insertImages: no API registered for instance "${instanceId}"`
      );
      return;
    }

    const getMimeType = (filePath: string): string => {
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
      };
      return mimeMap[ext] ?? "image/png";
    };

    const imageElements: ExcalidrawElement[] = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const bytes = await readFile(filePath);
      const base64 = btoa(String.fromCharCode(...bytes));
      const mimeType = getMimeType(filePath) as BinaryFileData["mimeType"];
      const dataURL = `data:${mimeType};base64,${base64}` as BinaryFileData["dataURL"];
      const fileId = crypto.randomUUID() as BinaryFileData["id"];

      api.addFiles([
        {
          id: fileId,
          dataURL,
          mimeType,
          created: Date.now(),
          lastRetrieved: Date.now(),
        },
      ]);

      const imageElement = {
        type: "image" as const,
        id: crypto.randomUUID(),
        x: 100 + i * 20,
        y: 100 + i * 20,
        width: 300,
        height: 200,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid" as const,
        strokeWidth: 1,
        strokeStyle: "solid" as const,
        roughness: 0,
        opacity: 100,
        groupIds: [] as string[],
        frameId: null,
        roundness: null,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 100000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        status: "saved" as const,
        fileId,
        scale: [1, 1] as [number, number],
      };

      imageElements.push(imageElement as unknown as ExcalidrawElement);
    }

    const existing = api.getSceneElements();
    api.updateScene({ elements: [...existing, ...imageElements] });
  }
}

export const DiagramController = new DiagramControllerClass();
