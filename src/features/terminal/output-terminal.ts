import { runCommand, type CommandOutput, type RunCommandOptions } from "./command-runner";
import {
  createVirtualTerminal,
  getTerminalSession,
  showTerminalPanel,
  type TerminalSession,
} from "./terminal-service";

/**
 * Terminals that show the commands the app runs on your behalf (flow steps,
 * the agent's `terminal_run`) while they run: one per name, reused across
 * runs. They take no input except Ctrl+C, which stops what is running in
 * them; closing one stops it too.
 */

interface OutputTerminal {
  session: TerminalSession;
  running: Set<AbortController>;
}

const terminals = new Map<string, OutputTerminal>();

const stopAll = (running: Set<AbortController>) => running.forEach((c) => c.abort());

function outputTerminal(name: string): OutputTerminal {
  const existing = terminals.get(name);
  if (existing && getTerminalSession(existing.session.id)) return existing;
  const running = new Set<AbortController>();
  const session = createVirtualTerminal({
    name,
    show: false,
    onInput: (data) => {
      if (data.includes("\x03")) stopAll(running);
    },
    onClose: () => {
      stopAll(running);
      terminals.delete(name);
    },
  });
  // Pipes end lines with "\n" only.
  session.term.options.convertEol = true;
  session.term.options.cursorBlink = false;
  session.write("\x1b[?25l");
  const entry = { session, running };
  terminals.set(name, entry);
  return entry;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** How a command ended, as one coloured line. */
export function describeEnd(result: CommandOutput, elapsedMs: number, timeoutMs: number): string {
  const time = `\x1b[90m · ${seconds(elapsedMs)}\x1b[0m`;
  if (result.killed) return `\x1b[33m■ Detenido\x1b[0m${time}`;
  if (result.timedOut)
    return `\x1b[33m■ Superó el límite de ${Math.round(timeoutMs / 1000)} s\x1b[0m${time}`;
  if (result.code === 0) return `\x1b[32m✓ Terminó bien\x1b[0m${time}`;
  return `\x1b[31m✗ Salió con código ${result.code ?? "?"}\x1b[0m${time}`;
}

export interface OutputTerminalRun extends Omit<RunCommandOptions, "onOutput"> {
  /** Heading above the command (the flow step that runs it). */
  title?: string;
  /** Applied to everything shown (hides secrets); the result is returned untouched. */
  hide?: (text: string) => string;
}

/** Run a command and show it, its output and how it ended in the terminal `name`. */
export async function runInOutputTerminal(
  name: string,
  options: OutputTerminalRun
): Promise<CommandOutput> {
  const { title, hide = (text: string) => text, signal, ...request } = options;
  const { session, running } = outputTerminal(name);
  showTerminalPanel(session.id, { focus: false });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  running.add(controller);
  if (title) session.write(`\r\n\x1b[1m▶ ${hide(title)}\x1b[0m\r\n`);
  else session.write("\r\n");
  session.write(`\x1b[36m$\x1b[0m ${hide(request.command)}\r\n`);
  const started = performance.now();
  let atLineStart = true;
  try {
    const result = await runCommand({
      ...request,
      signal: controller.signal,
      onOutput: (data) => {
        session.write(hide(data));
        atLineStart = data.endsWith("\n");
      },
    });
    const end = describeEnd(result, performance.now() - started, request.timeoutMs);
    session.write(`${atLineStart ? "" : "\r\n"}${end}\r\n`);
    return result;
  } catch (error) {
    session.write(
      `\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`
    );
    throw error;
  } finally {
    running.delete(controller);
    signal?.removeEventListener("abort", abort);
  }
}
