import { Moon, Sun, Monitor, RotateCcw, Folder, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { useAppearanceStore } from "@/stores/appearanceStore";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";
import KeybindingsPanel from "./keybindings/KeybindingsPanel";
import { AISettingsPanel } from "./ai/AISettingsPanel";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { cn } from "@/shared/lib/utils";

type SettingsTab = "appearance" | "keybindings" | "workspace" | "ai" | "tabs";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "keybindings", label: "Keybindings" },
  { id: "workspace", label: "Workspace" },
  { id: "tabs", label: "Tabs" },
  { id: "ai", label: "AI" },
];

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

  const allowCloseLastTab = useTabsSettingsStore((s) => s.allowCloseLastTab);
  const setAllowCloseLastTab = useTabsSettingsStore((s) => s.setAllowCloseLastTab);

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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize the appearance and behavior of the application.
          </p>
        </div>

        {/* Tab navigation */}
        <div className="border-b border-border">
          <div className="flex gap-0">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                  activeTab === id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Keybindings */}
        {activeTab === "keybindings" && (
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Keybindings</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                View and customize keyboard shortcuts. Click a row to reassign.
              </p>
            </div>
            <KeybindingsPanel />
          </section>
        )}

        {/* Workspace */}
        {activeTab === "workspace" && (
          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Workspace Folder</h2>
              <p className="text-sm text-muted-foreground">
                Select a local folder to use as your workspace. Diagrams will be read from and saved
                to this directory.
              </p>
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
                {workspaceDir ? (
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground/60" />
                )}
                <span
                  className={cn(
                    "flex-1 text-sm truncate",
                    workspaceDir ? "font-mono" : "text-muted-foreground italic"
                  )}
                >
                  {workspaceDir ?? "No workspace selected"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleChangeFolder}>
                  <FolderOpen className="size-4" />
                  Cambiar carpeta
                </Button>
                {workspaceDir && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:border-destructive/50"
                    onClick={() => setWorkspaceDir(null)}
                  >
                    <X className="size-4" />
                    Quitar workspace
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}

        {/* Tabs */}
        {activeTab === "tabs" && (
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Tab Behavior</h2>
              <div className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Allow closing the last tab</p>
                  <p className="text-xs text-muted-foreground">
                    When enabled, closing the last open tab shows the welcome screen instead of
                    keeping the tab open.
                  </p>
                </div>
                <Button
                  variant={allowCloseLastTab ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setAllowCloseLastTab(!allowCloseLastTab)}
                >
                  {allowCloseLastTab ? "On" : "Off"}
                </Button>
              </div>
            </section>
          </div>
        )}

        {/* AI */}
        {activeTab === "ai" && (
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">AI Configuration</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure AI providers and API keys for diagram assistance.
              </p>
            </div>
            <AISettingsPanel />
          </section>
        )}

        {/* Appearance */}
        {activeTab === "appearance" && (
          <div className="space-y-8">
            {/* Theme */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Theme</h2>
              <div className="flex gap-2">
                {[
                  { value: "light" as const, icon: Sun, label: "Light" },
                  { value: "dark" as const, icon: Moon, label: "Dark" },
                  { value: "system" as const, icon: Monitor, label: "System" },
                ].map(({ value, icon: Icon, label }) => (
                  <Button
                    key={value}
                    variant={theme === value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme(value)}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </section>

            {/* Typography */}
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Typography</h2>
              <div className="space-y-2">
                <label className="text-sm font-medium">Font Family</label>
                <div className="flex gap-2">
                  {(["sans", "mono", "serif"] as const).map((ff) => (
                    <Button
                      key={ff}
                      variant={fontFamily === ff ? "default" : "outline"}
                      size="sm"
                      className="capitalize"
                      onClick={() => setFontFamily(ff)}
                    >
                      {ff}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Font Size</label>
                <div className="flex gap-2">
                  {(["small", "medium", "large"] as const).map((fs) => (
                    <Button
                      key={fs}
                      variant={fontSize === fs ? "default" : "outline"}
                      size="sm"
                      className="capitalize"
                      onClick={() => setFontSize(fs)}
                    >
                      {fs}
                    </Button>
                  ))}
                </div>
              </div>
            </section>

            {/* Border Radius */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Border Radius</h2>
              <div className="flex gap-2">
                {(["none", "sm", "md", "lg"] as const).map((br) => (
                  <Button
                    key={br}
                    variant={borderRadius === br ? "default" : "outline"}
                    size="sm"
                    className="uppercase"
                    onClick={() => setBorderRadius(br)}
                  >
                    {br}
                  </Button>
                ))}
              </div>
            </section>

            {/* Accessibility */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Accessibility</h2>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={highContrast ? "default" : "outline"}
                  size="sm"
                  onClick={() => setHighContrast(!highContrast)}
                >
                  High Contrast: {highContrast ? "On" : "Off"}
                </Button>
                <Button
                  variant={reduceAnimations ? "default" : "outline"}
                  size="sm"
                  onClick={() => setReduceAnimations(!reduceAnimations)}
                >
                  Reduce Animations: {reduceAnimations ? "On" : "Off"}
                </Button>
              </div>
            </section>

            {/* Reset */}
            <section className="pt-2">
              <Separator className="mb-6" />
              <Button variant="outline" size="sm" onClick={resetToDefaults}>
                <RotateCcw className="size-4" />
                Reset to Defaults
              </Button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
