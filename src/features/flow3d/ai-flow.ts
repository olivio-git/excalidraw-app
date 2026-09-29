import { applyLayout } from "./layout";
import { NODE_KINDS, parseFlow, type FlowDocument } from "./model";
import type { RunState } from "./executor";

/**
 * The AI side of flows: create a flow from a description, explain why a step
 * failed, and describe a run so the chat can reason about it. The model only
 * ever produces flow JSON; `parseFlow` repairs it and the layout places it.
 */

type Ask = (request: { prompt: string; system?: string }) => Promise<string>;

export const FLOW_FORMAT_GUIDE = `A flow is JSON: { "name": string, "nodes": Node[], "edges": Edge[] }.
Node: { "id": short-kebab-id, "kind": one of trigger|action|condition|transform|ai|output|note, "label": short name in the user's language, "description"?: string, "config"?: StepConfig }.
Edge: { "id": string, "from": node id, "to": node id, "label"?: "sí"|"no" for condition branches }.
StepConfig (what the step does when executed), by "type":
- "manual": { payload: JSON string } — starting data (trigger).
- "schedule": { every: minutes } or { at: "HH:MM" } — trigger that runs by itself.
- "fileWatch": { path: file or folder relative to the flow } — trigger on file changes.
- "http": { method, url, headers?: "Name: value" lines, body?: JSON string, allowErrors? }.
- "command": { command, cwd?, timeout? seconds } — shell command; output { stdout, stderr, code, json }.
- "appCommand": { command: app command id }.
- "ai": { prompt, system?, json?: boolean }.
- "writeNote": { path, content, append? }.
- "template": { template: JSON string } — build new data.
- "condition": { field: path in input, operator: ==|!=|>|<|>=|<=|contains|exists|truthy, value } — leaves through the edge labelled "sí" when true, "no" when false.
Every executable config may add: forEach (path to a list: run once per element, use {{item}} and {{index}}), retries, retryDelay (seconds).
Text fields accept {{input.field}}, {{steps.<id>.output.field}} and {{secrets.NAME}} placeholders.
Start with exactly one trigger. Keep 3–10 steps. Use "note" nodes only for explanations.`;

const CREATE_SYSTEM = `You design automation flows for a 3D flow editor.
${FLOW_FORMAT_GUIDE}
Answer with the flow JSON only, no explanations, no code fences.`;

/** The first JSON object in a model answer (fences and chatter removed). */
export function extractJson(answer: string): unknown {
  const text = answer.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La IA no devolvió un flujo (JSON)");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new Error("La IA devolvió un JSON inválido", { cause: error });
  }
}

/** A flow from model output: repaired, laid out, always valid. */
export function flowFromAI(raw: unknown, fallbackName?: string): FlowDocument {
  const doc = parseFlow(JSON.stringify(raw ?? {}));
  if (doc.nodes.length === 0) throw new Error("La IA no propuso ningún paso");
  return applyLayout({ ...doc, name: doc.name || fallbackName });
}

export async function generateFlow(
  description: string,
  ask: Ask,
  name?: string
): Promise<FlowDocument> {
  const answer = await ask({ system: CREATE_SYSTEM, prompt: description });
  return flowFromAI(extractJson(answer), name);
}

const clip = (value: unknown, max = 1500) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text === undefined ? "—" : text.length > max ? `${text.slice(0, max)}…` : text;
};

/** Why a step failed and how to fix it, in plain words. */
export async function diagnoseStep(
  doc: FlowDocument,
  run: RunState,
  nodeId: string,
  ask: Ask
): Promise<string> {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const step = run.steps[nodeId];
  if (!node || !step) throw new Error("No hay datos de ese paso");
  const prompt = `A step of an automation flow ${step.status === "error" ? "failed" : "ran"}.
Step: "${node.label}" (${NODE_KINDS[node.kind].label}), id ${node.id}.
Configuration: ${clip(node.config ?? "none (simulation only)")}
Input it received: ${clip(step.input)}
${step.error ? `Error: ${step.error}` : `Output: ${clip(step.output)}`}
Previous steps: ${
    run.order
      .filter((id) => id !== nodeId)
      .map((id) => `${doc.nodes.find((n) => n.id === id)?.label ?? id} (${run.steps[id]?.status})`)
      .join(", ") || "none"
  }

Explain briefly (max 6 short lines) the most likely cause and the concrete change to make in the step configuration. Answer in Spanish.
${FLOW_FORMAT_GUIDE}`;
  return (await ask({ prompt })).trim();
}

/** A compact description of a run, for the chat. */
export function summarizeRun(doc: FlowDocument, run: RunState | null): string {
  if (!run) return "Todavía no se ha ejecutado.";
  const lines = run.order.map((id) => {
    const step = run.steps[id];
    const label = doc.nodes.find((n) => n.id === id)?.label ?? id;
    return `- ${label} [${id}]: ${step.status}${step.error ? ` — ${step.error}` : ""}${
      step.status === "done" ? ` → ${clip(step.output, 300)}` : ""
    }`;
  });
  return `Ejecución ${run.status} (${run.trigger ?? "manual"}):\n${lines.join("\n")}`;
}
