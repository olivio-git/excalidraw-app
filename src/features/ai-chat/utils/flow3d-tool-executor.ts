import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import type { AIToolResult } from "../providers/types";

const ok = (result: unknown): AIToolResult => ({
  toolCallId: "",
  result: typeof result === "string" ? result : JSON.stringify(result),
  isError: false,
});
const fail = (message: string): AIToolResult => ({
  toolCallId: "",
  result: message,
  isError: true,
});

const isAbsolute = (path: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(path);

async function resolvePath(filePath: string | undefined): Promise<string | null> {
  if (filePath) {
    const root = useWorkspaceStore.getState().workspaceDir;
    return isAbsolute(filePath) || !root ? filePath : join(root, filePath);
  }
  const state = useTabStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return tab?.routeId === "flow3d" ? ((tab.instanceId ?? tab.metadata?.filePath) as string) : null;
}

const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "flujo";

/** Runs the flow3d_* chat tools (flow engine loaded on demand). */
export async function executeFlow3DTool(
  toolName: string,
  toolInput: unknown
): Promise<AIToolResult> {
  const input = (toolInput ?? {}) as {
    name?: string;
    folder?: string;
    filePath?: string;
    nodes?: unknown[];
    edges?: unknown[];
    payload?: unknown;
  };
  const [
    { flowFromAI, summarizeRun, FLOW_FORMAT_GUIDE },
    { parseFlow, serializeFlow },
    { flow3dRegistry },
    { runHistory },
  ] = await Promise.all([
    import("@/features/flow3d/ai-flow"),
    import("@/features/flow3d/model"),
    import("@/features/flow3d/flow3d-registry"),
    import("@/features/flow3d/app-stores"),
  ]);
  try {
    switch (toolName) {
      case "flow3d_create": {
        const root = useWorkspaceStore.getState().workspaceDir;
        if (!root) return fail("No workspace folder is open.");
        const doc = flowFromAI(
          { name: input.name, nodes: input.nodes, edges: input.edges },
          input.name
        );
        const dir = input.folder ? await join(root, input.folder) : root;
        if (input.folder) await mkdir(dir, { recursive: true }).catch(() => undefined);
        const path = await join(dir, `${slug(input.name ?? "flujo")}.flow3d`);
        await writeTextFile(path, serializeFlow(doc));
        openFileInWorkbench(path);
        return ok({ created: path, steps: doc.nodes.length, connections: doc.edges.length });
      }
      case "flow3d_read": {
        const path = await resolvePath(input.filePath);
        if (!path) return fail("No flow is open. Pass filePath.");
        const open = flow3dRegistry.get(path);
        const doc = open ? open.store.getState().doc : parseFlow(await readTextFile(path));
        const run = open?.store.getState().run ?? (await runHistory.list(path))[0]?.run ?? null;
        return ok({
          filePath: path,
          flow: {
            name: doc.name,
            nodes: doc.nodes,
            edges: doc.edges,
            automation: !!doc.settings?.automation,
          },
          lastRun: summarizeRun(doc, run),
          format: FLOW_FORMAT_GUIDE,
        });
      }
      case "flow3d_update": {
        const path = await resolvePath(input.filePath);
        if (!path) return fail("No flow is open. Pass filePath.");
        const open = flow3dRegistry.get(path);
        const current = open ? open.store.getState().doc : parseFlow(await readTextFile(path));
        const next = flowFromAI({ nodes: input.nodes, edges: input.edges }, current.name);
        const doc = {
          ...next,
          name: current.name,
          settings: current.settings,
          source: current.source,
        };
        if (open) {
          open.store.getState().setDoc(doc, { resetPlayback: true });
          open.store.getState().requestFit();
        } else {
          await writeTextFile(path, serializeFlow(doc));
        }
        return ok({
          updated: path,
          steps: doc.nodes.length,
          undo: open ? "Ctrl+Z in the editor" : undefined,
        });
      }
      case "flow3d_run": {
        const path = await resolvePath(input.filePath);
        if (!path) return fail("No flow is open. Pass filePath.");
        const [{ executeFlow }, { createRuntimeServices }, { flowSecrets }, history] =
          await Promise.all([
            import("@/features/flow3d/executor"),
            import("@/features/flow3d/runtime-services"),
            import("@/features/flow3d/app-stores"),
            import("@/features/flow3d/run-history"),
          ]);
        const open = flow3dRegistry.get(path);
        const doc = open ? open.store.getState().doc : parseFlow(await readTextFile(path));
        if (doc.nodes.length === 0) return fail("The flow has no steps yet.");
        const services = createRuntimeServices(path);
        const options = {
          secrets: await flowSecrets.all(),
          trigger: "manual" as const,
          ...(input.payload !== undefined && { payload: input.payload }),
        };
        // Open flows run in their tab, so the user watches it happen.
        const run =
          open && open.store.getState().run?.status !== "running"
            ? await open.store.getState().execute(services, options)
            : await executeFlow(doc, { services, ...options, edgeDuration: 0, minStepDuration: 0 });
        await runHistory.add(history.toHistoryEntry(path, run, history.flowSignature(doc)));
        return ok({ filePath: path, status: run.status, steps: summarizeRun(doc, run) });
      }
      default:
        return fail(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
