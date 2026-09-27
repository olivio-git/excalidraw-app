import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiagramControllerClass } from "./DiagramController";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: vi.fn(),
}));

vi.mock("@/core/tabs/store/tab-store", () => ({
  useTabStore: {
    getState: vi.fn().mockReturnValue({
      tabs: [],
      activeTabId: null,
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeMockApi = () => ({
  updateScene: vi.fn(),
  getSceneElements: vi.fn(() => []),
  addFiles: vi.fn(),
  scrollToContent: vi.fn(),
  getAppState: vi.fn(() => ({})),
  getFiles: vi.fn(() => ({})),
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("DiagramController", () => {
  let controller: DiagramControllerClass;

  beforeEach(() => {
    controller = new DiagramControllerClass();
    vi.clearAllMocks();
  });

  // ── register / getApi ──────────────────────────────────────────────────────

  describe("register + getApi", () => {
    it("returns the registered api for the given instanceId", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      expect(controller.getApi("inst-1")).toBe(api);
    });

    it("returns undefined for an unknown instanceId", () => {
      expect(controller.getApi("unknown")).toBeUndefined();
    });

    it("replaces the api when registering with the same instanceId", () => {
      const api1 = makeMockApi();
      const api2 = makeMockApi();
      controller.register("inst-1", api1 as never);
      controller.register("inst-1", api2 as never);
      expect(controller.getApi("inst-1")).toBe(api2);
    });
  });

  // ── unregister ────────────────────────────────────────────────────────────

  describe("unregister", () => {
    it("getApi returns undefined after unregister", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      controller.unregister("inst-1");
      expect(controller.getApi("inst-1")).toBeUndefined();
    });

    it("unregister of unknown instanceId does not throw", () => {
      expect(() => controller.unregister("ghost")).not.toThrow();
    });
  });

  // ── waitForInstance ────────────────────────────────────────────────────────

  describe("waitForInstance", () => {
    it("resolves immediately when the instance is already registered", async () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      const result = await controller.waitForInstance("inst-1");
      expect(result).toBe(api);
    });

    it("resolves after a late register", async () => {
      const api = makeMockApi();
      const promise = controller.waitForInstance("inst-lazy", 500);
      // Register after the promise is created
      controller.register("inst-lazy", api as never);
      const result = await promise;
      expect(result).toBe(api);
    });

    it("multiple waiters for the same instanceId all resolve", async () => {
      const api = makeMockApi();
      const p1 = controller.waitForInstance("inst-multi", 500);
      const p2 = controller.waitForInstance("inst-multi", 500);
      controller.register("inst-multi", api as never);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(api);
      expect(r2).toBe(api);
    });

    it("rejects after the timeout when instance is never registered", async () => {
      await expect(controller.waitForInstance("never-comes", 50)).rejects.toThrow(
        'DiagramController: timed out waiting for instance "never-comes"'
      );
    });
  });

  // ── getElements ────────────────────────────────────────────────────────────

  describe("getElements", () => {
    it("returns empty array when instanceId is undefined", () => {
      expect(controller.getElements(undefined)).toEqual([]);
    });

    it("returns empty array when no api is registered for instanceId", () => {
      expect(controller.getElements("not-registered")).toEqual([]);
    });

    it("delegates to api.getSceneElements() when registered", () => {
      const mockElements = [{ id: "el-1", type: "rectangle" }];
      const api = makeMockApi();
      api.getSceneElements.mockReturnValue(mockElements as never);
      controller.register("inst-1", api as never);
      expect(controller.getElements("inst-1")).toBe(mockElements);
    });
  });

  // ── setElements ────────────────────────────────────────────────────────────

  describe("setElements", () => {
    it("calls api.updateScene with the new elements", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      const elements = [{ id: "el-1", type: "rectangle" }] as never;
      controller.setElements("inst-1", elements);
      expect(api.updateScene).toHaveBeenCalledWith({ elements });
    });

    it("does nothing when instanceId is undefined", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      controller.setElements(undefined, []);
      expect(api.updateScene).not.toHaveBeenCalled();
    });

    it("does nothing when api is not registered", () => {
      // no error should be thrown
      expect(() => controller.setElements("missing", [])).not.toThrow();
    });
  });

  // ── addElements ────────────────────────────────────────────────────────────

  describe("addElements", () => {
    it("merges new elements with existing ones", () => {
      const existing = [{ id: "el-existing", type: "ellipse" }];
      const api = makeMockApi();
      api.getSceneElements.mockReturnValue(existing as never);
      controller.register("inst-1", api as never);

      const newEls = [{ id: "el-new", type: "rectangle" }] as never;
      controller.addElements("inst-1", newEls);

      expect(api.updateScene).toHaveBeenCalledWith({
        elements: [...existing, ...newEls],
      });
    });

    it("does nothing when instanceId is undefined", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      controller.addElements(undefined, []);
      expect(api.updateScene).not.toHaveBeenCalled();
    });

    it("does nothing when api is not registered", () => {
      expect(() => controller.addElements("missing", [])).not.toThrow();
    });
  });

  // ── scrollToContent ────────────────────────────────────────────────────────

  describe("scrollToContent", () => {
    it("calls api.scrollToContent() when registered", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      controller.scrollToContent("inst-1");
      expect(api.scrollToContent).toHaveBeenCalledOnce();
    });

    it("does nothing when instanceId is undefined", () => {
      const api = makeMockApi();
      controller.register("inst-1", api as never);
      controller.scrollToContent(undefined);
      expect(api.scrollToContent).not.toHaveBeenCalled();
    });
  });

  // ── getActiveInstanceId ────────────────────────────────────────────────────

  describe("getActiveInstanceId", () => {
    it("returns undefined when no active tab", async () => {
      const { useTabStore } = await import("@/core/tabs/store/tab-store");
      vi.mocked(useTabStore.getState).mockReturnValue({
        tabs: [],
        activeTabId: null,
      } as never);
      expect(controller.getActiveInstanceId()).toBeUndefined();
    });

    it("returns undefined when active tab is not a diagram", async () => {
      const { useTabStore } = await import("@/core/tabs/store/tab-store");
      vi.mocked(useTabStore.getState).mockReturnValue({
        tabs: [{ id: "tab-1", routeId: "settings", instanceId: "settings-inst" }],
        activeTabId: "tab-1",
      } as never);
      expect(controller.getActiveInstanceId()).toBeUndefined();
    });

    it("returns the instanceId of the active diagram tab", async () => {
      const { useTabStore } = await import("@/core/tabs/store/tab-store");
      vi.mocked(useTabStore.getState).mockReturnValue({
        tabs: [{ id: "tab-1", routeId: "diagram", instanceId: "diagram-inst-abc" }],
        activeTabId: "tab-1",
      } as never);
      expect(controller.getActiveInstanceId()).toBe("diagram-inst-abc");
    });
  });
});
