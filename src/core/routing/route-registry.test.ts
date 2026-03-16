import { RouteRegistry } from "./route-registry";
import type { RouteConfig } from "./types";

const makeRoute = (
  overrides: Partial<RouteConfig> & { id: string; name: string }
): RouteConfig => ({
  type: "public",
  security: { requiresAuth: false },
  ...overrides,
});

beforeEach(() => {
  RouteRegistry.clear();
});

describe("RouteRegistry", () => {
  describe("register", () => {
    it("registers a single route and retrieves it by id", () => {
      const route = makeRoute({ id: "home", name: "Home", path: "/home" });
      RouteRegistry.register([route]);
      expect(RouteRegistry.getRoute("home")).toBe(route);
    });

    it("registers multiple routes in one call", () => {
      const routeA = makeRoute({ id: "a", name: "A" });
      const routeB = makeRoute({ id: "b", name: "B" });
      RouteRegistry.register([routeA, routeB]);
      expect(RouteRegistry.getRoute("a")).toBe(routeA);
      expect(RouteRegistry.getRoute("b")).toBe(routeB);
    });

    it("recursively registers subRoutes (child accessible by id)", () => {
      const child = makeRoute({ id: "child", name: "Child", path: "/parent/child" });
      const parent = makeRoute({
        id: "parent",
        name: "Parent",
        path: "/parent",
        subRoutes: [child],
      });
      RouteRegistry.register([parent]);
      expect(RouteRegistry.getRoute("child")).toBe(child);
    });

    it("invalidates flatCache on register (getAllFlat returns new routes)", () => {
      const routeA = makeRoute({ id: "a", name: "A" });
      RouteRegistry.register([routeA]);
      const first = RouteRegistry.getAllFlat();

      const routeB = makeRoute({ id: "b", name: "B" });
      RouteRegistry.register([routeB]);
      const second = RouteRegistry.getAllFlat();

      expect(second).not.toBe(first);
      expect(second.some((r) => r.id === "b")).toBe(true);
    });
  });

  describe("getRoute / getRouteByPath", () => {
    it("getRoute returns undefined for unknown id", () => {
      expect(RouteRegistry.getRoute("does-not-exist")).toBeUndefined();
    });

    it("getRouteByPath finds route by exact path", () => {
      const route = makeRoute({ id: "about", name: "About", path: "/about" });
      RouteRegistry.register([route]);
      expect(RouteRegistry.getRouteByPath("/about")).toBe(route);
    });

    it("getRouteByPath returns undefined for unknown path", () => {
      expect(RouteRegistry.getRouteByPath("/unknown-path")).toBeUndefined();
    });
  });

  describe("getAllFlat", () => {
    it("returns flat list including subroutes", () => {
      const child = makeRoute({ id: "child", name: "Child" });
      const parent = makeRoute({ id: "parent", name: "Parent", subRoutes: [child] });
      RouteRegistry.register([parent]);
      const flat = RouteRegistry.getAllFlat();
      expect(flat.some((r) => r.id === "parent")).toBe(true);
      expect(flat.some((r) => r.id === "child")).toBe(true);
    });

    it("uses cache on second call (same reference)", () => {
      const route = makeRoute({ id: "x", name: "X" });
      RouteRegistry.register([route]);
      const first = RouteRegistry.getAllFlat();
      const second = RouteRegistry.getAllFlat();
      expect(first).toBe(second);
    });

    it("cache is invalidated after register", () => {
      const routeA = makeRoute({ id: "a", name: "A" });
      RouteRegistry.register([routeA]);
      const before = RouteRegistry.getAllFlat();

      const routeB = makeRoute({ id: "b", name: "B" });
      RouteRegistry.register([routeB]);
      const after = RouteRegistry.getAllFlat();

      expect(after).not.toBe(before);
    });
  });

  describe("getTopLevel", () => {
    it("returns only root routes (not subroutes)", () => {
      const child = makeRoute({ id: "child", name: "Child" });
      const parent = makeRoute({ id: "parent", name: "Parent", subRoutes: [child] });
      RouteRegistry.register([parent]);
      const topLevel = RouteRegistry.getTopLevel();
      expect(topLevel.some((r) => r.id === "parent")).toBe(true);
      expect(topLevel.some((r) => r.id === "child")).toBe(false);
    });

    it("when all routes are top-level, returns all", () => {
      const routeA = makeRoute({ id: "a", name: "A" });
      const routeB = makeRoute({ id: "b", name: "B" });
      RouteRegistry.register([routeA, routeB]);
      const topLevel = RouteRegistry.getTopLevel();
      expect(topLevel).toHaveLength(2);
      expect(topLevel.some((r) => r.id === "a")).toBe(true);
      expect(topLevel.some((r) => r.id === "b")).toBe(true);
    });
  });

  describe("search", () => {
    it("finds route by name (case-insensitive substring)", () => {
      const route = makeRoute({ id: "dashboard", name: "Dashboard Overview" });
      RouteRegistry.register([route]);
      const results = RouteRegistry.search("dashboard");
      expect(results.some((r) => r.id === "dashboard")).toBe(true);
    });

    it("finds route by description", () => {
      const route = makeRoute({
        id: "settings",
        name: "Settings",
        description: "Manage user preferences",
      });
      RouteRegistry.register([route]);
      const results = RouteRegistry.search("preferences");
      expect(results.some((r) => r.id === "settings")).toBe(true);
    });

    it("excludes routes with metadata.hidden = true", () => {
      const hidden = makeRoute({
        id: "hidden-route",
        name: "Secret Page",
        metadata: { hidden: true },
      });
      RouteRegistry.register([hidden]);
      const results = RouteRegistry.search("secret");
      expect(results.some((r) => r.id === "hidden-route")).toBe(false);
    });

    it("finds by metadata.keywords", () => {
      const route = makeRoute({
        id: "profile",
        name: "Profile",
        metadata: { keywords: ["account", "user", "avatar"] },
      });
      RouteRegistry.register([route]);
      const results = RouteRegistry.search("avatar");
      expect(results.some((r) => r.id === "profile")).toBe(true);
    });
  });

  describe("unregister", () => {
    it("removes route and its subroutes from registry", () => {
      const child = makeRoute({ id: "child", name: "Child" });
      const parent = makeRoute({ id: "parent", name: "Parent", subRoutes: [child] });
      RouteRegistry.register([parent]);

      RouteRegistry.unregister("parent");

      expect(RouteRegistry.getRoute("parent")).toBeUndefined();
      expect(RouteRegistry.getRoute("child")).toBeUndefined();
    });
  });
});
