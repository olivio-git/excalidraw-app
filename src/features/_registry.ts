import { RouteRegistry } from "@/core/routing/route-registry";
import { protectedRoutes, publicRoutes, diagramRoute } from "@/core/routing/route-config";

export function registerFeatureRoutes() {
  RouteRegistry.register(protectedRoutes);
  RouteRegistry.register(publicRoutes);
  RouteRegistry.register([diagramRoute]);
}
