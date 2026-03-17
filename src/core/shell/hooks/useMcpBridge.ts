import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { DiagramController } from "@/core/diagram/DiagramController";
import { executeAITool } from "@/features/ai-chat/utils/tool-executor";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { diagramFileService } from "@/core/diagram/services/diagram-file.service";
import { readDir, readTextFile, remove, rename, mkdir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

interface McpCommandPayload {
  uuid: string;
  tool: string;
  input: Record<string, unknown>;
}

interface FlatFileEntry {
  path: string;
  name: string;
  isDir: boolean;
}

const flattenDir = async (dir: string, prefix: string): Promise<FlatFileEntry[]> => {
  const entries = await readDir(dir);
  const result: FlatFileEntry[] = [];
  for (const entry of entries) {
    if (!entry.name) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push({ path: relativePath, name: entry.name, isDir: entry.isDirectory });
    if (entry.isDirectory) {
      const absoluteChild = await join(dir, entry.name);
      const children = await flattenDir(absoluteChild, relativePath);
      result.push(...children);
    }
  }
  return result;
};

export const hasPathTraversal = (p: string): boolean => p.includes("..") || p.startsWith("/");

export async function dispatchMcpTool(
  tool: string,
  input: Record<string, unknown>
): Promise<{ result: unknown; error: string | null }> {
  const instanceId = DiagramController.getActiveInstanceId();

  try {
    switch (tool) {
      case "get_elements": {
        const elements = DiagramController.getElements(instanceId);
        return { result: JSON.stringify(elements), error: null };
      }

      case "draw_elements":
      case "clear_canvas":
      case "update_element": {
        const res = await executeAITool(tool, input, instanceId);
        return { result: res.result, error: res.isError ? res.result : null };
      }

      case "set_elements": {
        if (!instanceId) {
          return { result: null, error: "No active diagram canvas. Open a diagram tab first." };
        }
        const api = DiagramController.getApi(instanceId);
        if (!api) {
          return { result: null, error: "Canvas not ready. Try again in a moment." };
        }
        const elements = (input.elements as unknown[]) ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const converted = convertToExcalidrawElements(elements as any);
        api.updateScene({ elements: converted as ExcalidrawElement[] });
        return { result: `Set ${elements.length} element(s).`, error: null };
      }

      case "export_svg": {
        const svg = await DiagramController.exportToSVG(instanceId);
        if (!svg) return { result: null, error: "No active diagram or export failed." };
        const svgString = new XMLSerializer().serializeToString(svg);
        return { result: svgString, error: null };
      }

      case "open_file": {
        const filePath = input.filePath as string | undefined;
        if (!filePath) return { result: null, error: "filePath is required." };
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        const title = handler.displayName ? handler.displayName(name) : name;
        useTabStore.getState().addTab({
          routeId: handler.routeId,
          path: `/${handler.routeId}`,
          title,
          instanceId: filePath,
          metadata: { filePath },
        });
        return { result: `Opened ${name}.`, error: null };
      }

      case "get_active_tab": {
        const { tabs, activeTabId } = useTabStore.getState();
        const tab = tabs.find((t) => t.id === activeTabId) ?? null;
        if (!tab) return { result: null, error: null };
        return {
          result: JSON.stringify({
            tabId: tab.id,
            routeId: tab.routeId,
            title: tab.title,
            path: tab.path,
            instanceId: tab.instanceId,
          }),
          error: null,
        };
      }

      case "get_workspace_dir": {
        const dir = useWorkspaceStore.getState().workspaceDir;
        return { result: dir ?? null, error: null };
      }

      case "list_workspace": {
        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        if (!workspaceDir) return { result: null, error: "No workspace directory set." };
        const flatList = await flattenDir(workspaceDir, "");
        return { result: JSON.stringify(flatList), error: null };
      }

      case "create_diagram": {
        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        if (!workspaceDir) return { result: null, error: "No workspace directory set." };
        const rawName = (input as Record<string, unknown>).name as string | undefined;
        if (!rawName) return { result: null, error: "name is required." };
        const name = rawName.endsWith(".excalidraw") ? rawName : `${rawName}.excalidraw`;
        if (hasPathTraversal(name)) {
          return { result: null, error: "Invalid path: path traversal not allowed." };
        }
        const filePath = await join(workspaceDir, name);
        try {
          await readTextFile(filePath);
          return { result: null, error: "File already exists." };
        } catch {
          // File does not exist — proceed
        }
        await diagramFileService.createNewDiagram(workspaceDir, name);
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        const title = handler.displayName ? handler.displayName(name) : name;
        useTabStore.getState().addTab({
          routeId: handler.routeId,
          path: `/${handler.routeId}`,
          title,
          instanceId: filePath,
          metadata: { filePath },
        });
        return { result: JSON.stringify({ filePath, instanceId: filePath }), error: null };
      }

      case "save_diagram": {
        const saveInstanceId = (input as Record<string, unknown>).instanceId as string | undefined;
        if (!saveInstanceId) return { result: null, error: "instanceId is required." };
        const api = DiagramController.getApi(saveInstanceId);
        if (!api) return { result: null, error: "No open diagram for instanceId." };
        const elements = api.getSceneElements();
        const appState = api.getAppState();
        const files = api.getFiles();
        await diagramFileService.writeDiagram(saveInstanceId, { elements, appState, files });
        const { collaborators: _collaborators, ...serializableAppState } =
          appState as Partial<AppState> & { collaborators?: unknown };
        const serialized = JSON.stringify(
          {
            type: "excalidraw",
            version: 2,
            source: "excalidraw-app",
            elements,
            appState: serializableAppState,
            files,
          },
          null,
          2
        );
        const bytes = new TextEncoder().encode(serialized).length;
        return {
          result: JSON.stringify({ saved: true, instanceId: saveInstanceId, bytes }),
          error: null,
        };
      }

      case "create_folder": {
        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        if (!workspaceDir) return { result: null, error: "No workspace directory set." };
        const folderPath = (input as Record<string, unknown>).path as string | undefined;
        if (!folderPath) return { result: null, error: "path is required." };
        if (hasPathTraversal(folderPath)) {
          return { result: null, error: "Invalid path: path traversal not allowed." };
        }
        const absolutePath = await join(workspaceDir, folderPath);
        await mkdir(absolutePath, { recursive: true });
        return { result: JSON.stringify({ created: true, path: folderPath }), error: null };
      }

      case "rename_file": {
        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        if (!workspaceDir) return { result: null, error: "No workspace directory set." };
        const oldPath = (input as Record<string, unknown>).oldPath as string | undefined;
        const newPath = (input as Record<string, unknown>).newPath as string | undefined;
        if (!oldPath) return { result: null, error: "oldPath is required." };
        if (!newPath) return { result: null, error: "newPath is required." };
        if (hasPathTraversal(oldPath) || hasPathTraversal(newPath)) {
          return { result: null, error: "Invalid path: path traversal not allowed." };
        }
        const absoluteOld = await join(workspaceDir, oldPath);
        const absoluteNew = await join(workspaceDir, newPath);
        await rename(absoluteOld, absoluteNew);
        const { tabs } = useTabStore.getState();
        const matchingTab = tabs.find((t) => t.instanceId === absoluteOld);
        let tabUpdated = false;
        if (matchingTab) {
          const newTitle = absoluteNew.split(/[\\/]/).pop() ?? absoluteNew;
          useTabStore.getState().updateTab(matchingTab.id, {
            instanceId: absoluteNew,
            title: newTitle,
            metadata: { ...matchingTab.metadata, filePath: absoluteNew },
          });
          tabUpdated = true;
        }
        return {
          result: JSON.stringify({ renamed: true, oldPath, newPath, tabUpdated }),
          error: null,
        };
      }

      case "delete_file": {
        const confirm = (input as Record<string, unknown>).confirm as boolean | undefined;
        if (confirm !== true) {
          return { result: null, error: "confirm must be true to delete." };
        }
        const workspaceDir = useWorkspaceStore.getState().workspaceDir;
        if (!workspaceDir) return { result: null, error: "No workspace directory set." };
        const filePath = (input as Record<string, unknown>).path as string | undefined;
        if (!filePath) return { result: null, error: "path is required." };
        if (hasPathTraversal(filePath)) {
          return { result: null, error: "Invalid path: path traversal not allowed." };
        }
        const absolutePath = await join(workspaceDir, filePath);
        const { tabs } = useTabStore.getState();
        const matchingTabs = tabs.filter(
          (t) => t.instanceId === absolutePath || t.instanceId.startsWith(absolutePath + "/")
        );
        for (const tab of matchingTabs) {
          useTabStore.getState().removeTab(tab.id);
        }
        await remove(absolutePath, { recursive: true });
        return {
          result: JSON.stringify({
            deleted: true,
            path: filePath,
            tabsClosed: matchingTabs.length,
          }),
          error: null,
        };
      }

      default:
        return { result: null, error: `Unknown tool: ${tool}` };
    }
  } catch (err) {
    return { result: null, error: String(err) };
  }
}

export function useMcpBridge() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<McpCommandPayload>("mcp:command", async (event) => {
      const { uuid, tool, input } = event.payload;
      const { result, error } = await dispatchMcpTool(tool, input);
      await invoke("mcp_ack", { uuid, result, error });
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
