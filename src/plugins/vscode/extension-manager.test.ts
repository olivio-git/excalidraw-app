import { describe, it, expect, vi, beforeAll } from "vitest";
import { strToU8, zipSync } from "fflate";

const disk = vi.hoisted(() => new Map<string, Uint8Array | string>());

vi.mock("@tauri-apps/plugin-fs", () => {
  const hasPrefix = (prefix: string) =>
    [...disk.keys()].some((key) => key.startsWith(`${prefix}/`));
  return {
    BaseDirectory: { AppData: 14 },
    exists: vi.fn(async (path: string) => disk.has(path) || hasPrefix(path)),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => void disk.set(path, data)),
    writeTextFile: vi.fn(async (path: string, data: string) => void disk.set(path, data)),
    readFile: vi.fn(async (path: string) => {
      const data = disk.get(path);
      if (data === undefined) throw new Error(`ENOENT ${path}`);
      return typeof data === "string" ? strToU8(data) : data;
    }),
    readTextFile: vi.fn(async (path: string) => {
      const data = disk.get(path);
      if (data === undefined) throw new Error(`ENOENT ${path}`);
      return typeof data === "string" ? data : new TextDecoder().decode(data);
    }),
    remove: vi.fn(async (path: string) => {
      for (const key of [...disk.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) disk.delete(key);
      }
    }),
  };
});

// plugin-api pulls in Excalidraw, which does not load under jsdom.
vi.mock("@/plugins/plugin-api", () => ({ createPluginAPI: vi.fn() }));

import {
  ensureIconThemesInitialized,
  getFileIconUrl,
  getFolderIconUrl,
  setActiveIconTheme,
  useIconThemeState,
} from "./icon-theme-service";
import { setActiveColorTheme, useColorThemeState } from "./color-theme-service";
import { installVsixExtension, uninstallVsixExtension } from "./extension-manager";
import { useThemeStore } from "@/stores/themeStore";
import { PluginManager } from "@/plugins/plugin-manager";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { initExtensionContributions } from "./contribution-service";
import { loadInstalledExtensions } from "./extension-registry";
import { renderHook, waitFor } from "@testing-library/react";

function buildVsix(version: string) {
  return zipSync({
    "extension/package.json": strToU8(
      JSON.stringify({
        name: "demo-icons",
        publisher: "acme",
        displayName: "Demo Icons",
        version,
        contributes: {
          iconThemes: [{ id: "demo", label: "Demo", path: "./dist/theme.json" }],
          themes: [{ label: "Demo Light", uiTheme: "vs", path: "./themes/light.json" }],
        },
      })
    ),
    // JSONC on purpose: comments and trailing commas must be accepted.
    "extension/dist/theme.json": strToU8(`{
      // icons live next to dist/
      "iconDefinitions": {
        "ts": { "iconPath": "../icons/ts.svg" },
        "folder": { "iconPath": "../icons/folder.svg" },
      },
      "fileExtensions": { "ts": "ts" },
      "folder": "folder",
    }`),
    // Color theme with an `include` chain: the including file wins.
    "extension/themes/base.json": strToU8(
      JSON.stringify({ colors: { "editor.background": "#000000", "button.background": "#ff0000" } })
    ),
    "extension/themes/light.json": strToU8(
      JSON.stringify({
        include: "./base.json",
        colors: { "editor.background": "#ffffff", focusBorder: "#0000ff80" },
      })
    ),
    // Hidden files must not be written: Tauri's fs scope rejects them.
    "extension/.gitignore": strToU8("node_modules"),
    "extension/.vscode/settings.json": strToU8("{}"),
    "extension/icons/ts.svg": strToU8("<svg id='ts'/>"),
    "extension/icons/folder.svg": strToU8("<svg id='folder'/>"),
  });
}

