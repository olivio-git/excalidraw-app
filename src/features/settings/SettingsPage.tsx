import { Moon, Sun, Monitor, RotateCcw, Folder, FolderOpen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";

import { useAppearanceStore } from "@/stores/appearanceStore";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";
import { useLanguageStore } from "@/stores/languageStore";
import { useSettingsStore, type SettingsTab } from "@/stores/settingsStore";
import { useEditorPreferencesStore } from "@/stores/editorPreferencesStore";
import KeybindingsPanel from "./keybindings/KeybindingsPanel";
import { AISettingsPanel } from "./ai/AISettingsPanel";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

/** A labeled on/off row (keel Switch). */
function SettingSwitch({
  label,
  description,
  checked,
  onCheckedChange,
  bordered = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  bordered?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5",
        bordered && "rounded-lg border border-border"
      )}
    >
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={(value) => onCheckedChange(value)} />
    </label>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const activeTab = useSettingsStore((s) => s.activeTab);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "appearance", label: t("tabs.appearance") },
    { id: "keybindings", label: t("tabs.keybindings") },
    { id: "workspace", label: t("tabs.workspace") },
    { id: "tabs", label: t("tabs.tabs") },
    { id: "ai", label: t("tabs.ai") },
  ];

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

  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const allowCloseLastTab = useTabsSettingsStore((s) => s.allowCloseLastTab);
  const enablePreview = useTabsSettingsStore((s) => s.enablePreview);
  const setEnablePreview = useTabsSettingsStore((s) => s.setEnablePreview);
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
  const markdownEditor = useEditorPreferencesStore((s) => s.markdownEditor);
  const setMarkdownEditor = useEditorPreferencesStore((s) => s.setMarkdownEditor);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("page.description")}</p>
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
              <h2 className="text-base font-semibold">{t("keybindings.title")}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{t("keybindings.description")}</p>
            </div>
            <KeybindingsPanel />
          </section>
        )}

        {/* Workspace */}
        {activeTab === "workspace" && (
          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("workspace.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("workspace.description")}</p>
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
                  {workspaceDir ?? t("workspace.noWorkspace")}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleChangeFolder}>
                  <FolderOpen className="size-4" />
                  {t("workspace.changeFolder")}
                </Button>
                {workspaceDir && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:border-destructive/50"
                    onClick={() => setWorkspaceDir(null)}
                  >
                    <X className="size-4" />
                    {t("workspace.removeWorkspace")}
                  </Button>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("markdownEditor.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("markdownEditor.description")}</p>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                {(["code", "markdown", "classic"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={markdownEditor === choice}
                    onClick={() => setMarkdownEditor(choice)}
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left transition-colors",
                      markdownEditor === choice
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    )}
                  >
                    <span className="block text-sm font-medium">
                      {t(`markdownEditor.${choice}`)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t(`markdownEditor.${choice}Hint`)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Tabs */}
        {activeTab === "tabs" && (
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-base font-semibold">{t("tabsBehavior.title")}</h2>
              <SettingSwitch
                label={t("tabsBehavior.allowCloseLastTab")}
                description={t("tabsBehavior.allowCloseLastTabDescription")}
                checked={allowCloseLastTab}
                onCheckedChange={setAllowCloseLastTab}
                bordered
              />
              <SettingSwitch
                label={t("tabsBehavior.enablePreview")}
                description={t("tabsBehavior.enablePreviewDescription")}
                checked={enablePreview}
                onCheckedChange={setEnablePreview}
                bordered
              />
            </section>
          </div>
        )}

        {/* AI */}
        {activeTab === "ai" && (
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">{t("ai.title")}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{t("ai.description")}</p>
            </div>
            <AISettingsPanel />
          </section>
        )}

        {/* Appearance */}
        {activeTab === "appearance" && (
          <div className="space-y-8">
            {/* Language */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("appearance.language")}</h2>
              <SegmentedControl
                ariaLabel={t("appearance.language")}
                value={language}
                onChange={setLanguage}
                options={[
                  { value: "en", label: "English" },
                  { value: "es", label: "Español" },
                ]}
              />
            </section>

            {/* Theme */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("appearance.theme.title")}</h2>
              <SegmentedControl
                ariaLabel={t("appearance.theme.title")}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", icon: Sun, label: t("appearance.theme.light") },
                  { value: "dark", icon: Moon, label: t("appearance.theme.dark") },
                  { value: "system", icon: Monitor, label: t("appearance.theme.system") },
                ]}
              />
            </section>

            {/* Typography */}
            <section className="space-y-4">
              <h2 className="text-base font-semibold">{t("appearance.typography.title")}</h2>
              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  {t("appearance.typography.fontFamily")}
                </label>
                <SegmentedControl
                  ariaLabel={t("appearance.typography.fontFamily")}
                  value={fontFamily}
                  onChange={setFontFamily}
                  options={[
                    { value: "sans", label: "Sans" },
                    { value: "mono", label: "Mono" },
                    { value: "serif", label: "Serif" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  {t("appearance.typography.fontSize")}
                </label>
                <SegmentedControl
                  ariaLabel={t("appearance.typography.fontSize")}
                  value={fontSize}
                  onChange={setFontSize}
                  options={[
                    { value: "small", label: "Small" },
                    { value: "medium", label: "Medium" },
                    { value: "large", label: "Large" },
                  ]}
                />
              </div>
            </section>

            {/* Border Radius */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("appearance.borderRadius.title")}</h2>
              <SegmentedControl
                ariaLabel={t("appearance.borderRadius.title")}
                value={borderRadius}
                onChange={setBorderRadius}
                options={[
                  { value: "none", label: "NONE" },
                  { value: "sm", label: "SM" },
                  { value: "md", label: "MD" },
                  { value: "lg", label: "LG" },
                ]}
              />
            </section>

            {/* Accessibility */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{t("appearance.accessibility.title")}</h2>
              <div className="divide-y divide-border rounded-lg border border-border">
                <SettingSwitch
                  label={t("appearance.accessibility.highContrastLabel")}
                  checked={highContrast}
                  onCheckedChange={setHighContrast}
                />
                <SettingSwitch
                  label={t("appearance.accessibility.reduceAnimationsLabel")}
                  checked={reduceAnimations}
                  onCheckedChange={setReduceAnimations}
                />
              </div>
            </section>

            {/* Reset */}
            <section className="pt-2">
              <Separator className="mb-6" />
              <Button variant="outline" size="sm" onClick={resetToDefaults}>
                <RotateCcw className="size-4" />
                {t("appearance.reset")}
              </Button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
