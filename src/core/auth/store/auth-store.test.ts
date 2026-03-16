import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./auth-store";
import type { User } from "../types";

const mockUser: User = {
  id: "1",
  name: "Test User",
  email: "test@test.com",
  roles: ["admin", "editor"],
  permissions: ["read", "write"],
};

describe("AuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  describe("Initial state", () => {
    it("starts with user=null, token=null, isAuthenticated=false, isLoading=false", () => {
      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });

  describe("login", () => {
    it("sets user, token, isAuthenticated=true, isLoading=false", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "my-token");

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.token).toBe("my-token");
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it("overwrites previous auth state on re-login", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "first-token");

      const newUser: User = {
        id: "2",
        name: "Another User",
        email: "another@test.com",
        roles: ["viewer"],
        permissions: ["read"],
      };

      login(newUser, "second-token");

      const state = useAuthStore.getState();
      expect(state.user).toEqual(newUser);
      expect(state.token).toBe("second-token");
      expect(state.isAuthenticated).toBe(true);
    });
  });

  describe("logout", () => {
    it("clears user, token, sets isAuthenticated=false", () => {
      const { login, logout } = useAuthStore.getState();

      login(mockUser, "my-token");
      logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it("sets isLoading=false on logout", () => {
      const { login, setLoading, logout } = useAuthStore.getState();

      login(mockUser, "my-token");
      setLoading(true);
      logout();

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
    });
  });

  describe("setLoading", () => {
    it("sets isLoading to true", () => {
      const { setLoading } = useAuthStore.getState();

      setLoading(true);

      expect(useAuthStore.getState().isLoading).toBe(true);
    });

    it("sets isLoading back to false", () => {
      const { setLoading } = useAuthStore.getState();

      setLoading(true);
      setLoading(false);

      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe("hasPermission", () => {
    it("returns false when not authenticated (user=null)", () => {
      const { hasPermission } = useAuthStore.getState();

      expect(hasPermission("read")).toBe(false);
    });

    it("returns true when user has the permission", () => {
      const { login, hasPermission } = useAuthStore.getState();

      login(mockUser, "my-token");

      expect(useAuthStore.getState().hasPermission("read")).toBe(true);
      expect(useAuthStore.getState().hasPermission("write")).toBe(true);
    });

    it("returns false when user does not have the permission", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "my-token");

      expect(useAuthStore.getState().hasPermission("delete")).toBe(false);
    });
  });

  describe("hasRole", () => {
    it("returns false when user=null", () => {
      const { hasRole } = useAuthStore.getState();

      expect(hasRole("admin")).toBe(false);
    });

    it("returns true when user has the role", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "my-token");

      expect(useAuthStore.getState().hasRole("admin")).toBe(true);
      expect(useAuthStore.getState().hasRole("editor")).toBe(true);
    });

    it("returns false when user does not have the role", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "my-token");

      expect(useAuthStore.getState().hasRole("viewer")).toBe(false);
    });
  });

  describe("hasAnyRole", () => {
    it("returns false when user=null", () => {
      const { hasAnyRole } = useAuthStore.getState();

      expect(hasAnyRole(["admin", "editor"])).toBe(false);
    });

    it("returns true when user has at least one of the roles", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "my-token");

      expect(useAuthStore.getState().hasAnyRole(["admin", "superuser"])).toBe(true);
      expect(useAuthStore.getState().hasAnyRole(["viewer", "editor"])).toBe(true);
    });

    it("returns false when user has none of the roles", () => {
      const { login } = useAuthStore.getState();

      login(mockUser, "my-token");

      expect(useAuthStore.getState().hasAnyRole(["viewer", "superuser"])).toBe(false);
    });
  });
});
