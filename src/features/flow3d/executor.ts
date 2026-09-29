import {
  NODE_KINDS,
  nodeDuration,
  type FlowDocument,
  type FlowEdge,
  type FlowNode,
  type StepConfig,
} from "./model";
import type { Timeline, TimelineSpan } from "./timeline";

/**
 * Real execution of a flow. Runs from the triggers like the simulated
 * timeline, but each step does its work (HTTP, terminal, AI, app command,
 * write a note, JSON template, condition) and passes its JSON output to the
 * next steps. Every step is recorded (input, output, error, timing) and the
 * records double as a timeline, so the 3D scene animates the actual run.
 *
 * Platform work goes through `ExecutorServices`, injected by the caller (the
 * app wires Tauri; tests pass fakes).
 */

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut?: boolean;
}

export interface ExecutorServices {
  http: (request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  }) => Promise<HttpResponse>;
  shell: (request: { command: string; cwd?: string; timeoutMs: number }) => Promise<CommandResult>;
  appCommand: (id: string) => Promise<void>;
  ai: (request: { prompt: string; system?: string; signal?: AbortSignal }) => Promise<string>;
  writeFile: (request: { path: string; content: string; append: boolean }) => Promise<string>;
}

export type StepStatus = "running" | "done" | "error" | "skipped";

export interface StepRecord {
  nodeId: string;
  status: StepStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  /** Seconds since the run started. */
  start: number;
  end?: number;
  /** Edge the output left through (conditions pick one). */
  via?: string[];
  /** Attempts it took (retries). */
  attempts?: number;
}

export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface RunState {
  status: RunStatus;
  steps: Record<string, StepRecord>;
  /** Packets travelling between steps, in seconds since the run started. */
  edges: TimelineSpan[];
  order: string[];
  error?: string;
  /** Run clock start, `now()` milliseconds (performance.now() in the app). */
  startedAt: number;
  finishedAt?: number;
  /** Calendar time the run started (Date.now()), for the history. */
  startedWall: number;
  /** What started it. */
  trigger?: RunTrigger;
}

export type RunTrigger = "manual" | "schedule" | "file";

export interface RunOptions {
  services: ExecutorServices;
  signal?: AbortSignal;
  /** Seconds a packet travels between steps (visible in the scene). */
  edgeDuration?: number;
  /** Minimum seconds a step stays "running", so instant steps are visible. */
  minStepDuration?: number;
  /** Called after every change with a fresh copy of the run. */
  onUpdate?: (run: RunState) => void;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Initial payload for triggers without a configured one. */
  payload?: unknown;
  /** Start only from these triggers (automations); default: every trigger. */
  startAt?: string[];
  /** Values for `{{secrets.NAME}}`; they never appear in the recorded data. */
  secrets?: Record<string, string>;
  trigger?: RunTrigger;
}

export const STEP_TYPES: Record<
  StepConfig["type"],
  { label: string; sideEffect: boolean; description: string }
> = {
  manual: { label: "Datos iniciales", sideEffect: false, description: "JSON con el que arranca" },
  schedule: {
    label: "Horario",
    sideEffect: false,
    description: "Se ejecuta solo cada cierto tiempo",
  },
  fileWatch: {
    label: "Cambio de archivo",
    sideEffect: false,
    description: "Se ejecuta al cambiar un archivo o carpeta",
  },
  http: { label: "Petición HTTP", sideEffect: true, description: "Llama a una URL" },
  command: { label: "Comando de terminal", sideEffect: true, description: "Ejecuta en el shell" },
  appCommand: {
    label: "Comando de la app",
    sideEffect: true,
    description: "Lanza un comando registrado",
  },
  ai: { label: "Llamada a IA", sideEffect: true, description: "Usa el proveedor de IA activo" },
  writeNote: {
    label: "Escribir nota",
    sideEffect: true,
    description: "Escribe o añade a un archivo",
  },
  template: { label: "Plantilla JSON", sideEffect: false, description: "Construye datos nuevos" },
  condition: { label: "Condición", sideEffect: false, description: "Compara un valor" },
};

