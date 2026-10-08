import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAIPermissionStore } from "../store/ai-permission-store";
import { useToolPermission } from "./useToolPermission";

let checkPermission: ReturnType<typeof useToolPermission>["checkPermission"];

beforeEach(() => {
  useAIPermissionStore.getState().reset();
  checkPermission = renderHook(() => useToolPermission()).result.current.checkPermission;
});

describe("tool permissions", () => {
  it("shell commands ask every time, even after allowing everything", async () => {
    useAIPermissionStore.getState().setAllAllowed(true);
    const decision = checkPermission("terminal_run", { command: "docker ps" });
    const { open, request } = useAIPermissionStore.getState();
    expect(open).toBe(true);
    expect(request?.preview).toBe("docker ps");

    // "Allow always" on a command does not allow the next one.
    useAIPermissionStore.getState().setAllAllowed(false);
    useAIPermissionStore.getState()._settle({ decision: "allow-always" });
    expect(await decision).toEqual({ decision: "allow-always" });
    expect(useAIPermissionStore.getState().allAllowed).toBe(false);
    void checkPermission("terminal_run", { command: "docker rm -f x" });
    expect(useAIPermissionStore.getState().open).toBe(true);
  });

  it("other write tools follow the session decision", async () => {
    useAIPermissionStore.getState().setAllAllowed(true);
    expect(await checkPermission("flow3d_update", {})).toEqual({ decision: "auto-allow" });
    expect(useAIPermissionStore.getState().open).toBe(false);
  });
});
