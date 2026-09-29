import { readDir, readTextFile, watch } from "@tauri-apps/plugin-fs";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import { FlowAutomation } from "./automation";
import { executeFlow } from "./executor";
import { parseFlow } from "./model";
import { flow3dRegistry } from "./flow3d-registry";
import { createRuntimeServices, resolveStepPath } from "./runtime-services";
import { flowSecrets, runHistory } from "./app-stores";
import { flowSignature, toHistoryEntry } from "./run-history";

const join = (dir: string, name: string) =>
  `${dir.replace(/[\\/]$/, "")}${dir.includes("\\") && !dir.includes("/") ? "\\" : "/"}${name}`;

async function listFlows(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue = [root];
  let directories = 0;
  while (queue.length > 0 && found.length < 500 && directories++ < 3000) {
    const dir = queue.shift()!;
    try {
      for (const entry of await readDir(dir)) {
        if (entry.isSymlink || [".git", "node_modules"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory) queue.push(path);
        else if (/\.flow3d$/i.test(entry.name)) found.push(path);
      }
    } catch {
      // Unreadable folders are skipped.
    }
  }
  return found;
}

/** The app's automation service: arms the flows of the open workspace. */
export const flowAutomation = new FlowAutomation({
  listFlows,
  readFlow: async (path) => parseFlow(await readTextFile(path)),
  resolvePath: resolveStepPath,
  watch: async (path, onChange) =>
    watch(
      path,
      (event) => {
        if (typeof event.type === "object" && "access" in event.type) return;
        onChange(event.paths);
      },
      { recursive: true, delayMs: 300 }
    ),
  run: async (flowPath, doc, nodeId, trigger, payload) => {
    const secrets = await flowSecrets.all();
    const services = createRuntimeServices(flowPath);
    const open = flow3dRegistry.get(flowPath);
    const options = { payload, startAt: [nodeId], trigger, secrets };
    // An open flow runs in its tab (you see it happen); otherwise in the background, unpaced.
    const run =
      open && open.store.getState().run?.status !== "running"
        ? await open.store.getState().execute(services, options)
        : await executeFlow(doc, { services, ...options, edgeDuration: 0, minStepDuration: 0 });
    await runHistory.add(toHistoryEntry(flowPath, run, flowSignature(doc)));
    if (run.status === "error") {
      const failed = Object.values(run.steps).find((s) => s.status === "error");
      const step = doc.nodes.find((n) => n.id === failed?.nodeId);
      notify(`Automatización «${doc.name ?? flowPath.split(/[\\/]/).pop()}» falló`, {
        type: "error",
        description: `${step?.label ?? failed?.nodeId}: ${failed?.error ?? ""}`,
      });
    }
  },
});

let started = false;

/** Follow the workspace: arm its flows, re-arm when it changes. */
export function startFlowAutomation(): () => void {
  if (started) return () => undefined;
  started = true;
  let current = useWorkspaceStore.getState().workspaceDir;
  if (current) void flowAutomation.start(current);
  const unsubscribe = useWorkspaceStore.subscribe((state) => {
    if (state.workspaceDir === current) return;
    current = state.workspaceDir;
    if (current) void flowAutomation.start(current);
    else void flowAutomation.stop();
  });
  return () => {
    started = false;
    unsubscribe();
    void flowAutomation.stop();
  };
}