/** Default step type for a kind, when the user turns execution on. */
export function defaultStepConfig(kind: FlowNode["kind"]): StepConfig | undefined {
  switch (kind) {
    case "trigger":
      return { type: "manual", payload: '{\n  "mensaje": "hola"\n}' };
    case "action":
      return { type: "http", method: "GET", url: "https://" };
    case "condition":
      return { type: "condition", field: "status", operator: "==", value: "200" };
    case "transform":
      return { type: "template", template: '{\n  "resultado": "{{input}}"\n}' };
    case "ai":
      return { type: "ai", prompt: "Resume en una frase:\n{{input}}" };
    case "output":
      return { type: "writeNote", path: "salida.md", content: "{{input}}", append: true };
    default:
      return undefined;
  }
}

/** Steps that change something outside the flow: they need confirmation to run. */
export function sideEffectSteps(doc: FlowDocument): FlowNode[] {
  return doc.nodes.filter(
    (node) =>
      NODE_KINDS[node.kind].executes &&
      node.config &&
      STEP_TYPES[node.config.type]?.sideEffect &&
      !(node.config.type === "http" && (node.config.method ?? "GET").toUpperCase() === "GET")
  );
}

// ── Data helpers ───────────────────────────────────────────────────────────

/** Read `a.b.0.c` from a value. */
export function getPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value;
  let current: unknown = value;
  for (const key of path.trim().split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "string") {
      // Let `body.x` reach into a JSON string body.
      try {
        current = JSON.parse(current);
      } catch {
        return undefined;
      }
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export interface TemplateScope {
  input: unknown;
  steps: Record<string, { output?: unknown }>;
  /** Current element and position while repeating a step over a list. */
  item?: unknown;
  index?: number;
  secrets?: Record<string, string>;
}

/** A `{{secrets.X}}` that has no value. */
export class MissingSecretError extends Error {}

function resolveExpression(expression: string, scope: TemplateScope): unknown {
  const path = expression.trim();
  if (path === "input") return scope.input;
  if (path === "item") return scope.item;
  if (path.startsWith("item.")) return getPath(scope.item, path.slice(5));
  if (path === "index") return scope.index;
  if (path.startsWith("secrets.")) {
    const name = path.slice(8);
    const value = scope.secrets?.[name];
    if (value === undefined)
      throw new MissingSecretError(`Falta el secreto «${name}» (botón Secretos)`);
    return value;
  }
  if (path.startsWith("input.")) return getPath(scope.input, path.slice(6));
  if (path.startsWith("steps.")) {
    const [, id, ...rest] = path.split(".");
    const step = scope.steps[id];
    if (!step) return undefined;
    const tail = rest[0] === "output" ? rest.slice(1) : rest;
    return getPath(step.output, tail.join("."));
  }
  return getPath(scope.input, path);
}

const stringify = (value: unknown): string =>
  value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

/**
 * Fill `{{input.a.b}}` / `{{steps.id.output.x}}` placeholders. In JSON mode a
 * placeholder that is a whole JSON string (`"{{input}}"`) is replaced by the
 * value itself, and strings are escaped, so the result stays valid JSON.
 */
export function renderTemplate(
  template: string,
  scope: TemplateScope,
  mode: "text" | "json" = "text"
): string {
  if (mode === "json") {
    const whole = template.replace(/"\{\{([^}]+)\}\}"/g, (_, expr: string) => {
      const value = resolveExpression(expr, scope);
      return JSON.stringify(value === undefined ? null : value);
    });
    return whole.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) =>
      JSON.stringify(stringify(resolveExpression(expr, scope))).slice(1, -1)
    );
  }
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) =>
    stringify(resolveExpression(expr, scope))
  );
}

