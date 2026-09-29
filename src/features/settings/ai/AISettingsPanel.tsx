import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useAISettingsStore } from "./ai-settings-store";
import { FALLBACK_PROVIDER_MODELS, fetchProviderModels } from "./model-fetcher";
import { gatewayClient } from "@/features/ai-chat/gateway/gatewayClient";
import { AIProviderFactory } from "@/features/ai-chat/providers/factory";
import type { AIProviderName } from "@/features/ai-chat/providers/types";
import { cn } from "@/shared/lib/utils";
import { dismissPrompt, prompt } from "@/shared/lib/prompt";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

const PROVIDERS: { id: AIProviderName; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "groq", label: "Groq" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "openai-codex", label: "ChatGPT/Codex" },
];

const PROVIDER_KEY_PLACEHOLDER: Record<AIProviderName, string> = {
  anthropic: "sk-ant-...",
  groq: "gsk_...",
  openai: "sk-...",
  gemini: "AIza...",
  openrouter: "sk-or-v1-...",
  "openai-codex": "Login with ChatGPT",
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
  const customInstructions = useAISettingsStore((s) => s.customInstructions);
  const setCustomInstructions = useAISettingsStore((s) => s.setCustomInstructions);
  const requireToolConfirmation = useAISettingsStore((s) => s.requireToolConfirmation);
  const setRequireToolConfirmation = useAISettingsStore((s) => s.setRequireToolConfirmation);

  const [localKey, setLocalKey] = useState<Record<AIProviderName, string>>({
    anthropic: "",
    groq: "",
    openai: "",
    gemini: "",
    openrouter: "",
    "openai-codex": "",
  });
  const [showKey, setShowKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<InlineStatus>({ type: "idle" });
  const [connectionStatus, setConnectionStatus] = useState<InlineStatus>({ type: "idle" });
  const [modelStatus, setModelStatus] = useState<InlineStatus>({ type: "idle" });
  const [fetchedModels, setFetchedModels] = useState<Partial<Record<AIProviderName, string[]>>>({});
  const [codexAuthStatus, setCodexAuthStatus] = useState<InlineStatus>({ type: "idle" });
  const [codexLoginUrl, setCodexLoginUrl] = useState<string | null>(null);
  const [codexLoginInProgress, setCodexLoginInProgress] = useState(false);

  const storedKey = providers[activeProvider]?.apiKey ?? "";
  const maskedPreview =
    storedKey.length > 12
      ? storedKey.slice(0, 8) + "..." + storedKey.slice(-4)
      : storedKey.length > 0
        ? storedKey.slice(0, 4) + "..."
        : "";
  const activeApiKey =
    activeProvider === "openai-codex"
      ? "oauth"
      : localKey[activeProvider] !== ""
        ? localKey[activeProvider]
        : storedKey;
  const activeModel = providers[activeProvider]?.model ?? "";
  const modelOptions = useMemo(() => {
    const base = fetchedModels[activeProvider]?.length
      ? fetchedModels[activeProvider]
      : FALLBACK_PROVIDER_MODELS[activeProvider];
    return [...new Set([activeModel, ...base].filter(Boolean))];
  }, [activeModel, activeProvider, fetchedModels]);

  const handleProviderChange = (provider: AIProviderName) => {
    setActiveProvider(provider);
    setConnectionStatus({ type: "idle" });
    setSaveStatus({ type: "idle" });
    setModelStatus({ type: "idle" });
    setShowKey(false);
  };

  const loadModels = async () => {
    if (activeProvider !== "openai-codex" && !activeApiKey) {
      setModelStatus({ type: "error", message: t("ai.actions.noApiKey") });
      return;
    }

    setModelStatus({ type: "loading" });
    try {
      const models = await fetchProviderModels(activeProvider, activeApiKey);
      if (models.length === 0) {
        setModelStatus({ type: "error", message: t("ai.model.noModels") });
        return;
      }
      setFetchedModels((prev) => ({ ...prev, [activeProvider]: models }));
      setModelStatus({ type: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("ai.model.loadFailed");
      setModelStatus({ type: "error", message });
    }
  };

  useEffect(() => {
    if (activeProvider === "openai-codex") {
      void refreshCodexStatus();
      if (!fetchedModels[activeProvider]?.length) void loadModels();
      return;
    }
    if (!storedKey || fetchedModels[activeProvider]?.length) return;
    void loadModels();
    // Only auto-load when switching providers or after saving a stored key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, storedKey]);

  const refreshCodexStatus = async () => {
    setCodexAuthStatus({ type: "loading" });
    try {
      const status = await gatewayClient.request<{ loggedIn: boolean; account?: { id: string } }>(
        "auth.status"
      );
      setCodexAuthStatus(
        status.loggedIn
          ? { type: "success" }
          : { type: "error", message: t("ai.codex.notConnected") }
      );
    } catch (err) {
      setCodexAuthStatus({
        type: "error",
        message: err instanceof Error ? err.message : t("ai.codex.gatewayUnavailable"),
      });
    }
  };

  const openCodexLoginUrl = async (url: string) => {
    try {
      await invoke("open_external_url", { url });
      return;
    } catch {
      // Fall back to the Tauri opener plugin. Some Linux desktop environments
      // report success for one mechanism while only the other actually opens.
    }

    try {
      await openUrl(url);
    } catch (err) {
      setCodexAuthStatus({
        type: "error",
        message: err instanceof Error ? err.message : t("ai.codex.browserOpenFailed"),
      });
    }
  };

  const handleCodexLogin = async (method: "browser" | "device") => {
    setCodexLoginInProgress(true);
    setCodexLoginUrl(null);
    setCodexAuthStatus({ type: "loading" });
    const loginRequestId = crypto.randomUUID();
    let manualPromptShown = false;
    let loginFinished = false;
    const off = gatewayClient.onEvent((event) => {
      if (event.requestId !== loginRequestId) return;

      if (event.type === "auth.prompt") {
        const authPrompt = event.prompt as {
          type?: string;
          message?: string;
          placeholder?: string;
        };
        if (authPrompt.type === "manual_code" && !manualPromptShown) {
          manualPromptShown = true;
          setCodexAuthStatus({ type: "error", message: t("ai.codex.waitingForCode") });
          void (async () => {
            const result = await prompt({
              title: t("ai.codex.manualCodeTitle"),
              description: authPrompt.message ?? t("ai.codex.manualCodeDescription"),
              fields: [
                {
                  id: "code",
                  label: t("ai.codex.manualCodeLabel"),
                  placeholder: authPrompt.placeholder ?? "http://localhost:1455/auth/callback?...",
                  required: true,
                },
              ],
              confirmLabel: t("ai.codex.submitCode"),
              cancelLabel: t("ai.codex.cancelLogin"),
            });
            try {
              if (loginFinished) return;
              if (result?.code) {
                await gatewayClient.request("auth.provideCode", {
                  loginRequestId,
                  code: result.code,
                });
              } else {
                await gatewayClient.request("auth.cancelLogin", { loginRequestId });
              }
            } catch (err) {
              setCodexAuthStatus({
                type: "error",
                message: err instanceof Error ? err.message : t("ai.codex.loginFailed"),
              });
            }
          })();
        }
        return;
      }

      if (event.type !== "auth.event") return;
      const authEvent = event.event as
        | { type: "auth_url"; url: string }
        | { type: "device_code"; userCode: string; verificationUri: string }
        | { type: "progress"; message: string }
        | { type: "info"; message: string };
      if (authEvent.type === "auth_url") {
        setCodexLoginUrl(authEvent.url);
        void openCodexLoginUrl(authEvent.url);
        setCodexAuthStatus({ type: "error", message: t("ai.codex.completeInBrowser") });
      } else if (authEvent.type === "device_code") {
        setCodexAuthStatus({
          type: "error",
          message: `${t("ai.codex.deviceCode")}: ${authEvent.userCode} — ${authEvent.verificationUri}`,
        });
        setCodexLoginUrl(authEvent.verificationUri);
        void openCodexLoginUrl(authEvent.verificationUri);
      } else if (authEvent.type === "progress" || authEvent.type === "info") {
        setCodexAuthStatus({ type: "error", message: authEvent.message });
      }
    });
    try {
      await gatewayClient.request("auth.login", { requestId: loginRequestId, method });
      loginFinished = true;
      dismissPrompt();
      setCodexLoginUrl(null);
      setCodexAuthStatus({ type: "success" });
      void loadModels();
    } catch (err) {
      setCodexAuthStatus({
        type: "error",
        message: err instanceof Error ? err.message : t("ai.codex.loginFailed"),
      });
    } finally {
      setCodexLoginInProgress(false);
      off();
    }
  };

  const handleCodexLogout = async () => {
    setCodexAuthStatus({ type: "loading" });
    try {
      await gatewayClient.request("auth.logout");
      setCodexAuthStatus({ type: "error", message: t("ai.codex.notConnected") });
    } catch (err) {
      setCodexAuthStatus({
        type: "error",
        message: err instanceof Error ? err.message : t("ai.codex.gatewayUnavailable"),
      });
    }
  };

  const handleSave = () => {
    const keyToSave = localKey[activeProvider];
    if (keyToSave !== "") {
      setProviderKey(activeProvider, keyToSave);
      setLocalKey((prev) => ({ ...prev, [activeProvider]: "" }));
      void loadModels();
    }
    setSaveStatus({ type: "success" });
    setTimeout(() => setSaveStatus({ type: "idle" }), 2000);
  };

  const handleTestConnection = async () => {
    const apiKey = activeApiKey;
    const model = providers[activeProvider].model;

    if (activeProvider !== "openai-codex" && !apiKey) {
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
              variant={activeProvider === id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleProviderChange(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      {/* API Key / Codex login */}
      {activeProvider === "openai-codex" ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("ai.codex.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("ai.codex.description")}</p>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => void handleCodexLogin("browser")}
              disabled={codexLoginInProgress || codexAuthStatus.type === "loading"}
            >
              {codexAuthStatus.type === "loading" && (
                <Loader2 className="size-3 animate-spin mr-1" />
              )}
              {t("ai.codex.connectBrowser")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCodexLogin("device")}
              disabled={codexLoginInProgress || codexAuthStatus.type === "loading"}
            >
              {t("ai.codex.connectDevice")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCodexLogout()}
              disabled={codexLoginInProgress || codexAuthStatus.type === "loading"}
            >
              {t("ai.codex.logout")}
            </Button>
          </div>
          {codexAuthStatus.type === "success" && (
            <p className="text-xs text-green-600 dark:text-green-400">{t("ai.codex.connected")}</p>
          )}
          {codexAuthStatus.type === "error" && (
            <p className="text-xs text-muted-foreground">{codexAuthStatus.message}</p>
          )}
          {codexLoginUrl && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openCodexLoginUrl(codexLoginUrl)}
                >
                  {t("ai.codex.openLoginUrl")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(codexLoginUrl)}
                >
                  {t("ai.codex.copyLoginUrl")}
                </Button>
              </div>
              <p className="text-xs break-all text-muted-foreground font-mono">{codexLoginUrl}</p>
            </div>
          )}
        </section>
      ) : (
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
      )}

      {/* Model selector */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t("ai.model.title")}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadModels()}
            disabled={modelStatus.type === "loading" || !activeApiKey}
          >
            {modelStatus.type === "loading" && <Loader2 className="size-3 animate-spin mr-1" />}
            {t("ai.model.refresh")}
          </Button>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("ai.model.selectLabel")}</label>
          <select
            value={activeModel}
            onChange={(e) => setProviderModel(activeProvider, e.target.value)}
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            )}
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <Input
            value={activeModel}
            onChange={(e) => setProviderModel(activeProvider, e.target.value)}
            placeholder={t("ai.model.customPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">{t("ai.model.customHelp")}</p>
          {modelStatus.type === "success" && (
            <p className="text-xs text-green-600 dark:text-green-400">{t("ai.model.loaded")}</p>
          )}
          {modelStatus.type === "error" && (
            <p className="text-xs text-destructive">{modelStatus.message}</p>
          )}
        </div>
      </section>

      {/* Custom instructions */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("ai.customInstructions.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("ai.customInstructions.description")}</p>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder={t("ai.customInstructions.placeholder")}
          rows={4}
          className={cn(
            "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            "resize-none transition-colors"
          )}
        />
      </section>

      {/* Tool confirmation */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("ai.toolConfirmation.title")}</h2>
        <div className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t("ai.toolConfirmation.enableLabel")}</p>
            <p className="text-xs text-muted-foreground">{t("ai.toolConfirmation.description")}</p>
            {!requireToolConfirmation && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {t("ai.toolConfirmation.disabledWarning")}
              </p>
            )}
          </div>
          <Button
            variant={requireToolConfirmation ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
            onClick={() => setRequireToolConfirmation(!requireToolConfirmation)}
          >
            {requireToolConfirmation ? t("aiChat.on") : t("aiChat.off")}
          </Button>
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
