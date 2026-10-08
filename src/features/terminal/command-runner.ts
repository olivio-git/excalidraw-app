/**
 * Thin client over the one-shot command runner (`src-tauri/src/flow_exec.rs`):
 * runs a command line and resolves with its output. With `onOutput` the output
 * also arrives while the command runs (`exec:data` events, routed by run id),
 * and aborting `signal` stops the command and everything it started.
 */

export type OutputStream = "stdout" | "stderr";

export interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  /** Stopped through `signal`. */
  killed: boolean;
}

export interface RunCommandOptions {
  command: string;
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (data: string, stream: OutputStream) => void;
}

type Handler = (data: string, stream: OutputStream) => void;

const handlers = new Map<string, Handler>();
let listening: Promise<void> | null = null;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function ensureListening(): Promise<void> {
  listening ??= (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ runId: string; stream: OutputStream; data: string }>(
      "exec:data",
      ({ payload }) => handlers.get(payload.runId)?.(payload.data, payload.stream)
    );
  })();
  return listening;
}

export async function runCommand(options: RunCommandOptions): Promise<CommandOutput> {
  const { command, cwd, timeoutMs, signal, onOutput } = options;
  if (signal?.aborted) return { stdout: "", stderr: "", code: null, timedOut: false, killed: true };
  // Without a run id the command can't be stopped and streams nothing.
  const runId = signal || onOutput ? crypto.randomUUID() : undefined;
  const shown: Record<OutputStream, number> = { stdout: 0, stderr: 0 };
  if (runId && onOutput) {
    await ensureListening();
    handlers.set(runId, (data, stream) => {
      shown[stream] += data.length;
      onOutput(data, stream);
    });
  }
  const stop = () => void invoke("exec_kill", { runId }).catch(() => undefined);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const result = await invoke<CommandOutput>("flow_run_command", {
      command,
      cwd,
      timeoutMs,
      runId,
    });
    if (runId && onOutput) {
      // Events and the reply travel apart: let late output land, then show what never arrived.
      await new Promise((resolve) => setTimeout(resolve, 50));
      handlers.delete(runId);
      for (const stream of ["stdout", "stderr"] as const) {
        const missing = result[stream].slice(shown[stream]);
        if (missing) onOutput(missing, stream);
      }
    }
    return { ...result, killed: !!result.killed };
  } finally {
    if (runId) handlers.delete(runId);
    signal?.removeEventListener("abort", stop);
  }
}
