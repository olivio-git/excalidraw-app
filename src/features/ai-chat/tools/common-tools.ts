import type { AIToolDefinition } from "../providers/types";

export const COMMON_TOOLS: AIToolDefinition[] = [
  {
    name: "ask_user",
    description:
      "Ask the user a clarifying question and wait for their response. " +
      "Use this ONLY when you genuinely need information to proceed — " +
      "prefer making reasonable decisions over asking.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to present to the user",
        },
      },
      required: ["question"],
    },
  },
];
