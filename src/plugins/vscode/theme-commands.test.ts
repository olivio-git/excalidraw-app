import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setColor: vi.fn(async () => undefined),
  setIcon: vi.fn(async () => undefined),
}));

// Same as plugin-manager.test.ts: keep the real PluginManager without loading Excalidraw.
vi.mock("@excalidraw/excalidraw", () => ({ exportToSvg: vi.fn() }));
vi.mock("./color-theme-service", () => ({
  colorThemeKey: (ext: { id: string }, theme: { label?: string; path: string }) =>
    `${ext.id}/${theme.label ?? theme.path}`,
  setActiveColorTheme: mocks.setColor,
}));
vi.mock("./icon-theme-service", () => ({
  iconThemeKey: (ext: { id: string }, id: string) => `${ext.id}/${id}`,
  setActiveIconTheme: mocks.setIcon,
}));
vi.mock("./extension-registry", () => ({
  loadInstalledExtensions: vi.fn(async () => []),
  onInstalledExtensionsChanged: vi.fn(),
}));
vi.mock("@/shared/lib/notify", () => ({ notify: vi.fn() }));

import { PluginManager } from "@/plugins/plugin-manager";
import { syncThemeCommands } from "./theme-commands";
import type { InstalledExtension } from "./extension-storage";

const ext = (overrides: Partial<InstalledExtension>): InstalledExtension => ({
  id: "acme.theme",
  version: "1.0.0",
  displayName: "Acme",
  dir: "acme.theme-1.0.0",
  iconThemes: [],
  colorThemes: [],
  ...overrides,
});

const themeCommands = () =>
  PluginManager.getCommands().filter((command) => command.id.startsWith("vscode."));

describe("theme commands", () => {
  beforeEach(() => {
    mocks.setColor.mockClear();
    mocks.setIcon.mockClear();
  });

  it("adds one palette command per installed theme plus disable commands", async () => {
    syncThemeCommands([
      ext({
        id: "dracula-theme.theme-dracula",
        displayName: "Dracula Official",
        colorThemes: [
          { label: "Dracula", uiTheme: "vs-dark", path: "./a.json" },
          { label: "Dracula Soft", uiTheme: "vs-dark", path: "./b.json" },
        ],
      }),
      ext({
        id: "pkief.material-icon-theme",
        displayName: "Material Icon Theme",
        iconThemes: [{ id: "material-icon-theme", label: "Material Icon Theme", path: "./i.json" }],
      }),
    ]);

    expect(themeCommands().map((command) => command.name)).toEqual([
      "Tema de color: Dracula (Dracula Official)",
      "Tema de color: Dracula Soft (Dracula Official)",
      "Tema de iconos: Material Icon Theme (Material Icon Theme)",
      "Tema de color: desactivar (usar el de la app)",
      "Tema de iconos: desactivar (usar los de la app)",
    ]);

    await PluginManager.executeCommand(
      "vscode.colorTheme.select:dracula-theme.theme-dracula/Dracula Soft"
    );
    expect(mocks.setColor).toHaveBeenCalledWith("dracula-theme.theme-dracula/Dracula Soft");
    await PluginManager.executeCommand("vscode.iconTheme.disable");
    expect(mocks.setIcon).toHaveBeenCalledWith(null);
  });

  it("removes commands of uninstalled extensions", async () => {
    syncThemeCommands([]);
    expect(themeCommands()).toEqual([]);
    await PluginManager.executeCommand("vscode.colorTheme.disable");
    expect(mocks.setColor).not.toHaveBeenCalled();
  });
});
