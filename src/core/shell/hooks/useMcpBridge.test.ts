import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasPathTraversal, dispatchMcpTool } from "./useMcpBridge";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn((e) => e),
}));
vi.mock("@/core/diagram/DiagramController", () => ({
  DiagramController: {
    getActiveInstanceId: vi.fn(() => null),
    getElements: vi.fn(() => []),
    getApi: vi.fn(() => undefined),
    exportToSVG: vi.fn(),
  },
}));
vi.mock("@/features/ai-chat/utils/tool-executor", () => ({
  executeAITool: vi.fn(),
}));
vi.mock("@/core/shell/panels/file-handler-registry", () => ({
  fileHandlerRegistry: {
    resolveOrDefault: vi.fn(() => ({
      routeId: "diagram",
      displayName: (n: string) => n,
    })),
  },
}));
vi.mock("@/core/diagram/services/diagram-file.service", () => ({
  diagramFileService: {
    writeDiagram: vi.fn(),
    createNewDiagram: vi.fn(),
  },
}));

const mockWorkspaceStore = { workspaceDir: null as string | null };
const mockTabStore = {
  tabs: [] as {
    id: string;
    instanceId?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }[],
  activeTabId: null as string | null,
  addTab: vi.fn(),
  updateTab: vi.fn(),
  removeTab: vi.fn(),
};

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: () => mockWorkspaceStore },
}));
vi.mock("@/core/tabs/store/tab-store", () => ({
  useTabStore: { getState: () => mockTabStore },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceStore.workspaceDir = null;
  mockTabStore.tabs = [];
  mockTabStore.addTab.mockReset();
  mockTabStore.updateTab.mockReset();
  mockTabStore.removeTab.mockReset();
});

// ── hasPathTraversal ──────────────────────────────────────────────────────────

describe("hasPathTraversal", () => {
  it("returns false for normal relative paths", () => {
    expect(hasPathTraversal("diagrams/foo.excalidraw")).toBe(false);
    expect(hasPathTraversal("foo.excalidraw")).toBe(false);
    expect(hasPathTraversal("a/b/c")).toBe(false);
  });

  it("returns true for paths with ..", () => {
    expect(hasPathTraversal("../secret")).toBe(true);
    expect(hasPathTraversal("a/../../../etc/passwd")).toBe(true);
    expect(hasPathTraversal("foo/..")).toBe(true);
  });

  it("returns true for absolute paths starting with /", () => {
    expect(hasPathTraversal("/etc/passwd")).toBe(true);
    expect(hasPathTraversal("/home/user/file")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasPathTraversal("")).toBe(false);
  });
});

// ── delete_file — confirm guard ───────────────────────────────────────────────

describe("dispatchMcpTool — delete_file", () => {
  it("returns error when confirm is not provided", async () => {
    const res = await dispatchMcpTool("delete_file", { path: "foo.excalidraw" });
    expect(res.error).toContain("confirm must be true");
    expect(res.result).toBeNull();
  });

  it("returns error when confirm is false", async () => {
    const res = await dispatchMcpTool("delete_file", { path: "foo.excalidraw", confirm: false });
    expect(res.error).toContain("confirm must be true");
    expect(res.result).toBeNull();
  });

  it("returns error when no workspace is set", async () => {
    const res = await dispatchMcpTool("delete_file", { path: "foo.excalidraw", confirm: true });
    expect(res.error).toContain("No workspace directory set");
  });

  it("returns error for path traversal", async () => {
    mockWorkspaceStore.workspaceDir = "/workspace";
    const res = await dispatchMcpTool("delete_file", { path: "../secret", confirm: true });
    expect(res.error).toContain("path traversal not allowed");
  });

  it("closes open tab before deleting", async () => {
    const { remove } = await import("@tauri-apps/plugin-fs");
    vi.mocked(remove).mockResolvedValue(undefined);
    mockWorkspaceStore.workspaceDir = "/workspace";
    mockTabStore.tabs = [{ id: "tab-1", instanceId: "/workspace/foo.excalidraw" }];

    const res = await dispatchMcpTool("delete_file", { path: "foo.excalidraw", confirm: true });

    expect(mockTabStore.removeTab).toHaveBeenCalledWith("tab-1");
    expect(remove).toHaveBeenCalledWith("/workspace/foo.excalidraw", { recursive: true });
    expect(res.error).toBeNull();
  });
});

// ── create_folder — path traversal ───────────────────────────────────────────

describe("dispatchMcpTool — create_folder", () => {
  it("returns error for path traversal", async () => {
    mockWorkspaceStore.workspaceDir = "/workspace";
    const res = await dispatchMcpTool("create_folder", { path: "../../etc" });
    expect(res.error).toContain("path traversal not allowed");
  });

  it("returns error when no workspace is set", async () => {
    const res = await dispatchMcpTool("create_folder", { path: "new-folder" });
    expect(res.error).toContain("No workspace directory set");
  });
});

// ── rename_file — path traversal ─────────────────────────────────────────────

describe("dispatchMcpTool — rename_file", () => {
  it("returns error for path traversal in oldPath", async () => {
    mockWorkspaceStore.workspaceDir = "/workspace";
    const res = await dispatchMcpTool("rename_file", { oldPath: "../secret", newPath: "ok" });
    expect(res.error).toContain("path traversal not allowed");
  });

  it("returns error for path traversal in newPath", async () => {
    mockWorkspaceStore.workspaceDir = "/workspace";
    const res = await dispatchMcpTool("rename_file", { oldPath: "ok", newPath: "/abs/path" });
    expect(res.error).toContain("path traversal not allowed");
  });
});

// ── list_workspace — no workspace ─────────────────────────────────────────────

describe("dispatchMcpTool — list_workspace", () => {
  it("returns error when no workspace is set", async () => {
    const res = await dispatchMcpTool("list_workspace", {});
    expect(res.error).toContain("No workspace directory set");
  });
});

// ── create_diagram — path traversal ──────────────────────────────────────────

describe("dispatchMcpTool — create_diagram", () => {
  it("returns error for path traversal", async () => {
    mockWorkspaceStore.workspaceDir = "/workspace";
    const res = await dispatchMcpTool("create_diagram", { name: "../../evil.excalidraw" });
    expect(res.error).toContain("path traversal not allowed");
  });

  it("returns error when file already exists", async () => {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(readTextFile).mockResolvedValue("{}");
    mockWorkspaceStore.workspaceDir = "/workspace";
    const res = await dispatchMcpTool("create_diagram", { name: "existing.excalidraw" });
    expect(res.error).toContain("File already exists");
  });
});
