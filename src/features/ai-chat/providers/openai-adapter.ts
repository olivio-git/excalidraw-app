import { OpenAICompatAdapter } from "./openai-compat-adapter";

export class OpenAIAdapter extends OpenAICompatAdapter {
  constructor() {
    super("openai", "https://api.openai.com/v1");
  }
}
