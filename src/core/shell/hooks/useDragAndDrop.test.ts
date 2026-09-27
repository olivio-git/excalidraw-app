import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { exists, lstat, rename, type FileInfo } from "@tauri-apps/plugin-fs";
import { useDragAndDrop } from "./useDragAndDrop";
import { updateTabsAfterMove } from "@/core/shell/panels/explorer-tab-sync";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(), lstat: vi.fn(), rename: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
  dirname: (path: string) => Promise.resolve(path.slice(0, path.lastIndexOf("/"))),
  basename: (path: string) => Promise.resolve(path.split("/").pop()),
}));
vi.mock("@/shared/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/core/shell/panels/explorer-tab-sync", () => ({ updateTabsAfterMove: vi.fn() }));

function drop(path: string, destination: string, selectedPaths = [path]): DragEndEvent {
  return {
    activatorEvent: new Event("pointerup"),
    collisions: [],
    delta: { x: 0, y: 0 },
    active: {
      id: path,
      data: { current: { type: "explorer-node", path, selectedPaths } },
      rect: { current: { initial: null, translated: null } },
    },
    over: {
      id: destination,
      rect: document.createElement("div").getBoundingClientRect(),
      data: { current: undefined },
      disabled: false,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exists).mockResolvedValue(false);
  vi.mocked(lstat).mockResolvedValue({ isDirectory: false } as FileInfo);
});

describe("explorer drag moves", () => {
  it("moves to the workspace root and updates open tabs", async () => {
    const { result } = renderHook(() => useDragAndDrop());
    const refresh = vi.fn();
    await act(() => result.current.handleDragEnd(drop("/ws/folder/a.txt", "/ws"), refresh));
    expect(rename).toHaveBeenCalledWith("/ws/folder/a.txt", "/ws/a.txt");
    expect(updateTabsAfterMove).toHaveBeenCalledWith("/ws/folder/a.txt", "/ws/a.txt");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("renames a colliding destination instead of overwriting it", async () => {
    vi.mocked(exists).mockImplementation(async (path) => path === "/ws/a.txt");
    const { result } = renderHook(() => useDragAndDrop());
    await act(() => result.current.handleDragEnd(drop("/ws/folder/a.txt", "/ws"), vi.fn()));
    expect(rename).toHaveBeenCalledWith("/ws/folder/a.txt", "/ws/a copy.txt");
  });

  it("moves selected parents once and excludes descendants", async () => {
    const { result } = renderHook(() => useDragAndDrop());
    await act(() =>
      result.current.handleDragEnd(
        drop("/ws/parent", "/dest", ["/ws/parent", "/ws/parent/a.txt"]),
        vi.fn()
      )
    );
    expect(rename).toHaveBeenCalledExactlyOnceWith("/ws/parent", "/dest/parent");
  });

  it("checks every selected path, even when the dragged item is already in the destination", async () => {
    const { result } = renderHook(() => useDragAndDrop());
    await act(() =>
      result.current.handleDragEnd(drop("/ws/a.txt", "/ws", ["/ws/a.txt", "/other/b.txt"]), vi.fn())
    );
    expect(rename).toHaveBeenCalledExactlyOnceWith("/other/b.txt", "/ws/b.txt");
  });

  it("never moves a directory into one of its descendants", async () => {
    const { result } = renderHook(() => useDragAndDrop());
    await act(() => result.current.handleDragEnd(drop("/ws/folder", "/ws/folder/nested"), vi.fn()));
    expect(rename).not.toHaveBeenCalled();
  });
});
