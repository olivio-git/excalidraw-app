import { RouteRegistry } from "@/core/routing/route-registry";
import {
  protectedRoutes,
  publicRoutes,
  diagramRoute,
  libraryDetailRoute,
} from "@/core/routing/route-config";

export function registerFeatureRoutes() {
  RouteRegistry.register(protectedRoutes);
  RouteRegistry.register(publicRoutes);
  RouteRegistry.register([diagramRoute]);
  RouteRegistry.register([libraryDetailRoute]);
}
