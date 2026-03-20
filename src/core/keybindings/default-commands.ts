import { PluginManager } from "@/plugins/plugin-manager";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { diagramFileService } from "@/core/diagram/services/diagram-file.service";

// ── Core command handlers ─────────────────────────────────────────────────────
//
// These handlers implement the built-in workbench commands registered in
// default-keybindings.ts. They are intentionally kept in a separate file to:
//
//   1. Keep App.tsx minimal (no direct store imports at the entry point).
//   2. Allow easy testing in isolation.
//   3. Keep default-keybindings.ts pure (no side effects beyond registry calls).
//
// Handlers access Zustand stores via .getState() — safe outside React components.
// Navigation is handled by mutating the tab store's activeTabId (the TabRouter
// component observes this and calls navigate() accordingly).

async function saveActiveDiagramHandler(): Promise<void> {
  const { activeTabId, getTab } = useTabStore.getState();
  if (!activeTabId) return;

  const tab = getTab(activeTabId);
  if (!tab || tab.routeId !== "diagram" || !tab.instanceId) return;

  await useDiagramStore.getState().saveDiagram(tab.instanceId);
}

async function newDiagramHandler(): Promise<void> {
  const workspaceDir = useWorkspaceStore.getState().workspaceDir;
  if (!workspaceDir) return;

  const { addTab } = useTabStore.getState();
  const name = `diagram-${Date.now()}`;
  const filePath = await diagramFileService.createNewDiagram(workspaceDir, name);
  const fileName = filePath.split("/").pop() ?? name;

  addTab({
    routeId: "diagram",
    path: "/diagram",
    title: fileName.replace(".excalidraw", ""),
    instanceId: filePath,
    metadata: { filePath },
  });
}

function openSettingsHandler(): void {
  const { tabs, addTab, setActiveTab } = useTabStore.getState();

  const route = RouteRegistry.getRoute("settings");
  if (!route) return;

  // Singleton guard: settings route is flagged singleton in route-config.ts.
  // useTabStore.addTab already handles this, but we skip re-adding for clarity.
  const existingTab = tabs.find((t) => t.routeId === "settings");
  if (existingTab) {
    setActiveTab(existingTab.id);
    return;
  }

  addTab({
    routeId: route.id,
    path: route.path,
    title: route.name,
    icon: route.icon,
  });
}

function closeActiveTabHandler(): void {
  const { activeTabId, removeTab } = useTabStore.getState();
  if (activeTabId) {
    removeTab(activeTabId);
  }
}

function nextTabHandler(): void {
  const { tabs, activeTabId, setActiveTab } = useTabStore.getState();
  if (tabs.length === 0 || !activeTabId) return;

  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  if (currentIndex === -1) return;

  const nextIndex = (currentIndex + 1) % tabs.length;
  setActiveTab(tabs[nextIndex].id);
}

function previousTabHandler(): void {
  const { tabs, activeTabId, setActiveTab } = useTabStore.getState();
  if (tabs.length === 0 || !activeTabId) return;

  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  if (currentIndex === -1) return;

  const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  setActiveTab(tabs[prevIndex].id);
}

function focusSidebarHandler(): void {
  const sidebar = document.querySelector<HTMLElement>("[data-panel='sidebar']");
  const explorerContainer = sidebar?.querySelector<HTMLElement>(
    ".flex.flex-col.h-full.overflow-hidden[tabindex='-1']"
  );
  (explorerContainer ?? sidebar)?.focus();
}

function focusEditorHandler(): void {
  document.querySelector<HTMLElement>("[data-panel='main']")?.focus();
}

function focusSidebarSearchHandler(): void {
  const sidebar = document.querySelector<HTMLElement>("[data-panel='sidebar']");
  const search = sidebar?.querySelector<HTMLInputElement>("[data-panel-search]");
  if (search) {
    search.focus();
    search.select();
  }
}

// ── Public initializer ────────────────────────────────────────────────────────

/**
 * Register all built-in command handlers with the PluginManager.
 *
 * MUST be called after registerDefaultKeybindings() and before plugins load
 * so the command palette and keybinding system can invoke these handlers.
 *
 * Note: workbench.action.showCommands is intentionally NOT registered here —
 * CommandPalette.tsx registers its own handler because it needs access to
 * local React state (the open/close toggle). See CommandPalette.tsx.
 */
export function initializeCoreCommands(): void {
  PluginManager.registerCommandHandler("diagram.action.save", saveActiveDiagramHandler);
  PluginManager.registerCommandHandler("diagram.action.newDiagram", newDiagramHandler);

  PluginManager.registerCommandHandler("workbench.action.openSettings", openSettingsHandler);

  PluginManager.registerCommandHandler("workbench.action.closeActiveTab", closeActiveTabHandler);

  PluginManager.registerCommandHandler("workbench.action.nextTab", nextTabHandler);

  PluginManager.registerCommandHandler("workbench.action.previousTab", previousTabHandler);

  PluginManager.registerCommandHandler("workbench.action.focusSidebar", focusSidebarHandler);

  PluginManager.registerCommandHandler("workbench.action.focusEditor", focusEditorHandler);

  PluginManager.registerCommandHandler(
    "workbench.action.focusSidebarSearch",
    focusSidebarSearchHandler
  );
}
