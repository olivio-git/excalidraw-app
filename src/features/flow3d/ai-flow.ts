import { applyLayout, type FlowLayout, type LayoutOptions } from "./layout";
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
For automations: start with exactly one trigger; keep 3–10 steps. Use "note" nodes only for explanations.

VISUAL 3D DIAGRAMS (architectures, neural networks, matrices, stacks, towers, LEGO-like builds):
- kind "element" = a visual piece that runs nothing (neuron, server, brick, layer, planet…).
- Space: x = left→right, y = height (up), z = depth (toward the viewer). A card is 2.6 wide; leave ≥1.2 between shapes. Use all three axes: stack on y, put things behind on z, build grids and rings.
- "position": [x, y, z] on every node places it exactly (kept as given). Or omit positions and pick a "layout" for the tool call:
  "layers" (columns along x, each a vertical stack: neural networks, pipelines; set "layer": 0,1,2… on nodes),
  "grid" (matrix of rows × layoutOptions.columns on the xy plane; "layer" pushes a slice back in z),
  "radial" (ring around layoutOptions.center), "auto" (left-to-right flow), "manual" (keep positions).
- "style" on a node: { shape: card|box|sphere|cylinder|cone|capsule|torus|diamond|gem|disc|plane, size: [w,h,d] or a scale number, icon: emoji or ≤3 chars (e.g. "🧠", "DB"), image: workspace path or URL painted on it, opacity: 0.1–1, label: auto|above|below|inside|hidden, glow: true }. "color" sets its color.
- "style" on an edge: { color, dashed, width: 1–8, curve: auto|straight|smooth, arrow: false }.
- Examples: neural network = spheres with layer 0..n via layout "layers", edges from every node of a layer to every node of the next with { arrow: false, width: 1 }; a 3×3 matrix = boxes with layout "grid" and columns 3; a LEGO tower = boxes with size [2,0.6,1] and positions stepping up in y.`;

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

const hasPosition = (node: unknown) =>
  !!node &&
  typeof node === "object" &&
  Array.isArray((node as { position?: unknown }).position) &&
  (node as { position: unknown[] }).position.length === 3;

/**
 * A flow from model output: repaired and placed, always valid. Positions the
 * model gives are kept (it can build matrices, stacks, towers…); without
 * them, or with an explicit `layout`, the nodes are laid out automatically.
 */
export function flowFromAI(
  raw: unknown,
  fallbackName?: string,
  layout?: FlowLayout,
  options?: LayoutOptions
): FlowDocument {
  const doc = parseFlow(JSON.stringify(raw ?? {}));
  if (doc.nodes.length === 0) throw new Error("La IA no propuso ningún paso");
  const rawNodes = (raw as { nodes?: unknown[] } | null)?.nodes ?? [];
  const positioned = rawNodes.length > 0 && rawNodes.every(hasPosition);
  const mode = layout ?? (positioned ? "manual" : "auto");
  return applyLayout({ ...doc, name: doc.name || fallbackName }, mode, options);
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
