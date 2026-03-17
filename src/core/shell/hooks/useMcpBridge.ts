import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { DiagramController } from "@/core/diagram/DiagramController";
import { executeAITool } from "@/features/ai-chat/utils/tool-executor";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

interface McpCommandPayload {
  uuid: string;
  tool: string;
  input: Record<string, unknown>;
}

async function dispatchMcpTool(
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

    listen<McpCommandPayload>("mcp:command", async (event) => {
      const { uuid, tool, input } = event.payload;
      const { result, error } = await dispatchMcpTool(tool, input);
      await invoke("mcp_ack", { uuid, result, error });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
