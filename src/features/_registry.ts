import { RouteRegistry } from "@/core/routing/route-registry";
import { protectedRoutes, publicRoutes } from "@/core/routing/route-config";

export function registerFeatureRoutes() {
  RouteRegistry.register(protectedRoutes);
  RouteRegistry.register(publicRoutes);
}
