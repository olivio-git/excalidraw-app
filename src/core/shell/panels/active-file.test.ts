import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { selectActiveFilePath, withPaths } from "./active-file";
import { useStableHandlers } from "@/shared/hooks/useStableHandlers";
import type { useTabStore } from "@/core/tabs/store/tab-store";

type State = ReturnType<typeof useTabStore.getState>;

describe("explorer render helpers", () => {
  it("withPaths keeps the same Set when nothing is new", () => {
    const set = new Set(["/ws", "/ws/a"]);
    expect(withPaths(set, ["/ws/a"])).toBe(set);
    const next = withPaths(set, ["/ws/a", "/ws/b"]);
    expect(next).not.toBe(set);
    expect([...next]).toEqual(["/ws", "/ws/a", "/ws/b"]);
  });

  it("selects the active tab's file path", () => {
    const state = {
      activeTabId: "t2",
      tabs: [
        { id: "t1", metadata: { filePath: "/ws/a.md" } },
        { id: "t2", metadata: { filePath: "/ws/b.excalidraw" } },
      ],
    } as unknown as State;
    expect(selectActiveFilePath(state)).toBe("/ws/b.excalidraw");
    expect(selectActiveFilePath({ ...state, activeTabId: null } as State)).toBeUndefined();
  });

  it("useStableHandlers keeps identities and calls the latest handler", () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(
      ({ label }) =>
        useStableHandlers({ onOpen: (path: string) => calls.push(`${label}:${path}`) }),
      { initialProps: { label: "v1" } }
    );
    const first = result.current;
    rerender({ label: "v2" });
    expect(result.current).toBe(first);
    expect(result.current.onOpen).toBe(first.onOpen);
    result.current.onOpen("/ws/a.md");
    expect(calls).toEqual(["v2:/ws/a.md"]);
  });
});
