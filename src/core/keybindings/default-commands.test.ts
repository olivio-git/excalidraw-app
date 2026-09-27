import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeCoreCommands } from "./default-commands";
import { PluginManager } from "@/plugins/plugin-manager";
import workbench from "@/plugins/internal/workbench";
import { useExplorerUiStore } from "@/stores/explorerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { logger } from "@/core/logger";
import { registerDefaultKeybindings } from "./default-keybindings";
import { keyNormalizer } from "./key-normalizer";
import { keybindingRegistry } from "./keybinding-registry";

// Commands do not render a canvas; keep Excalidraw's browser-only bundle out of Node.
vi.mock("@excalidraw/excalidraw", () => ({ exportToSvg: vi.fn() }));
vi.mock("@/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
  initializeCoreCommands();
  PluginManager.register(workbench);
});

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ workspaceDir: "/workspace" });
  useExplorerUiStore.setState({ quickOpenOpen: false });
});

describe("workbench command lifecycle", () => {
  it("binds actual Alt+Arrow events to history commands", () => {
    registerDefaultKeybindings();
    const back = keyNormalizer.normalize(
      new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true })
    );
    const forward = keyNormalizer.normalize(
      new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true })
    );
    expect(keybindingRegistry.resolve([back!])?.commandId).toBe("workbench.action.navigateBack");
    expect(keybindingRegistry.resolve([forward!])?.commandId).toBe(
      "workbench.action.navigateForward"
    );
  });
  it("activates before React mounts without missing-handler warnings", async () => {
    expect(document.querySelector("[data-panel='sidebar']")).toBeNull();
    await PluginManager.activate("workbench");
    expect(PluginManager.isActive("workbench")).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("queues quick open independently of the explorer mount", async () => {
    await PluginManager.executeCommand("workbench.action.openQuickOpen");
    expect(useExplorerUiStore.getState().quickOpenOpen).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps the sidebar command registered when the UI listener unmounts", async () => {
    const toggle = vi.fn();
    window.addEventListener("workbench:toggle-sidebar", toggle);
    try {
      await PluginManager.executeCommand("workbench.action.toggleSidebar");
      expect(toggle).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("workbench:toggle-sidebar", toggle);
    }
    await PluginManager.executeCommand("workbench.action.toggleSidebar");
    expect(toggle).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not request quick open without a workspace", async () => {
    useWorkspaceStore.setState({ workspaceDir: null });
    await PluginManager.executeCommand("workbench.action.openQuickOpen");
    expect(useExplorerUiStore.getState().quickOpenOpen).toBe(false);
  });

  it("preserves the Excalidraw focus guard", async () => {
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    document.body.append(canvas);
    try {
      canvas.focus();
      await PluginManager.executeCommand("workbench.action.openQuickOpen");
      expect(useExplorerUiStore.getState().quickOpenOpen).toBe(false);
    } finally {
      canvas.remove();
    }
  });

  it("focuses the visible panel search instead of the retained hidden explorer", async () => {
    const sidebar = document.createElement("div");
    sidebar.dataset.panel = "sidebar";
    const hiddenExplorer = document.createElement("div");
    hiddenExplorer.dataset.explorerVisible = "false";
    const hiddenInput = document.createElement("input");
    hiddenInput.dataset.panelSearch = "";
    hiddenExplorer.append(hiddenInput);
    const visibleInput = document.createElement("input");
    visibleInput.dataset.panelSearch = "";
    sidebar.append(hiddenExplorer, visibleInput);
    document.body.append(sidebar);
    try {
      await PluginManager.executeCommand("workbench.action.focusSidebarSearch");
      expect(document.activeElement).toBe(visibleInput);
    } finally {
      sidebar.remove();
    }
  });
});
