import type { AIToolDefinition } from "../providers/types";

/** Running shell commands for setup work, in a terminal the user watches. */
export const TERMINAL_TOOLS: AIToolDefinition[] = [
  {
    name: "terminal_run",
    description:
      'Run a shell command in the visible "Agente" terminal and return its exit code, stdout and stderr. The user confirms every command and watches its output live; they can stop it. Use it for setup work — start or check services (docker), install or check tools, inspect the environment — before building or running a flow, never for steps that belong in the flow itself. Non-interactive only: no command may wait for keyboard input.',
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command line, run by the system shell" },
        cwd: {
          type: "string",
          description:
            "Folder inside the workspace (relative or absolute); default: workspace root",
        },
        timeout: { type: "number", description: "Seconds, default 60, at most 600" },
      },
      required: ["command"],
    },
  },
];

export const TERMINAL_TOOL_NAMES: ReadonlySet<string> = new Set(TERMINAL_TOOLS.map((t) => t.name));
