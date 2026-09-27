import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileClipboard } from "./useFileClipboard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  rename: vi.fn(),
  exists: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
  dirname: vi.fn((p: string) => Promise.resolve(p.substring(0, p.lastIndexOf("/")))),
  basename: vi.fn((p: string) => Promise.resolve(p.split("/").pop() ?? p)),
}));

vi.mock("@/shared/lib/notify", () => ({
  notify: vi.fn(),
}));

vi.mock("@/core/shell/panels/explorer-tab-sync", () => ({
  updateTabsAfterMove: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  exists,
  lstat,
  copyFile,
  rename,
  mkdir,
  readDir,
  remove,
  type FileInfo,
} from "@tauri-apps/plugin-fs";

const mockExists = vi.mocked(exists);
const mockCopyFile = vi.mocked(copyFile);
const mockRename = vi.mocked(rename);

/** Make stat resolve (file exists) for the given paths, reject otherwise. */
function mockFileExists(...existingPaths: string[]) {
  mockExists.mockImplementation(async (path) => existingPaths.includes(String(path)));
}

/** Make stat always reject (no files exist). */
function mockNoFilesExist() {
  mockExists.mockResolvedValue(false);
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockNoFilesExist();
  vi.mocked(lstat).mockResolvedValue({ isDirectory: false, isSymlink: false } as FileInfo);
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useFileClipboard", () => {
  it("copies nested folders once when both parent and child are selected", async () => {
    vi.mocked(lstat).mockImplementation(
      async (path) => ({ isDirectory: String(path) === "/ws/folder", isSymlink: false }) as FileInfo
    );
    vi.mocked(readDir).mockResolvedValue([
      { name: "a.txt", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    const refresh = vi.fn();
    const { result } = renderHook(() => useFileClipboard(refresh));
    act(() => result.current.copy(["/ws/folder", "/ws/folder/a.txt"]));
    await act(() => result.current.paste("/dest"));
    expect(mkdir).toHaveBeenCalledWith("/dest/folder");
    expect(copyFile).toHaveBeenCalledExactlyOnceWith("/ws/folder/a.txt", "/dest/folder/a.txt");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("cleans up a partial directory when a nested copy fails", async () => {
    vi.mocked(lstat).mockImplementation(
      async (path) => ({ isDirectory: String(path) === "/ws/folder", isSymlink: false }) as FileInfo
    );
    vi.mocked(readDir).mockResolvedValue([
      { name: "a.txt", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    vi.mocked(copyFile).mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useFileClipboard(vi.fn()));
    act(() => result.current.copy(["/ws/folder"]));
    await act(() => result.current.paste("/dest"));
    expect(remove).toHaveBeenCalledWith("/dest/folder", { recursive: true });
  });

  it("retains only failed cut entries for retry", async () => {
    vi.mocked(rename).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useFileClipboard(vi.fn()));
    act(() => result.current.cut(["/ws/a.txt", "/ws/b.txt"]));
    await act(() => result.current.paste("/dest"));
    expect(result.current.clipboardState).toEqual({ op: "cut", paths: ["/ws/b.txt"] });
  });

  it("refuses to paste a directory inside itself before touching disk", async () => {
    const { result } = renderHook(() => useFileClipboard(vi.fn()));
    act(() => result.current.copy(["/ws/folder"]));
    await act(() => result.current.paste("/ws/folder/nested"));
    expect(lstat).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("does not treat permission failures as an available destination", async () => {
    vi.mocked(exists).mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => useFileClipboard(vi.fn()));
    act(() => result.current.cut(["/ws/a.txt"]));
    await act(() => result.current.paste("/dest"));
    expect(rename).not.toHaveBeenCalled();
    expect(result.current.clipboardState?.paths).toEqual(["/ws/a.txt"]);
  });

  it("preserves dotted directory names when resolving collisions", async () => {
    vi.mocked(lstat).mockResolvedValue({ isDirectory: true, isSymlink: false } as FileInfo);
    mockFileExists("/dest/release.v2");
    vi.mocked(readDir).mockResolvedValue([]);
    const { result } = renderHook(() => useFileClipboard(vi.fn()));
    act(() => result.current.copy(["/ws/release.v2"]));
    await act(() => result.current.paste("/dest"));
    expect(mkdir).toHaveBeenCalledWith("/dest/release.v2 copy");
  });

  it("does not follow symlinks during recursive copies", async () => {
    vi.mocked(lstat).mockResolvedValue({ isDirectory: true, isSymlink: true } as FileInfo);
    const { result } = renderHook(() => useFileClipboard(vi.fn()));
    act(() => result.current.copy(["/ws/link"]));
    await act(() => result.current.paste("/dest"));
    expect(readDir).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // cut
  // -------------------------------------------------------------------------
  describe("cut", () => {
    it("sets clipboard to { op: 'cut', paths }", () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.cut(["/ws/a.excalidraw"]);
      });

      expect(result.current.clipboardState).toEqual({
        op: "cut",
        paths: ["/ws/a.excalidraw"],
      });
    });
  });

  // -------------------------------------------------------------------------
  // copy
  // -------------------------------------------------------------------------
  describe("copy", () => {
    it("sets clipboard to { op: 'copy', paths }", () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/b.excalidraw", "/ws/c.excalidraw"]);
      });

      expect(result.current.clipboardState).toEqual({
        op: "copy",
        paths: ["/ws/b.excalidraw", "/ws/c.excalidraw"],
      });
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------
  describe("clear", () => {
    it("sets clipboard to null", () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/a.excalidraw"]);
      });
      expect(result.current.clipboardState).not.toBeNull();

      act(() => {
        result.current.clear();
      });

      expect(result.current.clipboardState).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // isCut
  // -------------------------------------------------------------------------
  describe("isCut", () => {
    it("returns true when path is in cut clipboard", () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.cut(["/ws/a.excalidraw"]);
      });

      expect(result.current.isCut("/ws/a.excalidraw")).toBe(true);
    });

    it("returns false when path is in copy clipboard (not cut)", () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/a.excalidraw"]);
      });

      expect(result.current.isCut("/ws/a.excalidraw")).toBe(false);
    });

    it("returns false when clipboard is null", () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      expect(result.current.isCut("/ws/a.excalidraw")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // paste — copy operation
  // -------------------------------------------------------------------------
  describe("paste (copy)", () => {
    it("calls copyFile for copy operation", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      mockNoFilesExist();
      mockCopyFile.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(mockCopyFile).toHaveBeenCalledWith("/ws/src/a.excalidraw", "/ws/dest/a.excalidraw");
    });

    it("keeps clipboard after copy paste", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      mockNoFilesExist();
      mockCopyFile.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(result.current.clipboardState).not.toBeNull();
    });

    it("auto-suffixes filename on collision (copy)", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      // Simulate: dest/a.excalidraw exists, dest/a copy.excalidraw does not
      mockFileExists("/ws/dest/a.excalidraw");
      mockCopyFile.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(mockCopyFile).toHaveBeenCalledWith(
        "/ws/src/a.excalidraw",
        "/ws/dest/a copy.excalidraw"
      );
    });

    it("increments copy suffix when multiple collisions exist", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      // Both original and "copy" exist — should use "copy 2"
      mockFileExists("/ws/dest/a.excalidraw", "/ws/dest/a copy.excalidraw");
      mockCopyFile.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.copy(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(mockCopyFile).toHaveBeenCalledWith(
        "/ws/src/a.excalidraw",
        "/ws/dest/a copy 2.excalidraw"
      );
    });
  });

  // -------------------------------------------------------------------------
  // paste — cut operation
  // -------------------------------------------------------------------------
  describe("paste (cut)", () => {
    it("calls rename for cut operation when src and dest dirs differ", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      mockNoFilesExist();
      mockRename.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.cut(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(mockRename).toHaveBeenCalledWith("/ws/src/a.excalidraw", "/ws/dest/a.excalidraw");
    });

    it("clears clipboard after successful cut paste", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      mockNoFilesExist();
      mockRename.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.cut(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(result.current.clipboardState).toBeNull();
    });

    it("does NOT call rename when src and dest dirs are the same", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      mockNoFilesExist();
      mockRename.mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileClipboard(onRefresh));

      act(() => {
        result.current.cut(["/ws/src/a.excalidraw"]);
      });

      await act(async () => {
        await result.current.paste("/ws/src");
      });

      expect(mockRename).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // paste — no clipboard
  // -------------------------------------------------------------------------
  describe("paste (no clipboard)", () => {
    it("is a no-op when clipboard is null", async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFileClipboard(onRefresh));

      await act(async () => {
        await result.current.paste("/ws/dest");
      });

      expect(mockCopyFile).not.toHaveBeenCalled();
      expect(mockRename).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });
  });
});
