import { Moon, Sun, Monitor, RotateCcw, Folder, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { useAppearanceStore } from "@/stores/appearanceStore";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import KeybindingsPanel from "./keybindings/KeybindingsPanel";
import { AISettingsPanel } from "./ai/AISettingsPanel";
import { cn } from "@/shared/lib/utils";

type SettingsTab = "appearance" | "keybindings" | "workspace" | "ai";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);

  const handleChangeFolder = async () => {
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") {
      setWorkspaceDir(result);
    }
  };

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const fontFamily = useAppearanceStore((s) => s.fontFamily);
  const fontSize = useAppearanceStore((s) => s.fontSize);
  const borderRadius = useAppearanceStore((s) => s.borderRadius);
  const highContrast = useAppearanceStore((s) => s.highContrast);
  const reduceAnimations = useAppearanceStore((s) => s.reduceAnimations);
  const setFontFamily = useAppearanceStore((s) => s.setFontFamily);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const setBorderRadius = useAppearanceStore((s) => s.setBorderRadius);
  const setHighContrast = useAppearanceStore((s) => s.setHighContrast);
  const setReduceAnimations = useAppearanceStore((s) => s.setReduceAnimations);
  const resetToDefaults = useAppearanceStore((s) => s.resetToDefaults);

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Customize the appearance and behavior of the application.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex gap-0">
          {(
            [
              { id: "appearance", label: "Appearance" },
              { id: "keybindings", label: "Keybindings" },
              { id: "workspace", label: "Workspace" },
              { id: "ai", label: "AI" },
            ] as { id: SettingsTab; label: string }[]
          ).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                activeTab === id
                  ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Keybindings tab */}
      {activeTab === "keybindings" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Keybindings
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              View and customize keyboard shortcuts. Click a row to reassign.
            </p>
          </div>
          <KeybindingsPanel />
        </section>
      )}

      {/* Workspace tab */}
      {activeTab === "workspace" && (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Workspace Folder
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Select a local folder to use as your workspace. Diagrams will be read from and saved
              to this directory.
            </p>
            <div className="flex items-center gap-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5">
              {workspaceDir ? (
                <FolderOpen className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
              ) : (
                <Folder className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
              )}
              <span
                className={cn(
                  "flex-1 text-sm truncate",
                  workspaceDir
                    ? "text-zinc-800 dark:text-zinc-200 font-mono"
                    : "text-zinc-400 dark:text-zinc-500 italic"
                )}
              >
                {workspaceDir ?? "No workspace selected"}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleChangeFolder}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 h-9 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <FolderOpen className="size-4" />
                Cambiar carpeta
              </button>
              {workspaceDir && (
                <button
                  onClick={() => setWorkspaceDir(null)}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 h-9 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800 transition-colors"
                >
                  <X className="size-4" />
                  Quitar workspace
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {/* AI tab */}
      {activeTab === "ai" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              AI Configuration
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              Configure AI providers and API keys for diagram assistance.
            </p>
          </div>
          <AISettingsPanel />
        </section>
      )}

      {/* Appearance tab */}
      {activeTab === "appearance" && (
        <div className="space-y-8">
          {/* Theme */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Theme</h2>
            <div className="flex gap-2">
              {[
                { value: "light" as const, icon: Sun, label: "Light" },
                { value: "dark" as const, icon: Moon, label: "Dark" },
                { value: "system" as const, icon: Monitor, label: "System" },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md border px-3 h-9 text-sm font-medium transition-colors",
                    theme === value
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Typography */}
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Typography</h2>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Font Family
              </label>
              <div className="flex gap-2">
                {(["sans", "mono", "serif"] as const).map((ff) => (
                  <button
                    key={ff}
                    onClick={() => setFontFamily(ff)}
                    className={cn(
                      "rounded-md border px-3 h-8 text-sm font-medium capitalize transition-colors",
                      fontFamily === ff
                        ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                        : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    )}
                  >
                    {ff}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Font Size
              </label>
              <div className="flex gap-2">
                {(["small", "medium", "large"] as const).map((fs) => (
                  <button
                    key={fs}
                    onClick={() => setFontSize(fs)}
                    className={cn(
                      "rounded-md border px-3 h-8 text-sm font-medium capitalize transition-colors",
                      fontSize === fs
                        ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                        : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    )}
                  >
                    {fs}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Border Radius */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Border Radius
            </h2>
            <div className="flex gap-2">
              {(["none", "sm", "md", "lg"] as const).map((br) => (
                <button
                  key={br}
                  onClick={() => setBorderRadius(br)}
                  className={cn(
                    "rounded-md border px-3 h-8 text-sm font-medium uppercase transition-colors",
                    borderRadius === br
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  )}
                >
                  {br}
                </button>
              ))}
            </div>
          </section>

          {/* Accessibility */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Accessibility
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setHighContrast(!highContrast)}
                className={cn(
                  "rounded-md border px-3 h-8 text-sm font-medium transition-colors",
                  highContrast
                    ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                )}
              >
                High Contrast:{" "}
                <span className={highContrast ? "text-green-400" : ""}>
                  {highContrast ? "On" : "Off"}
                </span>
              </button>
              <button
                onClick={() => setReduceAnimations(!reduceAnimations)}
                className={cn(
                  "rounded-md border px-3 h-8 text-sm font-medium transition-colors",
                  reduceAnimations
                    ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                )}
              >
                Reduce Animations:{" "}
                <span className={reduceAnimations ? "text-green-400" : ""}>
                  {reduceAnimations ? "On" : "Off"}
                </span>
              </button>
            </div>
          </section>

          {/* Reset */}
          <section className="border-t border-zinc-200 dark:border-zinc-700 pt-6">
            <button
              onClick={resetToDefaults}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 h-9 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="size-4" />
              Reset to Defaults
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
