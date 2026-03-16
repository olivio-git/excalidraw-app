import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInitialize = vi.fn();
const mockDispose = vi.fn();

vi.mock("../keybinding-service", () => ({
  keybindingService: {
    initialize: mockInitialize,
    dispose: mockDispose,
    handleKeyEvent: vi.fn().mockReturnValue(false),
  },
}));

const mockHydrateRegistry = vi.fn();

vi.mock("../store/keybinding-store", () => ({
  useKeybindingStore: {
    getState: vi.fn(() => ({
      hydrateRegistry: mockHydrateRegistry,
    })),
  },
}));

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("useKeybindingBridge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the module-level _mounted flag between tests so each test gets
    // a clean slate. We do this by resetting the module cache.
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.mock("../keybinding-service", () => ({
      keybindingService: {
        initialize: mockInitialize,
        dispose: mockDispose,
        handleKeyEvent: vi.fn().mockReturnValue(false),
      },
    }));

    vi.mock("../store/keybinding-store", () => ({
      useKeybindingStore: {
        getState: vi.fn(() => ({
          hydrateRegistry: mockHydrateRegistry,
        })),
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helper to get a fresh hook module ────────────────────────────────────

  async function getHook() {
    const { useKeybindingBridge } = await import("./useKeybindingBridge");
    return useKeybindingBridge;
  }

  // ── initialize called on mount ────────────────────────────────────────────

  describe("on mount", () => {
    it("calls keybindingService.initialize() once", async () => {
      const useKeybindingBridge = await getHook();
      renderHook(() => useKeybindingBridge());

      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it("calls hydrateRegistry() once", async () => {
      const useKeybindingBridge = await getHook();
      renderHook(() => useKeybindingBridge());

      expect(mockHydrateRegistry).toHaveBeenCalledTimes(1);
    });

    it("calls hydrateRegistry() after initialize()", async () => {
      const callOrder: string[] = [];
      mockInitialize.mockImplementation(() => {
        callOrder.push("initialize");
      });
      mockHydrateRegistry.mockImplementation(() => {
        callOrder.push("hydrateRegistry");
      });

      const useKeybindingBridge = await getHook();
      renderHook(() => useKeybindingBridge());

      expect(callOrder).toEqual(["initialize", "hydrateRegistry"]);
    });
  });

  // ── dispose called on unmount ─────────────────────────────────────────────

  describe("on unmount", () => {
    it("calls keybindingService.dispose() when the hook unmounts", async () => {
      const useKeybindingBridge = await getHook();
      const { unmount } = renderHook(() => useKeybindingBridge());

      expect(mockDispose).not.toHaveBeenCalled();

      unmount();

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });
  });

  // ── double-mount idempotency ──────────────────────────────────────────────

  describe("double-mount idempotency", () => {
    it("does NOT call initialize() a second time when mounted while already active", async () => {
      const useKeybindingBridge = await getHook();

      // First mount — initializes
      const { unmount: unmount1 } = renderHook(() => useKeybindingBridge());
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      // Second mount without unmounting first (simulates concurrent mounts)
      renderHook(() => useKeybindingBridge());
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      unmount1();
    });

    it("does NOT call hydrateRegistry() a second time on double-mount", async () => {
      const useKeybindingBridge = await getHook();

      const { unmount: unmount1 } = renderHook(() => useKeybindingBridge());
      expect(mockHydrateRegistry).toHaveBeenCalledTimes(1);

      renderHook(() => useKeybindingBridge());
      expect(mockHydrateRegistry).toHaveBeenCalledTimes(1);

      unmount1();
    });

    it("re-initializes after a full unmount cycle", async () => {
      const useKeybindingBridge = await getHook();

      const { unmount } = renderHook(() => useKeybindingBridge());
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      unmount();
      expect(mockDispose).toHaveBeenCalledTimes(1);

      // Second mount after proper unmount — should initialize again
      renderHook(() => useKeybindingBridge());
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });
  });
});
