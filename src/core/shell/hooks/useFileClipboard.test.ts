import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileClipboard } from "./useFileClipboard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
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

import { stat, copyFile, rename } from "@tauri-apps/plugin-fs";

const mockStat = vi.mocked(stat);
const mockCopyFile = vi.mocked(copyFile);
const mockRename = vi.mocked(rename);

/** Make stat resolve (file exists) for the given paths, reject otherwise. */
function mockFileExists(...existingPaths: string[]) {
  mockStat.mockImplementation((path: string) => {
    if (existingPaths.includes(path)) {
      return Promise.resolve({ size: 0 } as any);
    }
    return Promise.reject(new Error("ENOENT"));
  });
}

/** Make stat always reject (no files exist). */
function mockNoFilesExist() {
  mockStat.mockRejectedValue(new Error("ENOENT"));
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockNoFilesExist();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useFileClipboard", () => {
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
