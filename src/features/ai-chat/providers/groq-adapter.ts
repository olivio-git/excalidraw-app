import { OpenAICompatAdapter } from "./openai-compat-adapter";

export class GroqAdapter extends OpenAICompatAdapter {
  constructor() {
    super("groq", "https://api.groq.com/openai/v1");
  }
}
