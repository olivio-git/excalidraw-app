import { NODE_KINDS, type FlowDocument } from "./model";
import type { RunTrigger } from "./executor";

/**
 * Flows that run by themselves. A flow opts in with `settings.automation`
 * (the user confirms it once, since steps then run without asking); its
 * triggers with a schedule or a file watch are armed while the workspace is
 * open. File triggers ignore changes made during and right after their own
 * run, so a flow that writes into the folder it watches doesn't loop.
 */

export type AutomationPlan =
  | { nodeId: string; label: string; kind: "interval"; minutes: number }
  | { nodeId: string; label: string; kind: "daily"; at: string }
  | { nodeId: string; label: string; kind: "watch"; path: string };

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function planAutomations(doc: FlowDocument): AutomationPlan[] {
  if (!doc.settings?.automation) return [];
  const plans: AutomationPlan[] = [];
  for (const node of doc.nodes) {
    if (node.kind !== "trigger" || !NODE_KINDS[node.kind].executes) continue;
    const config = node.config;
    const label = node.label || node.id;
    if (config?.type === "schedule") {
      if (config.every && config.every >= 1)
        plans.push({ nodeId: node.id, label, kind: "interval", minutes: config.every });
      else if (config.at && TIME.test(config.at.trim()))
        plans.push({ nodeId: node.id, label, kind: "daily", at: config.at.trim() });
    } else if (config?.type === "fileWatch" && config.path?.trim()) {
      plans.push({ nodeId: node.id, label, kind: "watch", path: config.path.trim() });
    }
  }
  return plans;
}

/** Next time a daily `HH:MM` trigger fires, after `now`. */
export function nextDailyRun(at: string, now: Date): Date {
  const [, hours, minutes] = TIME.exec(at.trim()) ?? [];
  const next = new Date(now);
  next.setHours(Number(hours), Number(minutes), 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function describePlan(plan: AutomationPlan): string {
  if (plan.kind === "interval")
    return plan.minutes === 1 ? "cada minuto" : `cada ${plan.minutes} minutos`;
  if (plan.kind === "daily") return `todos los días a las ${plan.at}`;
  return `al cambiar ${plan.path}`;
}

export interface AutomationDeps {
  listFlows: (root: string) => Promise<string[]>;
  readFlow: (path: string) => Promise<FlowDocument>;
  /** Watch a path; returns the function that stops watching. */
  watch: (path: string, onChange: (paths: string[]) => void) => Promise<() => void>;
  resolvePath: (path: string, flowPath: string) => string;
  run: (
    flowPath: string,
    doc: FlowDocument,
    nodeId: string,
    trigger: RunTrigger,
    payload: unknown
  ) => Promise<void>;
  now?: () => Date;
  /** Quiet period after a run in which its own file changes are ignored (ms). */
  quietMs?: number;
}

interface ArmedFlow {
  doc: FlowDocument;
  plans: AutomationPlan[];
  stops: Array<() => void>;
}

export class FlowAutomation {
  private flows = new Map<string, ArmedFlow>();
  private running = new Set<string>();
  private quietUntil = new Map<string, number>();
  private root: string | null = null;
  private stopRootWatch: (() => void) | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReload = new Set<string>();
  private listeners = new Set<() => void>();
  paused = false;

  private deps: AutomationDeps;

  constructor(deps: AutomationDeps) {
    this.deps = deps;
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  /** Active automations, for the UI. */
  list(): Array<{ path: string; name: string; plans: AutomationPlan[] }> {
    return [...this.flows.entries()].map(([path, flow]) => ({
      path,
      name: flow.doc.name ?? path.split(/[\\/]/).pop() ?? path,
      plans: flow.plans,
    }));
  }

  isRunning(path: string): boolean {
    return this.running.has(path);
  }

  async start(root: string): Promise<void> {
    await this.stop();
    this.root = root;
    const paths = await this.deps.listFlows(root).catch(() => []);
    if (this.root !== root) return;
    await Promise.all(paths.map((path) => this.load(path)));
    this.stopRootWatch = await this.deps
      .watch(root, (changed) => {
        for (const path of changed) if (/\.flow3d$/i.test(path)) this.pendingReload.add(path);
        if (this.pendingReload.size === 0) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          const reload = [...this.pendingReload];
          this.pendingReload.clear();
          reload.forEach((path) => void this.load(path));
        }, 800);
      })
      .catch(() => null);
    this.changed();
  }

  async stop(): Promise<void> {
    this.root = null;
    this.stopRootWatch?.();
    this.stopRootWatch = null;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    for (const path of [...this.flows.keys()]) this.disarm(path);
    this.changed();
  }

  private disarm(path: string) {
    this.flows.get(path)?.stops.forEach((stop) => stop());
    this.flows.delete(path);
  }

  /** (Re)arm one flow from its file; a flow without automations is dropped. */
  async load(path: string): Promise<void> {
    this.disarm(path);
    let doc: FlowDocument;
    try {
      doc = await this.deps.readFlow(path);
    } catch {
      this.changed();
      return;
    }
    const plans = planAutomations(doc);
    if (plans.length === 0) {
      this.changed();
      return;
    }
    const flow: ArmedFlow = { doc, plans, stops: [] };
    this.flows.set(path, flow);
    for (const plan of plans) {
      if (plan.kind === "interval") {
        const timer = setInterval(
          () =>
            void this.fire(path, plan.nodeId, "schedule", {
              trigger: "schedule",
              at: this.now().toISOString(),
            }),
          plan.minutes * 60_000
        );
        flow.stops.push(() => clearInterval(timer));
      } else if (plan.kind === "daily") {
        let timer: ReturnType<typeof setTimeout>;
        const arm = () => {
          const delay = nextDailyRun(plan.at, this.now()).getTime() - this.now().getTime();
          timer = setTimeout(() => {
            void this.fire(path, plan.nodeId, "schedule", {
              trigger: "schedule",
              at: this.now().toISOString(),
            });
            arm();
          }, delay);
        };
        arm();
        flow.stops.push(() => clearTimeout(timer));
      } else {
        const target = this.deps.resolvePath(plan.path, path);
        let debounce: ReturnType<typeof setTimeout> | undefined;
        let changedPaths = new Set<string>();
        const stop = await this.deps
          .watch(target, (paths) => {
            if (this.running.has(path) || Date.now() < (this.quietUntil.get(path) ?? 0)) return;
            paths.forEach((p) => changedPaths.add(p));
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              const files = [...changedPaths];
              changedPaths = new Set();
              void this.fire(path, plan.nodeId, "file", {
                trigger: "file",
                path: files[0] ?? target,
                paths: files,
              });
            }, 500);
          })
          .catch(() => null);
        flow.stops.push(() => {
          clearTimeout(debounce);
          stop?.();
        });
      }
    }
    this.changed();
  }

  /** Run a flow from one trigger (skipped while paused or already running). */
  async fire(
    path: string,
    nodeId: string,
    trigger: RunTrigger,
    payload: unknown
  ): Promise<boolean> {
    const flow = this.flows.get(path);
    if (!flow || this.paused || this.running.has(path)) return false;
    this.running.add(path);
    this.changed();
    try {
      await this.deps.run(path, flow.doc, nodeId, trigger, payload);
    } finally {
      this.running.delete(path);
      this.quietUntil.set(path, Date.now() + (this.deps.quietMs ?? 2000));
      this.changed();
    }
    return true;
  }
}