describe("VS Code extension manager", () => {
  beforeAll(() => {
    let counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:icon-${++counter}`);
    URL.revokeObjectURL = vi.fn();
  });

  it("installs to disk (not localStorage) and lazily loads icons", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await ensureIconThemesInitialized();

    const extension = await installVsixExtension(buildVsix("1.0.0"));
    expect(extension.dir).toBe("acme.demo-icons-1.0.0");
    expect(disk.has("extensions/acme.demo-icons-1.0.0/icons/ts.svg")).toBe(true);
    expect([...disk.keys()].filter((key) => key.includes("/."))).toEqual([]);
    expect(JSON.parse(disk.get("extensions/extensions.json") as string)).toHaveLength(1);
    expect(setItem).not.toHaveBeenCalled();

    const { result } = renderHook(() => useIconThemeState());
    expect(result.current.activeKey).toBe("acme.demo-icons/demo");

    // First request kicks off the disk read; the URL is available after it resolves.
    expect(getFileIconUrl("main.ts")).toBeNull();
    await waitFor(() => expect(getFileIconUrl("main.ts")).toMatch(/^blob:/));
    expect(getFolderIconUrl("anything", false)).toBeNull();
    await waitFor(() => expect(getFolderIconUrl("anything", false)).toMatch(/^blob:/));
    // No mapping for .md and no default "file" icon → built-in fallback.
    expect(getFileIconUrl("README.md")).toBeNull();
  });

  it("applies the color theme as CSS variables and switches to its light/dark mode", async () => {
    const { result } = renderHook(() => useColorThemeState());
    await waitFor(() => expect(result.current.activeKey).toBe("acme.demo-icons/Demo Light"));

    const root = document.documentElement.style;
    expect(root.getPropertyValue("--background")).toBe("0 0% 100%");
    expect(root.getPropertyValue("--primary")).toBe("0 100% 50%");
    // #0000ff at 50% alpha composited over the white editor background.
    expect(root.getPropertyValue("--ring")).toBe("240 100% 74.9%");
    expect(useThemeStore.getState().resolvedTheme).toBe("light");

    await setActiveColorTheme(null);
    expect(root.getPropertyValue("--background")).toBe("");
    expect(root.getPropertyValue("--primary")).toBe("");
    await setActiveColorTheme("acme.demo-icons/Demo Light");
    expect(root.getPropertyValue("--background")).toBe("0 0% 100%");
  });

  it("can be disabled without falling back to another installed theme", async () => {
    await setActiveIconTheme(null);
    expect(getFileIconUrl("main.ts")).toBeNull();
    await setActiveIconTheme("acme.demo-icons/demo");
    getFileIconUrl("main.ts");
    await waitFor(() => expect(getFileIconUrl("main.ts")).toMatch(/^blob:/));
  });

  it("replaces the previous version on upgrade and cleans up on uninstall", async () => {
    await installVsixExtension(buildVsix("2.0.0"));
    const keys = [...disk.keys()];
    expect(keys.some((key) => key.includes("demo-icons-1.0.0"))).toBe(false);
    expect(keys.some((key) => key.includes("demo-icons-2.0.0"))).toBe(true);

    await uninstallVsixExtension("acme.demo-icons");
    expect([...disk.keys()].filter((key) => key.includes("demo-icons"))).toEqual([]);
    expect(JSON.parse(disk.get("extensions/extensions.json") as string)).toEqual([]);
    expect(getFileIconUrl("main.ts")).toBeNull();
    // Uninstalling the extension also removes its color theme.
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("does not switch themes when a non-theme extension ships one (PowerShell)", async () => {
    await installVsixExtension(buildVsix("3.0.0"));
    const { result } = renderHook(() => useColorThemeState());
    await waitFor(() => expect(result.current.activeKey).toBe("acme.demo-icons/Demo Light"));
    const background = document.documentElement.style.getPropertyValue("--background");

    await installVsixExtension(
      zipSync({
        "extension/package.json": strToU8(
          JSON.stringify({
            name: "powershell",
            publisher: "ms-vscode",
            version: "2025.4.0",
            categories: ["Programming Languages", "Debuggers"],
            contributes: {
              themes: [{ label: "PowerShell ISE", uiTheme: "vs", path: "./theme.json" }],
            },
          })
        ),
        "extension/theme.json": strToU8(
          JSON.stringify({ colors: { "editor.background": "#fafafa" } })
        ),
      })
    );

    // Installed and selectable, but the active theme is untouched.
    await waitFor(() =>
      expect(result.current.themes.map((theme) => theme.key)).toContain(
        "ms-vscode.powershell/PowerShell ISE"
      )
    );
    expect(result.current.activeKey).toBe("acme.demo-icons/Demo Light");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(background);
  });

  it("installs code extensions without themes and exposes their contributions", async () => {
    keybindingRegistry.registerDefault({
      commandId: "workbench.action.toggleSidebar",
      chord: keyNormalizer.normalizeChord("ctrl+b"),
      source: "builtin",
    });
    await initExtensionContributions();
    const extension = await installVsixExtension(
      zipSync({
        "extension/package.json": strToU8(
          JSON.stringify({
            name: "hello",
            publisher: "acme",
            version: "1.0.0",
            main: "./out/extension.js",
            activationEvents: ["onStartupFinished"],
            contributes: {
              commands: [{ command: "hello.say", title: "%cmd%", category: "Hello" }],
              keybindings: [
                { command: "hello.say", key: "ctrl+alt+h" },
                // Taken by the app (toggle sidebar): must not be hijacked.
                { command: "hello.say", key: "ctrl+b" },
              ],
              configuration: { properties: { "hello.name": { type: "string", default: "mundo" } } },
            },
          })
        ),
        "extension/package.nls.json": strToU8(JSON.stringify({ cmd: "Say Hello" })),
        "extension/out/extension.js": strToU8("exports.activate = () => {};"),
      })
    );

    expect(extension).toMatchObject({
      main: "out/extension.js",
      activationEvents: ["onStartupFinished"],
    });
    expect(extension.contributions.commands[0].title).toBe("Say Hello");
    expect((await loadInstalledExtensions()).map((ext) => ext.id)).toContain("acme.hello");

    expect(PluginManager.getCommands()).toContainEqual(
      expect.objectContaining({ id: "hello.say", name: "Hello: Say Hello" })
    );
    expect(keybindingRegistry.resolve(keyNormalizer.normalizeChord("ctrl+alt+h"))?.commandId).toBe(
      "hello.say"
    );
    expect(keybindingRegistry.resolve(keyNormalizer.normalizeChord("ctrl+b"))?.commandId).not.toBe(
      "hello.say"
    );

    await uninstallVsixExtension("acme.hello");
    expect(PluginManager.getCommands().map((c) => c.id)).not.toContain("hello.say");
    expect(keybindingRegistry.resolve(keyNormalizer.normalizeChord("ctrl+alt+h"))).toBeNull();
  });

  it("rejects web-only extensions with a clear message", async () => {
    await expect(
      installVsixExtension(
        zipSync({
          "extension/package.json": strToU8(
            JSON.stringify({ name: "web", publisher: "acme", browser: "./dist/web.js" })
          ),
        })
      )
    ).rejects.toThrow(/solo web/);
  });
});
