import { PluginManager } from "@/plugins/plugin-manager";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";

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
  PluginManager.registerCommandHandler("workbench.action.openSettings", openSettingsHandler);

  PluginManager.registerCommandHandler("workbench.action.closeActiveTab", closeActiveTabHandler);

  PluginManager.registerCommandHandler("workbench.action.nextTab", nextTabHandler);

  PluginManager.registerCommandHandler("workbench.action.previousTab", previousTabHandler);
}
