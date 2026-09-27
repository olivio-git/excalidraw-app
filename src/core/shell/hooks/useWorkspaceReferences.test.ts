import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { watch, type WatchEvent } from "@tauri-apps/plugin-fs";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceReferences } from "./useWorkspaceReferences";
import { scanWorkspaceReferences, type ReferenceIndex } from "../services/workspace-references";

vi.mock("@tauri-apps/plugin-fs", () => ({ watch: vi.fn() }));
vi.mock("../services/workspace-references", () => ({ scanWorkspaceReferences: vi.fn() }));
const index: ReferenceIndex = { references: [], files: 1, failures: 0, truncated: false };
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ workspaceDir: "/old" });
  vi.mocked(watch).mockResolvedValue(vi.fn());
});

describe("reference index lifetime", () => {
  it("rejects a previous workspace's late results", async () => {
    let finish: (value: ReferenceIndex) => void = () => undefined;
    vi.mocked(scanWorkspaceReferences).mockImplementation((path) =>
      path === "/old"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ...index, files: 2 })
    );
    const { result } = renderHook(() => useWorkspaceReferences());
    await waitFor(() => expect(scanWorkspaceReferences).toHaveBeenCalledOnce());
    await act(async () => {
      useWorkspaceStore.setState({ workspaceDir: "/new" });
    });
    await waitFor(() => expect(result.current.index?.files).toBe(2));
    await act(async () => finish(index));
    expect(result.current.index?.files).toBe(2);
  });
  it("ignores queued file events after unmounting", async () => {
    let event: ((value: WatchEvent) => void) | undefined;
    const stop = vi.fn();
    vi.mocked(watch).mockImplementation(async (_path, callback) => {
      event = callback;
      return stop;
    });
    vi.mocked(scanWorkspaceReferences).mockResolvedValue(index);
    const { result, unmount } = renderHook(() => useWorkspaceReferences());
    await waitFor(() => expect(result.current.index).not.toBeNull());
    unmount();
    vi.useFakeTimers();
    event?.({ type: "any", paths: ["/old/file.md"], attrs: {} });
    await act(() => vi.advanceTimersByTimeAsync(650));
    vi.useRealTimers();
    expect(stop).toHaveBeenCalled();
    expect(scanWorkspaceReferences).toHaveBeenCalledOnce();
  });
});
