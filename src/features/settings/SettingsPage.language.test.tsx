import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// i18n must be initialized before SettingsPage renders
import "@/core/i18n/i18n";

// Tauri plugins not available in JSDOM
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/core/storage/tauri-storage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => {
      store.set(name, value);
    },
    removeItem: (name: string) => {
      store.delete(name);
    },
  };
  return {
    tauriLanguageStorage: storage,
    tauriThemeStorage: storage,
    tauriAppearanceStorage: storage,
    tauriTabStorage: storage,
    tauriAuthStorage: storage,
    tauriAISettingsStorage: storage,
    tauriTabsSettingsStorage: storage,
    createTauriStorage: vi.fn(() => storage),
  };
});

// Mock heavy sub-panels that are irrelevant for language tests
vi.mock("./keybindings/KeybindingsPanel", () => ({
  default: () => <div data-testid="keybindings-panel" />,
}));

vi.mock("./ai/AISettingsPanel", () => ({
  AISettingsPanel: () => <div data-testid="ai-settings-panel" />,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { useLanguageStore } from "@/stores/languageStore";
import SettingsPage from "./SettingsPage";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("SettingsPage — Language selector", () => {
  beforeEach(() => {
    // Reset language to EN before each test
    useLanguageStore.setState({ language: "en" });
  });

  it('renders the "English" button', () => {
    render(<SettingsPage />);

    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
  });

  it('renders the "Español" button', () => {
    render(<SettingsPage />);

    expect(screen.getByRole("button", { name: "Español" })).toBeInTheDocument();
  });

  it('clicking "Español" calls setLanguage("es")', async () => {
    const user = userEvent.setup();
    const setLanguageSpy = vi.spyOn(useLanguageStore.getState(), "setLanguage");

    // Patch the store to capture the call
    useLanguageStore.setState({
      setLanguage: setLanguageSpy,
    });

    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "Español" }));

    expect(setLanguageSpy).toHaveBeenCalledWith("es");
  });

  it('clicking "English" calls setLanguage("en")', async () => {
    const user = userEvent.setup();
    useLanguageStore.setState({ language: "es" });

    const setLanguageSpy = vi.spyOn(useLanguageStore.getState(), "setLanguage");
    useLanguageStore.setState({ setLanguage: setLanguageSpy });

    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(setLanguageSpy).toHaveBeenCalledWith("en");
  });

  it('active language "en" — "English" button has variant="default" (data attribute or class)', () => {
    useLanguageStore.setState({ language: "en" });

    render(<SettingsPage />);

    const englishBtn = screen.getByRole("button", { name: "English" });
    const espanolBtn = screen.getByRole("button", { name: "Español" });

    // The active button should be visually distinct from the inactive one.
    // In shadcn/cva, the variant is expressed via className. We verify the
    // classes differ between the two buttons (active vs outline).
    expect(englishBtn.className).not.toBe(espanolBtn.className);
  });

  it('active language "es" — "Español" button has a different class than "English"', () => {
    useLanguageStore.setState({ language: "es" });

    render(<SettingsPage />);

    const englishBtn = screen.getByRole("button", { name: "English" });
    const espanolBtn = screen.getByRole("button", { name: "Español" });

    expect(espanolBtn.className).not.toBe(englishBtn.className);
  });
});
