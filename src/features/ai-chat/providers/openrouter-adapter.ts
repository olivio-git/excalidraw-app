import { OpenAICompatAdapter } from "./openai-compat-adapter";

export class OpenRouterAdapter extends OpenAICompatAdapter {
  constructor() {
    super("openrouter", "https://openrouter.ai/api/v1", {
      "HTTP-Referer": "https://excalidraw-app",
      "X-Title": "Excalidraw App",
    });
  }
}