/** Parse JSON when possible, otherwise keep the text. */
export function looseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export function evaluateCondition(
  config: Extract<StepConfig, { type: "condition" }>,
  input: unknown
): boolean {
  const actual = getPath(input, config.field ?? "");
  const expected = config.value ?? "";
  const asNumber = (v: unknown) => (typeof v === "number" ? v : Number(v));
  switch (config.operator) {
    case "!=":
      return String(actual ?? "") !== expected;
    case ">":
      return asNumber(actual) > Number(expected);
    case "<":
      return asNumber(actual) < Number(expected);
    case ">=":
      return asNumber(actual) >= Number(expected);
    case "<=":
      return asNumber(actual) <= Number(expected);
    case "contains":
      return stringify(actual).includes(expected);
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "truthy":
      return Boolean(actual) && actual !== "false" && actual !== "0";
    default:
      return String(actual ?? "") === expected;
  }
}

const TRUE_LABEL = /^(s[ií]|yes|true|verdadero|ok|v[aá]lido)$/i;
const FALSE_LABEL = /^(no|false|falso|error|inv[aá]lido)$/i;

/** The edge a condition leaves through: labelled sí/no, else first/second. */
export function conditionEdge(outgoing: FlowEdge[], result: boolean): FlowEdge | undefined {
  if (outgoing.length <= 1) return result ? outgoing[0] : undefined;
  const yes = outgoing.find((e) => TRUE_LABEL.test(e.label?.trim() ?? ""));
  const no = outgoing.find((e) => FALSE_LABEL.test(e.label?.trim() ?? ""));
  if (result) return yes ?? outgoing.find((e) => e !== no) ?? outgoing[0];
  return no ?? outgoing.find((e) => e !== yes && e !== outgoing[0]) ?? outgoing[1];
}

// ── Running ────────────────────────────────────────────────────────────────

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

class Cancelled extends Error {}

async function runStep(
  node: FlowNode,
  input: unknown,
  scope: TemplateScope,
  services: ExecutorServices,
  signal: AbortSignal
): Promise<unknown> {
  const config = node.config;
  if (!config) return input;
  const text = (template: string | undefined) => renderTemplate(template ?? "", scope);
  switch (config.type) {
    case "manual":
      return config.payload?.trim() ? looseJson(text(config.payload)) : input;
    case "schedule":
    case "fileWatch":
      // The automation passes what started the run ({ trigger, at | path }).
      return input;
    case "template":
      return looseJson(renderTemplate(config.template ?? "", scope, "json"));
    case "condition":
      return input;
    case "http": {
      const url = text(config.url).trim();
      if (!/^https?:\/\//i.test(url)) throw new Error(`URL no válida: «${url}»`);
      const headers: Record<string, string> = {};
      for (const line of text(config.headers).split("\n")) {
        const index = line.indexOf(":");
        if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      }
      const method = (config.method ?? "GET").toUpperCase();
      const body =
        method === "GET" || method === "HEAD" || !config.body?.trim()
          ? undefined
          : renderTemplate(config.body, scope, "json");
      if (
        body !== undefined &&
        !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")
      )
        headers["Content-Type"] = "application/json";
      const response = await services.http({ method, url, headers, body, signal });
      if (response.status >= 400 && !config.allowErrors) {
        throw new Error(`HTTP ${response.status}: ${stringify(response.body).slice(0, 300)}`);
      }
      return response;
    }
    case "command": {
      const command = text(config.command).trim();
      if (!command) throw new Error("El comando está vacío");
      const result = await services.shell({
        command,
        cwd: config.cwd?.trim() ? text(config.cwd) : undefined,
        timeoutMs: Math.max(1, config.timeout ?? 30) * 1000,
      });
      if (result.timedOut) throw new Error(`El comando superó ${config.timeout ?? 30}s`);
      if (result.code !== 0 && !config.allowErrors) {
        throw new Error(
          `Salió con código ${result.code ?? "?"}${result.stderr ? `: ${result.stderr.trim().slice(0, 400)}` : ""}`
        );
      }
      return { ...result, json: looseJson(result.stdout) };
    }
    case "appCommand": {
      if (!config.command?.trim()) throw new Error("Elige un comando");
      await services.appCommand(config.command.trim());
      return input;
    }
    case "ai": {
      const prompt = text(config.prompt).trim();
      if (!prompt) throw new Error("El prompt está vacío");
      const answer = await services.ai({
        prompt,
        system: config.system?.trim() ? text(config.system) : undefined,
        signal,
      });
      return config.json ? looseJson(answer.replace(/^```(?:json)?\s*|\s*```$/g, "")) : answer;
    }
    case "writeNote": {
      const path = text(config.path).trim();
      if (!path) throw new Error("Indica el archivo");
      const content = text(config.content ?? "{{input}}");
      const written = await services.writeFile({ path, content, append: Boolean(config.append) });
      return { path: written, bytes: content.length, input };
    }
  }
}

/** Repeat over a list and retry on failure, around one step's work. */
async function runWithOptions(
  node: FlowNode,
  input: unknown,
  scope: TemplateScope,
  services: ExecutorServices,
  signal: AbortSignal,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  onAttempt: (attempt: number) => void
): Promise<unknown> {
  const config = node.config;
  const retries = Math.max(0, Math.min(10, Math.floor(config?.retries ?? 0)));
  const attempt = async (run: () => Promise<unknown>) => {
    for (let i = 0; ; i++) {
      onAttempt(i + 1);
      try {
        return await run();
      } catch (error) {
        if (i >= retries || signal.aborted || error instanceof MissingSecretError) throw error;
        await sleep(Math.max(0, config?.retryDelay ?? 2) * 1000, signal);
      }
    }
  };
  const list = config?.forEach?.trim();
  if (!list || !config || config.type === "condition") {
    return attempt(() => runStep(node, input, scope, services, signal));
  }
  const items = list === "input" ? input : getPath(input, list);
  if (!Array.isArray(items)) throw new Error(`«${list}» no es una lista`);
  const results: unknown[] = [];
  for (let index = 0; index < items.length; index++) {
    if (signal.aborted) throw new Cancelled();
    const item = items[index];
    results.push(
      await attempt(() => runStep(node, input, { ...scope, item, index }, services, signal))
    );
  }
  return results;
}

/** Replace secret values with dots wherever they appear in recorded data. */
export function redact(value: unknown, secrets: string[]): unknown {
  if (secrets.length === 0) return value;
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) text = text.split(secret).join("••••");
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, secrets)])
    );
  }
  return value;
}

