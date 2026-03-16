import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriThemeStorage } from "@/core/storage/tauri-storage";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeStore {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  initializeTheme: () => void;
}

const getSystemTheme = (): ResolvedTheme => {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyTheme = (resolvedTheme: ResolvedTheme) => {
  const root = document.documentElement;
  root.style.colorScheme = resolvedTheme;

  if (resolvedTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
};

const resolveTheme = (theme: Theme): ResolvedTheme => {
  return theme === "system" ? getSystemTheme() : theme;
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: "light",
      resolvedTheme: "light",

      setTheme: (theme: Theme) => {
        const resolvedTheme = resolveTheme(theme);
        applyTheme(resolvedTheme);
        set({ theme, resolvedTheme });

        window.dispatchEvent(
          new CustomEvent("theme-changed", {
            detail: { theme, resolvedTheme },
          })
        );
      },

      initializeTheme: () => {
        const { theme } = get();
        const resolvedTheme = resolveTheme(theme);
        applyTheme(resolvedTheme);
        set({ resolvedTheme });

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleSystemChange = (e: MediaQueryListEvent) => {
          const { theme } = get();
          if (theme === "system") {
            const newResolvedTheme = e.matches ? "dark" : "light";
            applyTheme(newResolvedTheme);
            set({ resolvedTheme: newResolvedTheme });
          }
        };

        mediaQuery.addEventListener("change", handleSystemChange);

        const handleStorageChange = (e: StorageEvent) => {
          if (e.key === "theme-storage" && e.newValue) {
            try {
              const newState = JSON.parse(e.newValue).state;
              const newResolvedTheme = resolveTheme(newState.theme);
              applyTheme(newResolvedTheme);
              set({ theme: newState.theme, resolvedTheme: newResolvedTheme });
            } catch (err) {
              console.error("[ThemeStore] Error syncing theme:", err);
            }
          }
        };

        window.addEventListener("storage", handleStorageChange);

        return () => {
          mediaQuery.removeEventListener("change", handleSystemChange);
          window.removeEventListener("storage", handleStorageChange);
        };
      },
    }),
    {
      name: "theme-storage",
      storage: createJSONStorage(() => tauriThemeStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.initializeTheme();
        }
      },
    }
  )
);
