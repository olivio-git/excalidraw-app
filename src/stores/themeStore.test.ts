import { describe, it, expect, beforeEach, vi } from "vitest";
import { useThemeStore } from "./themeStore";

beforeEach(() => {
  useThemeStore.setState({ theme: "light", resolvedTheme: "light" });
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("ThemeStore", () => {
  describe("Initial state", () => {
    it('starts with theme="light" and resolvedTheme="light"', () => {
      const state = useThemeStore.getState();

      expect(state.theme).toBe("light");
      expect(state.resolvedTheme).toBe("light");
    });
  });

  describe("setTheme - light/dark", () => {
    it('setTheme("dark") sets theme="dark" and resolvedTheme="dark"', () => {
      const { setTheme } = useThemeStore.getState();

      setTheme("dark");

      const state = useThemeStore.getState();
      expect(state.theme).toBe("dark");
      expect(state.resolvedTheme).toBe("dark");
    });

    it('setTheme("light") sets theme="light" and resolvedTheme="light"', () => {
      useThemeStore.setState({ theme: "dark", resolvedTheme: "dark" });
      document.documentElement.classList.add("dark");

      const { setTheme } = useThemeStore.getState();
      setTheme("light");

      const state = useThemeStore.getState();
      expect(state.theme).toBe("light");
      expect(state.resolvedTheme).toBe("light");
    });

    it('setTheme("dark") adds "dark" class to document.documentElement', () => {
      const { setTheme } = useThemeStore.getState();

      setTheme("dark");

      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it('setTheme("light") removes "dark" class from document.documentElement', () => {
      document.documentElement.classList.add("dark");

      const { setTheme } = useThemeStore.getState();
      setTheme("light");

      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("setTheme() sets document.documentElement.style.colorScheme correctly", () => {
      const { setTheme } = useThemeStore.getState();

      setTheme("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");

      setTheme("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });
  });

  describe("setTheme - system", () => {
    it('setTheme("system") with matchMedia.matches=false resolves to resolvedTheme="light"', () => {
      // setup.ts already mocks matchMedia with matches: false
      const { setTheme } = useThemeStore.getState();

      setTheme("system");

      const state = useThemeStore.getState();
      expect(state.theme).toBe("system");
      expect(state.resolvedTheme).toBe("light");
    });

    it('setTheme("system") with matchMedia.matches=true resolves to resolvedTheme="dark"', () => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockReturnValue({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }),
      });

      const { setTheme } = useThemeStore.getState();
      setTheme("system");

      const state = useThemeStore.getState();
      expect(state.theme).toBe("system");
      expect(state.resolvedTheme).toBe("dark");

      // Restore default mock (matches: false)
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });
  });

  describe("CustomEvent dispatch", () => {
    it('setTheme("dark") dispatches "theme-changed" CustomEvent on window', () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      const { setTheme } = useThemeStore.getState();
      setTheme("dark");

      expect(dispatchSpy).toHaveBeenCalledOnce();
      const [dispatchedEvent] = dispatchSpy.mock.calls[0];
      expect(dispatchedEvent).toBeInstanceOf(CustomEvent);
      expect((dispatchedEvent as CustomEvent).type).toBe("theme-changed");

      dispatchSpy.mockRestore();
    });

    it('dispatched "theme-changed" event detail contains { theme, resolvedTheme }', () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      const { setTheme } = useThemeStore.getState();
      setTheme("dark");

      const [dispatchedEvent] = dispatchSpy.mock.calls[0];
      const detail = (dispatchedEvent as CustomEvent).detail;
      expect(detail).toEqual({ theme: "dark", resolvedTheme: "dark" });

      dispatchSpy.mockRestore();
    });
  });

  describe("initializeTheme", () => {
    it("initializeTheme() applies current theme to DOM", () => {
      useThemeStore.setState({ theme: "dark", resolvedTheme: "dark" });
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "";

      const { initializeTheme } = useThemeStore.getState();
      initializeTheme();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("initializeTheme() returns a cleanup function", () => {
      const { initializeTheme } = useThemeStore.getState();

      const cleanup = initializeTheme();

      expect(typeof cleanup).toBe("function");
    });

    it("cleanup function removes event listeners so subsequent events do not change state", () => {
      useThemeStore.setState({ theme: "system", resolvedTheme: "light" });

      const addEventListenerSpy = vi.fn();
      const removeEventListenerSpy = vi.fn();
      const mockMediaQuery = {
        matches: false,
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
        dispatchEvent: vi.fn(),
      };

      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockReturnValue(mockMediaQuery),
      });

      const { initializeTheme } = useThemeStore.getState();
      const cleanup = initializeTheme();

      cleanup();

      // After cleanup, removeEventListener should have been called for mediaQuery
      expect(removeEventListenerSpy).toHaveBeenCalledWith("change", expect.any(Function));

      // Restore default mock
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });
  });

  describe("DOM class behavior", () => {
    it('switching from dark to light removes "dark" class', () => {
      const { setTheme } = useThemeStore.getState();

      setTheme("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      setTheme("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it('switching from light to dark adds "dark" class and classList reflects final state', () => {
      const { setTheme } = useThemeStore.getState();

      expect(document.documentElement.classList.contains("dark")).toBe(false);

      setTheme("dark");

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      // classList should NOT contain 'light' — only 'dark' as the scheme modifier
      expect(document.documentElement.classList.contains("light")).toBe(false);
    });
  });
});
