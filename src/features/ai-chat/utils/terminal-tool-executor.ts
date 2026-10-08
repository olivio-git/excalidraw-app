import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { AIToolResult } from "../providers/types";

/** The terminal where the agent's commands run (one, reused across commands). */
export const AGENT_TERMINAL = "Agente";

const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;
/** Output returned to the model per stream: the end of it, where errors usually are. */
const MAX_STDOUT = 12_000;
const MAX_STDERR = 8_000;

const fail = (message: string): AIToolResult => ({
  toolCallId: "",
  result: message,
  isError: true,
});

function splitPath(path: string): { prefix: string; parts: string[] } {
  const prefix = path.startsWith("\\\\") ? "\\\\" : /^[\\/]/.test(path) ? "/" : "";
  const parts: string[] = [];
  for (const part of path.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    // ".." never climbs above the drive ("C:").
    else if (parts.length > (/^[a-zA-Z]:$/.test(parts[0] ?? "") ? 1 : 0)) parts.pop();
  }
  return { prefix, parts };
}

/**
 * `path` (relative to `root`, or absolute) as a normalized absolute path, or
 * null when it is outside `root`.
 */
export function resolveInsideWorkspace(root: string, path?: string): string | null {
  const raw = path?.trim() || ".";
  const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(raw);
  const base = splitPath(root);
  const target = splitPath(absolute ? raw : `${root}/${raw}`);
  const windows = base.prefix !== "/";
  const same = (a: string, b: string | undefined) =>
    windows ? a.toLowerCase() === b?.toLowerCase() : a === b;
  if (target.prefix !== base.prefix || !base.parts.every((part, i) => same(part, target.parts[i])))
    return null;
  if (target.prefix === "/") return `/${target.parts.join("/")}`;
  return `${target.prefix}${target.parts.join("\\")}`;
}

// Colours, cursor moves and terminal titles: noise for the model.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Terminal output as the model should read it: without escape codes, with
 * progress lines (redrawn with "\r") reduced to their last state, and only the
 * last `max` characters.
 */
export function outputForModel(text: string, max: number): string {
  const clean = text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.replace(/\r+$/, "").split("\r").pop() ?? "")
    .join("\n");
  if (clean.length <= max) return clean;
  return `[… ${clean.length - max} caracteres anteriores omitidos]\n${clean.slice(-max)}`;
}

/** Runs the terminal_* chat tools. */
export async function executeTerminalTool(
  toolName: string,
  toolInput: unknown,
  signal?: AbortSignal
): Promise<AIToolResult> {
  if (toolName !== "terminal_run") return fail(`Unknown tool: ${toolName}`);
  const input = (toolInput ?? {}) as { command?: unknown; cwd?: unknown; timeout?: unknown };
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) return fail("command is required.");
  const root = useWorkspaceStore.getState().workspaceDir;
  if (!root) return fail("No workspace folder is open.");
  const cwd = resolveInsideWorkspace(root, typeof input.cwd === "string" ? input.cwd : undefined);
  if (!cwd) return fail(`cwd must be a folder inside the workspace (${root}).`);
  const seconds = Number(input.timeout);
  const timeout =
    Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_TIMEOUT) : DEFAULT_TIMEOUT;

  try {
    const { runInOutputTerminal } = await import("@/features/terminal/output-terminal");
    const result = await runInOutputTerminal(AGENT_TERMINAL, {
      command,
      cwd,
      timeoutMs: timeout * 1000,
      signal,
    });
    const ok = result.code === 0 && !result.timedOut && !result.killed;
    return {
      toolCallId: "",
      isError: !ok,
      result: JSON.stringify({
        code: result.code,
        ...(result.timedOut && { timedOut: `stopped after ${timeout}s` }),
        ...(result.killed && { stopped: "the user stopped the command" }),
        stdout: outputForModel(result.stdout, MAX_STDOUT),
        stderr: outputForModel(result.stderr, MAX_STDERR),
      }),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
