import { definePlugin } from "@/plugins/sdk";

/**
 * Workbench built-in plugin.
 *
 * Purpose: make all core workbench commands discoverable in the command palette.
 * Handlers are registered in default-commands.ts (initializeCoreCommands),
 * which runs before plugins load. This plugin only declares the manifest so
 * buildCommandItems() in CommandPalette can resolve human-readable labels.
 *
 * Do NOT register command handlers here — they are already registered.
 */
export default definePlugin({
  manifest: {
    id: "workbench",
    name: "Workbench",
    version: "1.0.0",
    description: "Built-in workbench commands",
    author: "oliviodev",
    commands: [
      // ── Diagram ──────────────────────────────────────────────────────────
      { id: "diagram.action.save", name: "Save Diagram", category: "Diagram" },
      { id: "diagram.action.newDiagram", name: "New Diagram", category: "Diagram" },

      // ── Navigation ───────────────────────────────────────────────────────
      { id: "workbench.action.openSettings", name: "Open Settings", category: "Navigation" },
      {
        id: "workbench.action.openPluginAdmin",
        name: "Open Plugin Administration",
        category: "Navigation",
      },
      { id: "settings.action.openAITab", name: "Open AI Settings", category: "Navigation" },
      { id: "workbench.action.closeActiveTab", name: "Close Active Tab", category: "Navigation" },
      { id: "workbench.action.nextTab", name: "Next Tab", category: "Navigation" },
      { id: "workbench.action.previousTab", name: "Previous Tab", category: "Navigation" },

      // ── View ─────────────────────────────────────────────────────────────
      { id: "workbench.action.toggleSidebar", name: "Toggle Sidebar", category: "View" },
      { id: "workbench.action.focusSidebar", name: "Focus Sidebar", category: "View" },
      { id: "workbench.action.focusEditor", name: "Focus Editor", category: "View" },
      { id: "workbench.action.focusSidebarSearch", name: "Focus Sidebar Search", category: "View" },
      { id: "workbench.action.openQuickOpen", name: "Open Quick Open", category: "View" },

      // ── Preferences ──────────────────────────────────────────────────────
      {
        id: "workbench.action.changeLanguage",
        name: "Toggle Language (EN / ES)",
        category: "Preferences",
      },
    ],
  },

  activate() {
    // No handlers — all registered in initializeCoreCommands() (default-commands.ts).
  },

  deactivate() {},
});
