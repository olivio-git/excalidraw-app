import type { AIProvider, AIProviderName } from "./types";

export class AIProviderFactory {
  static async create(name: AIProviderName): Promise<AIProvider> {
    switch (name) {
      case "anthropic": {
        const { AnthropicAdapter } = await import("./anthropic-adapter");
        return new AnthropicAdapter();
      }
      case "groq": {
        const { GroqAdapter } = await import("./groq-adapter");
        return new GroqAdapter();
      }
      case "openai": {
        const { OpenAIAdapter } = await import("./openai-adapter");
        return new OpenAIAdapter();
      }
      default:
        throw new Error(`Unknown AI provider: ${name}`);
    }
  }
}
