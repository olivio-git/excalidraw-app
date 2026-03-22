import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";

import { useAISettingsStore } from "./ai-settings-store";
import { AIProviderFactory } from "@/features/ai-chat/providers/factory";
import type { AIProviderName } from "@/features/ai-chat/providers/types";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

const PROVIDERS: { id: AIProviderName; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "groq", label: "Groq" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
];

const PROVIDER_MODELS: Record<AIProviderName, string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  openai: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-pro-preview-06-05",
    "gemini-2.5-flash",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
};

const PROVIDER_KEY_PLACEHOLDER: Record<AIProviderName, string> = {
  anthropic: "sk-ant-...",
  groq: "gsk_...",
  openai: "sk-...",
  gemini: "AIza...",
};

type InlineStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success" }
  | { type: "error"; message: string };

export function AISettingsPanel() {
  const { t } = useTranslation("settings");
  const activeProvider = useAISettingsStore((s) => s.activeProvider);
  const providers = useAISettingsStore((s) => s.providers);
  const setActiveProvider = useAISettingsStore((s) => s.setActiveProvider);
  const setProviderKey = useAISettingsStore((s) => s.setProviderKey);
  const setProviderModel = useAISettingsStore((s) => s.setProviderModel);

  const [localKey, setLocalKey] = useState<Record<AIProviderName, string>>({
    anthropic: "",
    groq: "",
    openai: "",
    gemini: "",
  });
  const [showKey, setShowKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<InlineStatus>({ type: "idle" });
  const [connectionStatus, setConnectionStatus] = useState<InlineStatus>({ type: "idle" });

  const storedKey = providers[activeProvider]?.apiKey ?? "";
  const maskedPreview =
    storedKey.length > 12
      ? storedKey.slice(0, 8) + "..." + storedKey.slice(-4)
      : storedKey.length > 0
        ? storedKey.slice(0, 4) + "..."
        : "";

  const handleProviderChange = (provider: AIProviderName) => {
    setActiveProvider(provider);
    setConnectionStatus({ type: "idle" });
    setSaveStatus({ type: "idle" });
    setShowKey(false);
  };

  const handleSave = () => {
    const keyToSave = localKey[activeProvider];
    if (keyToSave !== "") {
      setProviderKey(activeProvider, keyToSave);
      setLocalKey((prev) => ({ ...prev, [activeProvider]: "" }));
    }
    setSaveStatus({ type: "success" });
    setTimeout(() => setSaveStatus({ type: "idle" }), 2000);
  };

  const handleTestConnection = async () => {
    const apiKey =
      localKey[activeProvider] !== "" ? localKey[activeProvider] : providers[activeProvider].apiKey;
    const model = providers[activeProvider].model;

    if (!apiKey) {
      setConnectionStatus({ type: "error", message: t("ai.actions.noApiKey") });
      return;
    }

    setConnectionStatus({ type: "loading" });
    const abortController = new AbortController();

    try {
      const provider = await AIProviderFactory.create(activeProvider);
      const stream = provider.stream(
        [{ id: "test-1", role: "user", content: "Say hello", timestamp: Date.now() }],
        "",
        [],
        { apiKey, model },
        abortController.signal
      );

      for await (const chunk of stream) {
        if (chunk.type === "error") {
          setConnectionStatus({ type: "error", message: chunk.message });
          return;
        }
        if (chunk.type === "text_delta" || chunk.type === "done") {
          abortController.abort();
          setConnectionStatus({ type: "success" });
          return;
        }
      }
      setConnectionStatus({ type: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      if (message !== "AbortError" && !message.includes("aborted")) {
        setConnectionStatus({ type: "error", message });
      } else {
        setConnectionStatus({ type: "success" });
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* Provider selector */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("ai.provider.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("ai.provider.description")}</p>
        <div className="flex gap-2 flex-wrap">
          {PROVIDERS.map(({ id, label }) => (
            <Button
              key={id}
              variant={activeProvider === id ? "default" : "outline"}
              size="sm"
              onClick={() => handleProviderChange(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      {/* API Key */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("ai.apiKey.title")}</h2>
        {maskedPreview && (
          <p className="text-xs text-muted-foreground font-mono">
            {t("ai.apiKey.current")} <span className="text-foreground">{maskedPreview}</span>
          </p>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t("ai.apiKey.label", {
              provider: PROVIDERS.find((p) => p.id === activeProvider)?.label,
            })}
          </label>
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              value={localKey[activeProvider]}
              onChange={(e) =>
                setLocalKey((prev) => ({ ...prev, [activeProvider]: e.target.value }))
              }
              placeholder={PROVIDER_KEY_PLACEHOLDER[activeProvider]}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showKey ? t("ai.apiKey.hideKey") : t("ai.apiKey.showKey")}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </section>

      {/* Model selector */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("ai.model.title")}</h2>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("ai.model.selectLabel")}</label>
          <select
            value={providers[activeProvider]?.model ?? ""}
            onChange={(e) => setProviderModel(activeProvider, e.target.value)}
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            )}
          >
            {PROVIDER_MODELS[activeProvider].map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Actions */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" onClick={handleSave}>
            {t("ai.actions.save")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={connectionStatus.type === "loading"}
          >
            {connectionStatus.type === "loading" && <Loader2 className="size-4 animate-spin" />}
            {t("ai.actions.testConnection")}
          </Button>

          {saveStatus.type === "success" && (
            <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              {t("ai.actions.saved")}
            </span>
          )}

          {connectionStatus.type === "success" && saveStatus.type === "idle" && (
            <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              {t("ai.actions.connected")}
            </span>
          )}
          {connectionStatus.type === "error" && (
            <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
              <XCircle className="size-4" />
              {connectionStatus.message}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
