import { create } from "zustand";
import { tauriAppearanceStorage } from "@/core/storage/tauri-storage";
import { persist, createJSONStorage } from "zustand/middleware";

type FontFamily = "sans" | "mono" | "serif";
type FontSize = "small" | "medium" | "large";
type ContentWidth = "compact" | "standard" | "wide";
type BorderRadius = "none" | "sm" | "md" | "lg";

interface AppearanceSettings {
  fontFamily: FontFamily;
  fontSize: FontSize;
  highContrast: boolean;
  focusWidth: number;
  reduceAnimations: boolean;
  contentWidth: ContentWidth;
  elementSpacing: number;
  borderRadius: BorderRadius;
}

interface AppearanceStore extends AppearanceSettings {
  setFontFamily: (fontFamily: FontFamily) => void;
  setFontSize: (fontSize: FontSize) => void;
  setHighContrast: (enabled: boolean) => void;
  setFocusWidth: (width: number) => void;
  setReduceAnimations: (enabled: boolean) => void;
  setContentWidth: (width: ContentWidth) => void;
  setElementSpacing: (spacing: number) => void;
  setBorderRadius: (radius: BorderRadius) => void;
  resetToDefaults: () => void;
  initializeAppearance: () => void;
}

const defaultSettings: AppearanceSettings = {
  fontFamily: "sans",
  fontSize: "medium",
  highContrast: false,
  focusWidth: 2,
  reduceAnimations: false,
  contentWidth: "standard",
  elementSpacing: 16,
  borderRadius: "md",
};

const applyTypography = (fontFamily: FontFamily, fontSize: FontSize) => {
  const root = document.documentElement;
  const fontMap = {
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
    serif: "var(--font-serif)",
  };
  root.style.setProperty("--font-family-active", fontMap[fontFamily]);

  const sizeMap = {
    small: "var(--font-size-small)",
    medium: "var(--font-size-medium)",
    large: "var(--font-size-large)",
  };
  root.style.fontSize = sizeMap[fontSize];
};

const applyAccessibility = (
  highContrast: boolean,
  focusWidth: number,
  reduceAnimations: boolean
) => {
  const root = document.documentElement;

  if (highContrast) {
    root.classList.add("high-contrast");
  } else {
    root.classList.remove("high-contrast");
  }

  root.style.setProperty("--focus-width", `${focusWidth}px`);

  if (reduceAnimations) {
    root.style.setProperty("--animation-duration", "0.01s");
    root.style.setProperty("--transition-duration", "0.01s");
  } else {
    root.style.removeProperty("--animation-duration");
    root.style.removeProperty("--transition-duration");
  }
};

const applyLayout = (
  contentWidth: ContentWidth,
  elementSpacing: number,
  borderRadius: BorderRadius
) => {
  const root = document.documentElement;

  const widthMap = {
    compact: "1024px",
    standard: "1280px",
    wide: "1536px",
  };
  root.style.setProperty("--max-width", widthMap[contentWidth]);
  root.style.setProperty("--element-spacing", `${elementSpacing}px`);

  const radiusMap = {
    none: "0",
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.75rem",
  };
  root.style.setProperty("--border-radius-base", radiusMap[borderRadius]);
};

export const useAppearanceStore = create<AppearanceStore>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      setFontFamily: (fontFamily: FontFamily) => {
        const { fontSize } = get();
        applyTypography(fontFamily, fontSize);
        set({ fontFamily });
      },

      setFontSize: (fontSize: FontSize) => {
        const { fontFamily } = get();
        applyTypography(fontFamily, fontSize);
        set({ fontSize });
      },

      setHighContrast: (highContrast: boolean) => {
        const { focusWidth, reduceAnimations } = get();
        applyAccessibility(highContrast, focusWidth, reduceAnimations);
        set({ highContrast });
      },

      setFocusWidth: (focusWidth: number) => {
        const { highContrast, reduceAnimations } = get();
        applyAccessibility(highContrast, focusWidth, reduceAnimations);
        set({ focusWidth });
      },

      setReduceAnimations: (reduceAnimations: boolean) => {
        const { highContrast, focusWidth } = get();
        applyAccessibility(highContrast, focusWidth, reduceAnimations);
        set({ reduceAnimations });
      },

      setContentWidth: (contentWidth: ContentWidth) => {
        const { elementSpacing, borderRadius } = get();
        applyLayout(contentWidth, elementSpacing, borderRadius);
        set({ contentWidth });
      },

      setElementSpacing: (elementSpacing: number) => {
        const { contentWidth, borderRadius } = get();
        applyLayout(contentWidth, elementSpacing, borderRadius);
        set({ elementSpacing });
      },

      setBorderRadius: (borderRadius: BorderRadius) => {
        const { contentWidth, elementSpacing } = get();
        applyLayout(contentWidth, elementSpacing, borderRadius);
        set({ borderRadius });
      },

      resetToDefaults: () => {
        set(defaultSettings);
        const {
          fontFamily,
          fontSize,
          highContrast,
          focusWidth,
          reduceAnimations,
          contentWidth,
          elementSpacing,
          borderRadius,
        } = defaultSettings;
        applyTypography(fontFamily, fontSize);
        applyAccessibility(highContrast, focusWidth, reduceAnimations);
        applyLayout(contentWidth, elementSpacing, borderRadius);
      },

      initializeAppearance: () => {
        const state = get();
        applyTypography(state.fontFamily, state.fontSize);
        applyAccessibility(state.highContrast, state.focusWidth, state.reduceAnimations);
        applyLayout(state.contentWidth, state.elementSpacing, state.borderRadius);
      },
    }),
    {
      name: "appearance-storage",
      storage: createJSONStorage(() => tauriAppearanceStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.initializeAppearance();
        }
      },
    }
  )
);