export function emptyRun(now: number, trigger: RunTrigger = "manual"): RunState {
  return {
    status: "running",
    steps: {},
    edges: [],
    order: [],
    startedAt: now,
    startedWall: Date.now(),
    trigger,
  };
}

/**
 * Execute the flow. Resolves with the final run (never throws for step
 * errors: they are recorded on the step and stop that branch only; the run
 * ends with status "error" if any step failed).
 */
export async function executeFlow(doc: FlowDocument, options: RunOptions): Promise<RunState> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? defaultSleep;
  const edgeDuration = options.edgeDuration ?? 0.6;
  const minStep = options.minStepDuration ?? 0.45;
  const controller = new AbortController();
  const signal = controller.signal;
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  if (options.signal?.aborted) controller.abort();

  const run = emptyRun(now(), options.trigger);
  // Secrets shorter than 4 characters would mangle ordinary text when hidden.
  const hidden = Object.values(options.secrets ?? {}).filter((s) => s.length >= 4);
  const clean = (value: unknown) => redact(value, hidden);
  const seconds = () => (now() - run.startedAt) / 1000;
  const emit = () =>
    options.onUpdate?.({
      ...run,
      steps: { ...run.steps },
      edges: [...run.edges],
      order: [...run.order],
    });

  const nodes = new Map(doc.nodes.filter((n) => NODE_KINDS[n.kind].executes).map((n) => [n.id, n]));
  const outgoing = new Map<string, FlowEdge[]>();
  const incoming = new Set<string>();
  for (const edge of doc.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.add(edge.to);
  }
  const triggers = [...nodes.values()].filter(
    (n) => n.kind === "trigger" && (!options.startAt || options.startAt.includes(n.id))
  );
  const starts =
    triggers.length > 0 ? triggers : [...nodes.values()].filter((n) => !incoming.has(n.id));
  // Real outputs feed the templates; the records keep redacted copies.
  const outputs: Record<string, { output?: unknown }> = {};
  const scope: TemplateScope = { input: null, steps: outputs, secrets: options.secrets };
  const claimed = new Set<string>();

  const visit = async (node: FlowNode, input: unknown): Promise<void> => {
    if (claimed.has(node.id)) return;
    claimed.add(node.id);
    if (signal.aborted) throw new Cancelled();
    const started = now();
    const record: StepRecord = {
      nodeId: node.id,
      status: "running",
      input: clean(input),
      start: seconds(),
    };
    run.steps[node.id] = record;
    run.order.push(node.id);
    emit();
    let output: unknown;
    try {
      output = await runWithOptions(
        node,
        input,
        { ...scope, input },
        options.services,
        signal,
        sleep,
        (attempt) => {
          record.attempts = attempt;
          if (attempt > 1) {
            run.steps[node.id] = { ...record };
            emit();
          }
        }
      );
      // Keep instant steps on screen for a moment; configured duration acts as a floor too.
      const floor = node.config ? minStep : Math.max(minStep, nodeDuration(node) * 0.5);
      await sleep(floor * 1000 - (now() - started), signal);
      if (signal.aborted) throw new Cancelled();
    } catch (error) {
      if (error instanceof Cancelled || signal.aborted) {
        run.steps[node.id] = { ...record, status: "error", error: "Cancelado", end: seconds() };
        throw new Cancelled();
      }
      run.steps[node.id] = {
        ...record,
        status: "error",
        error: String(clean(error instanceof Error ? error.message : String(error))),
        end: seconds(),
      };
      emit();
      return;
    }
    let next = outgoing.get(node.id) ?? [];
    if (node.kind === "condition") {
      if (node.config?.type === "condition") {
        const chosen = conditionEdge(next, evaluateCondition(node.config, input));
        next = chosen ? [chosen] : [];
      } else if (next.length > 1) {
        next = [next.find((e) => e.id === node.branch) ?? next[0]];
      }
    }
    const end = seconds();
    outputs[node.id] = { output };
    run.steps[node.id] = {
      ...record,
      status: "done",
      output: clean(output),
      end,
      via: next.map((e) => e.id),
    };
    for (const edge of next) run.edges.push({ id: edge.id, start: end, end: end + edgeDuration });
    emit();
    await sleep(edgeDuration * 1000, signal);
    await Promise.all(
      next.map((edge) => {
        const target = nodes.get(edge.to);
        return target ? visit(target, output) : Promise.resolve();
      })
    );
  };

  try {
    await Promise.all(starts.map((node) => visit(node, options.payload ?? {})));
    const failed = Object.values(run.steps).find((s) => s.status === "error");
    run.status = failed ? "error" : "done";
    if (failed) run.error = failed.error;
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    run.status = "cancelled";
  }
  for (const node of nodes.values()) {
    if (!run.steps[node.id])
      run.steps[node.id] = { nodeId: node.id, status: "skipped", input: undefined, start: 0 };
  }
  run.finishedAt = now();
  emit();
  return run;
}

/**
 * The run as a timeline for the scene: steps that are still running have an
 * open end (`Infinity`), packets end when they reach the next step.
 */
export function runTimeline(run: RunState): Timeline {
  const nodes: TimelineSpan[] = [];
  for (const id of run.order) {
    const step = run.steps[id];
    if (!step || step.status === "skipped") continue;
    nodes.push({ id, start: step.start, end: step.end ?? Infinity });
  }
  const finished = run.status !== "running";
  const ends = [...nodes.map((s) => s.end), ...run.edges.map((s) => s.end)].filter(Number.isFinite);
  const elapsed = finished && run.finishedAt ? (run.finishedAt - run.startedAt) / 1000 : 0;
  return {
    nodes,
    edges: run.edges,
    order: nodes.map((s) => s.id),
    duration: finished ? Math.max(0, ...ends, elapsed) : Infinity,
  };
}
