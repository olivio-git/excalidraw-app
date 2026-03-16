import type { RouteConfig } from "./types";

class RouteRegistryClass {
  private routes: Map<string, RouteConfig> = new Map();
  private flatCache: RouteConfig[] | null = null;

  register(routes: RouteConfig[]): void {
    this.flatCache = null;
    for (const route of routes) {
      this.routes.set(route.id, route);
      if (route.subRoutes) {
        this.register(route.subRoutes);
      }
    }
  }

  getRoute(id: string): RouteConfig | undefined {
    return this.routes.get(id);
  }

  getRouteByPath(path: string): RouteConfig | undefined {
    return this.getAllFlat().find((r) => r.path === path);
  }

  getAllFlat(): RouteConfig[] {
    if (this.flatCache) return this.flatCache;
    this.flatCache = Array.from(this.routes.values());
    return this.flatCache;
  }

  getTopLevel(): RouteConfig[] {
    return this.getAllFlat().filter(
      (r) => !this.getAllFlat().some((parent) => parent.subRoutes?.some((sub) => sub.id === r.id))
    );
  }

  search(query: string): RouteConfig[] {
    const lower = query.toLowerCase();
    return this.getAllFlat().filter((route) => {
      if (route.metadata?.hidden) return false;
      if (route.name.toLowerCase().includes(lower)) return true;
      if (route.description?.toLowerCase().includes(lower)) return true;
      if (route.metadata?.keywords?.some((k) => k.toLowerCase().includes(lower))) return true;
      if (route.path?.toLowerCase().includes(lower)) return true;
      return false;
    });
  }

  unregister(id: string): void {
    const route = this.routes.get(id);
    if (!route) return;
    // Remove subroutes first
    if (route.subRoutes) {
      for (const sub of route.subRoutes) {
        this.routes.delete(sub.id);
      }
    }
    this.routes.delete(id);
    this.flatCache = null;
  }

  clear(): void {
    this.routes.clear();
    this.flatCache = null;
  }
}

export const RouteRegistry = new RouteRegistryClass();
