import type { AIProviderName } from "@/features/ai-chat/providers/types";

export const FALLBACK_PROVIDER_MODELS: Record<AIProviderName, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250514"],
  groq: ["openai/gpt-oss-120b"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["deepseek/deepseek-chat-v3-0324", "anthropic/claude-sonnet-4-5"],
  "openai-codex": ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-luna"],
};

function uniqueSorted(models: string[]) {
  return [...new Set(models.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function idsFromOpenAICompatibleResponse(data: unknown) {
  const items = Array.isArray((data as { data?: unknown }).data)
    ? (data as { data: unknown[] }).data
    : [];
  return uniqueSorted(
    items
      .map((item) => (item as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string")
  );
}

function idsFromGeminiResponse(data: unknown) {
  const items = Array.isArray((data as { models?: unknown }).models)
    ? (data as { models: unknown[] }).models
    : [];

  return uniqueSorted(
    items
      .filter((item) => {
        const methods = (item as { supportedGenerationMethods?: unknown })
          .supportedGenerationMethods;
        return Array.isArray(methods) && methods.includes("generateContent");
      })
      .map((item) => (item as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.replace(/^models\//, ""))
  );
}

function idsFromAnthropicResponse(data: unknown) {
  return idsFromOpenAICompatibleResponse(data);
}

export async function fetchProviderModels(
  provider: AIProviderName,
  apiKey: string
): Promise<string[]> {
  switch (provider) {
    case "openai":
      return idsFromOpenAICompatibleResponse(
        await fetchJson("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      );

    case "groq":
      return idsFromOpenAICompatibleResponse(
        await fetchJson("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      );

    case "openrouter":
      return idsFromOpenAICompatibleResponse(
        await fetchJson("https://openrouter.ai/api/v1/models", {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        })
      );

    case "gemini":
      return idsFromGeminiResponse(
        await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
      );

    case "anthropic":
      return idsFromAnthropicResponse(
        await fetchJson("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        })
      );

    case "openai-codex": {
      const { gatewayClient } = await import("@/features/ai-chat/gateway/gatewayClient");
      const result = await gatewayClient.request<{ models: { id: string }[] }>("models.list");
      return uniqueSorted(result.models.map((model) => model.id));
    }
  }
}
