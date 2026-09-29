import type { Plugin, PluginAPI } from "@/plugins/types";
import { useTemplateGallery } from "./gallery-store";

function activate(api: PluginAPI): void {
  api.registerCommand("templates.new", () => useTemplateGallery.getState().show());
  api.registerCommand("templates.newFlow", () =>
    useTemplateGallery.getState().show({ kind: "flow" })
  );
}

export const templatesPlugin: Plugin = {
  manifest: {
    id: "templates",
    name: "Templates",
    version: "0.1.0",
    description: "Notes, diagrams and flows from ready-made templates",
    author: "excalidraw-app",
    commands: [
      { id: "templates.new", name: "File: New from Template…" },
      { id: "templates.newFlow", name: "Flow 3D: New Flow from Template…" },
    ],
  },
  activate,
};
