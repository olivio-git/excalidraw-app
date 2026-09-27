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

import {
  ensureIconThemesInitialized,
  getFileIconUrl,
  getFolderIconUrl,
  installVsixExtension,
  setActiveIconTheme,
  uninstallVsixExtension,
  useIconThemeState,
} from "./icon-theme-service";
import { renderHook, waitFor } from "@testing-library/react";

function buildVsix(version: string) {
  return zipSync({
    "extension/package.json": strToU8(
      JSON.stringify({
        name: "demo-icons",
        publisher: "acme",
        displayName: "Demo Icons",
        version,
        contributes: { iconThemes: [{ id: "demo", label: "Demo", path: "./dist/theme.json" }] },
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
    "extension/icons/ts.svg": strToU8("<svg id='ts'/>"),
    "extension/icons/folder.svg": strToU8("<svg id='folder'/>"),
  });
}

describe("icon theme service", () => {
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
  });
});
