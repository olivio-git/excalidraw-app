import type { StateStorage } from "zustand/middleware";
import type { RunState, RunTrigger, StepRecord } from "./executor";

/**
 * Past runs of each flow, kept outside the workspace (app data) so `.flow3d`
 * files stay clean. Data is trimmed: the history is for looking back and
 * comparing, not for storing whole API responses.
 */

export interface RunHistoryEntry {
  id: string;
  flowPath: string;
  /** Calendar time (ms since epoch). */
  startedAt: number;
  /** Seconds. */
  duration: number;
  status: RunState["status"];
  trigger: RunTrigger;
  error?: string;
  /** Hash of the flow's structure when it ran (results can go stale). */
  signature: string;
  run: RunState;
}

export const HISTORY_LIMIT = 20;
const VALUE_LIMIT = 8_000;

/** Long values are cut so the history stays small. */
export function trimValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
  if (text === undefined || text.length <= VALUE_LIMIT) return value;
  return `${text.slice(0, VALUE_LIMIT)}… (recortado: ${text.length} caracteres)`;
}

function trimStep(step: StepRecord): StepRecord {
  return { ...step, input: trimValue(step.input), output: trimValue(step.output) };
}

export function toHistoryEntry(
  flowPath: string,
  run: RunState,
  signature: string
): RunHistoryEntry {
  const steps = Object.fromEntries(
    Object.entries(run.steps).map(([id, step]) => [id, trimStep(step)])
  );
  return {
    id: `${run.startedWall}-${Math.random().toString(36).slice(2, 7)}`,
    flowPath,
    startedAt: run.startedWall,
    duration: run.finishedAt !== undefined ? (run.finishedAt - run.startedAt) / 1000 : 0,
    status: run.status,
    trigger: run.trigger ?? "manual",
    error: run.error,
    signature,
    run: { ...run, steps },
  };
}

type Listener = (entries: RunHistoryEntry[]) => void;

export interface RunHistoryStore {
  list: (flowPath: string) => Promise<RunHistoryEntry[]>;
  add: (entry: RunHistoryEntry) => Promise<RunHistoryEntry[]>;
  clear: (flowPath: string) => Promise<void>;
  subscribe: (flowPath: string, listener: Listener) => () => void;
}

const KEY = "runs";

/** History persisted in a key-value storage (Tauri store in the app). */
export function createRunHistory(storage: StateStorage): RunHistoryStore {
  let cache: Record<string, RunHistoryEntry[]> | null = null;
  const listeners = new Map<string, Set<Listener>>();
  const load = async () => {
    if (cache) return cache;
    try {
      const raw = await storage.getItem(KEY);
      cache = raw ? (JSON.parse(raw as string) as Record<string, RunHistoryEntry[]>) : {};
    } catch {
      cache = {};
    }
    return cache;
  };
  const persist = async () => {
    try {
      await storage.setItem(KEY, JSON.stringify(cache ?? {}));
    } catch {
      // Losing the history is not worth interrupting the user.
    }
  };
  const notify = (flowPath: string) => {
    const entries = cache?.[flowPath] ?? [];
    listeners.get(flowPath)?.forEach((listener) => listener(entries));
  };
  return {
    list: async (flowPath) => (await load())[flowPath] ?? [],
    add: async (entry) => {
      const all = await load();
      const entries = [entry, ...(all[entry.flowPath] ?? [])].slice(0, HISTORY_LIMIT);
      all[entry.flowPath] = entries;
      await persist();
      notify(entry.flowPath);
      return entries;
    },
    clear: async (flowPath) => {
      const all = await load();
      delete all[flowPath];
      await persist();
      notify(flowPath);
    },
    subscribe: (flowPath, listener) => {
      const set = listeners.get(flowPath) ?? new Set();
      set.add(listener);
      listeners.set(flowPath, set);
      return () => set.delete(listener);
    },
  };
}

/** What makes a run's results comparable to the flow: steps, links and configuration. */
export function flowSignature(doc: {
  nodes: Array<{ id: string; kind: string; config?: unknown }>;
  edges: Array<{ from: string; to: string }>;
}): string {
  const text = JSON.stringify([
    doc.nodes.map((n) => [n.id, n.kind, n.config ?? null]),
    doc.edges.map((e) => [e.from, e.to]),
  ]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** "hace 3 min" style time for the history. */
export function relativeTime(time: number, now = Date.now()): string {
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "hace un momento";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(time).toLocaleString();
}
