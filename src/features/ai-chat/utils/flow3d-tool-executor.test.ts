import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { sampleFlow, serializeFlow, parseFlow } from "@/features/flow3d/model";
import { createFlowEditorStore } from "@/features/flow3d/editor-store";
import { flow3dRegistry } from "@/features/flow3d/flow3d-registry";
import { executeFlow3DTool } from "./flow3d-tool-executor";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@/core/shell/services/file-navigation", () => ({ openFileInWorkbench: vi.fn() }));
vi.mock("@/features/flow3d/app-stores", () => ({
  runHistory: { list: vi.fn(async () => []) },
  flowSecrets: { all: vi.fn(async () => ({})) },
}));

const steps = {
  nodes: [
    { id: "t", kind: "trigger", label: "Inicio" },
    { id: "a", kind: "action", label: "Hacer", config: { type: "command", command: "ls" } },
  ],
  edges: [{ id: "e", from: "t", to: "a" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ workspaceDir: "/ws" });
});

describe("flow3d chat tools", () => {
  it("creates a laid-out flow file and opens it", async () => {
    const result = await executeFlow3DTool("flow3d_create", { name: "Revisión diaria", ...steps });
    expect(result.isError).toBe(false);
    expect(vi.mocked(writeTextFile).mock.calls[0][0]).toBe("/ws/revision-diaria.flow3d");
    const written = parseFlow(vi.mocked(writeTextFile).mock.calls[0][1] as string);
    expect(written.nodes.map((n) => n.id)).toEqual(["t", "a"]);
    expect(written.nodes[1].position[0]).toBeGreaterThan(0);
    expect(openFileInWorkbench).toHaveBeenCalledWith("/ws/revision-diaria.flow3d");
  });

  it("reads a flow from disk with the format reference", async () => {
    vi.mocked(readTextFile).mockResolvedValue(serializeFlow(sampleFlow("Pedidos")));
    const result = await executeFlow3DTool("flow3d_read", { filePath: "pedidos.flow3d" });
    const data = JSON.parse(result.result);
    expect(data.filePath).toBe("/ws/pedidos.flow3d");
    expect(data.flow.nodes).toHaveLength(6);
    expect(data.lastRun).toContain("no se ha ejecutado");
    expect(data.format).toContain("StepConfig");
  });

  it("updates an open flow in its editor (undoable), keeping name and settings", async () => {
    const store = createFlowEditorStore({
      ...sampleFlow("Pedidos"),
      settings: { automation: true },
    });
    const unregister = flow3dRegistry.register("/ws/p.flow3d", { store, save: async () => true });
    const result = await executeFlow3DTool("flow3d_update", { filePath: "/ws/p.flow3d", ...steps });
    expect(result.isError).toBe(false);
    expect(store.getState().doc).toMatchObject({ name: "Pedidos", settings: { automation: true } });
    expect(store.getState().doc.nodes).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().doc.nodes).toHaveLength(6);
    expect(writeTextFile).not.toHaveBeenCalled();
    unregister();
  });

  it("explains what's missing", async () => {
    useWorkspaceStore.setState({ workspaceDir: null });
    expect((await executeFlow3DTool("flow3d_create", { name: "x", ...steps })).isError).toBe(true);
    expect((await executeFlow3DTool("flow3d_read", {})).result).toContain("No flow is open");
  });
});
