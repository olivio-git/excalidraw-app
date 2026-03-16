import { useAuthStore } from "../store/auth-store";

export function usePermissions() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const hasRole = useAuthStore((s) => s.hasRole);
  const hasAnyRole = useAuthStore((s) => s.hasAnyRole);
  const user = useAuthStore((s) => s.user);

  return {
    hasPermission,
    hasRole,
    hasAnyRole,
    permissions: user?.permissions ?? [],
    roles: user?.roles ?? [],
  };
}
