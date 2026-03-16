import { useAuthStore } from "@/core/auth/store/auth-store";
import { Navigate } from "react-router";
import type { ReactNode } from "react";

interface RouteGuardProps {
  children: ReactNode;
  permissions?: string[];
  roles?: string[];
  requiresAuth?: boolean;
  redirectTo?: string;
}

export const RouteGuard = ({
  children,
  permissions,
  roles,
  requiresAuth = true,
  redirectTo = "/login",
}: RouteGuardProps) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (requiresAuth && !isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  if (roles && roles.length > 0 && user) {
    const hasRole = roles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-lg font-medium">Access Denied</p>
            <p className="text-sm mt-2">You don't have permission to view this page.</p>
          </div>
        </div>
      );
    }
  }

  if (permissions && permissions.length > 0 && user) {
    const hasPermission = permissions.some((p) => user.permissions.includes(p));
    if (!hasPermission) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-lg font-medium">Access Denied</p>
            <p className="text-sm mt-2">Missing required permissions.</p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
};
