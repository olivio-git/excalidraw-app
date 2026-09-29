import { applyLayout } from "@/features/flow3d/layout";
import {
  serializeFlow,
  type FlowDocument,
  type FlowNode,
  type StepConfig,
} from "@/features/flow3d/model";
import { flowToExcalidraw } from "@/features/flow3d/excalidraw-export";

/**
 * Starting points for new files: notes (Markdown), diagrams (Excalidraw) and
 * executable flows. Content follows the app language (Spanish or English).
 */

export type TemplateKind = "note" | "diagram" | "flow";
export type TemplateLang = "es" | "en";

export interface Template {
  id: string;
  kind: TemplateKind;
  extension: "md" | "excalidraw" | "flow3d";
  title: Record<TemplateLang, string>;
  description: Record<TemplateLang, string>;
  /** File content for a new file called `name`. */
  build: (lang: TemplateLang, name: string) => string;
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Notes ──────────────────────────────────────────────────────────────────

const meeting = (lang: TemplateLang, name: string) =>
  lang === "es"
    ? `# ${name}\n\n**Fecha:** ${today()}  \n**Asistentes:** \n\n## Objetivo\n\n\n## Temas\n\n1. \n2. \n\n## Decisiones\n\n- \n\n## Tareas\n\n- [ ] Tarea — responsable — fecha\n\n## Próxima reunión\n\n`
    : `# ${name}\n\n**Date:** ${today()}  \n**Attendees:** \n\n## Goal\n\n\n## Topics\n\n1. \n2. \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] Task — owner — due date\n\n## Next meeting\n\n`;

const journal = (lang: TemplateLang, name: string) =>
  lang === "es"
    ? `# ${name} — ${today()}\n\n## Prioridades de hoy\n\n- [ ] \n- [ ] \n- [ ] \n\n## Notas\n\n\n## Qué aprendí\n\n\n## Para mañana\n\n- \n`
    : `# ${name} — ${today()}\n\n## Today's priorities\n\n- [ ] \n- [ ] \n- [ ] \n\n## Notes\n\n\n## What I learned\n\n\n## For tomorrow\n\n- \n`;

const spec = (lang: TemplateLang, name: string) =>
  lang === "es"
    ? `# ${name}\n\n| Estado | Autor | Fecha |\n| --- | --- | --- |\n| Borrador |  | ${today()} |\n\n## Contexto\n\nQué problema resolvemos y por qué ahora.\n\n## Objetivos\n\n- \n\n## Fuera de alcance\n\n- \n\n## Propuesta\n\n### Arquitectura\n\n### Datos\n\n### API\n\n## Alternativas consideradas\n\n## Riesgos y preguntas abiertas\n\n- \n\n## Plan de entrega\n\n1. \n`
    : `# ${name}\n\n| Status | Author | Date |\n| --- | --- | --- |\n| Draft |  | ${today()} |\n\n## Context\n\nWhat problem we solve and why now.\n\n## Goals\n\n- \n\n## Non-goals\n\n- \n\n## Proposal\n\n### Architecture\n\n### Data\n\n### API\n\n## Alternatives considered\n\n## Risks and open questions\n\n- \n\n## Delivery plan\n\n1. \n`;

const retro = (lang: TemplateLang, name: string) =>
  lang === "es"
    ? `# ${name}\n\n**Periodo:** \n\n## Qué salió bien\n\n- \n\n## Qué podemos mejorar\n\n- \n\n## Ideas\n\n- \n\n## Acciones\n\n- [ ] \n`
    : `# ${name}\n\n**Period:** \n\n## What went well\n\n- \n\n## What to improve\n\n- \n\n## Ideas\n\n- \n\n## Actions\n\n- [ ] \n`;

// ── Flows and diagrams ─────────────────────────────────────────────────────

type Step = [id: string, kind: FlowNode["kind"], es: string, en: string, config?: StepConfig];
/** from, to, and an optional label (one text, or [Spanish, English]). */
type Link = [from: string, to: string, label?: string | [string, string]];

function buildFlow(lang: TemplateLang, name: string, steps: Step[], edges: Link[]): FlowDocument {
  return applyLayout({
    type: "qori-flow3d",
    version: 1,
    name,
    nodes: steps.map(([id, kind, es, en, config]) => ({
      id,
      kind,
      label: lang === "es" ? es : en,
      position: [0, 0, 0],
      config,
    })),
    edges: edges.map(([from, to, label], i) => ({
      id: `e${i + 1}`,
      from,
      to,
      label: Array.isArray(label) ? label[lang === "es" ? 0 : 1] : label,
    })),
  });
}

const flowTemplate = (steps: Step[], edges: Link[]) => (lang: TemplateLang, name: string) =>
  serializeFlow(buildFlow(lang, name, steps, edges));

const diagramTemplate = (steps: Step[], edges: Link[]) => (lang: TemplateLang, name: string) =>
  `${JSON.stringify(flowToExcalidraw(buildFlow(lang, name, steps, edges)), null, 2)}\n`;

export const TEMPLATES: Template[] = [
  {
    id: "note-meeting",
    kind: "note",
    extension: "md",
    title: { es: "Acta de reunión", en: "Meeting notes" },
    description: {
      es: "Asistentes, temas, decisiones y tareas",
      en: "Attendees, topics, decisions and tasks",
    },
    build: meeting,
  },
  {
    id: "note-journal",
    kind: "note",
    extension: "md",
    title: { es: "Diario", en: "Daily journal" },
    description: {
      es: "Prioridades del día, notas y aprendizajes",
      en: "Daily priorities, notes and learnings",
    },
    build: journal,
  },
  {
    id: "note-spec",
    kind: "note",
    extension: "md",
    title: { es: "Especificación técnica", en: "Technical spec" },
    description: {
      es: "Contexto, propuesta, alternativas y riesgos",
      en: "Context, proposal, alternatives and risks",
    },
    build: spec,
  },
  {
    id: "note-retro",
    kind: "note",
    extension: "md",
    title: { es: "Retrospectiva", en: "Retrospective" },
    description: {
      es: "Qué salió bien, qué mejorar y acciones",
      en: "What went well, what to improve, actions",
    },
    build: retro,
  },
  {
    id: "diagram-architecture",
    kind: "diagram",
    extension: "excalidraw",
    title: { es: "Arquitectura web", en: "Web architecture" },
    description: {
      es: "Cliente, API, caché y base de datos",
      en: "Client, API, cache and database",
    },
    build: diagramTemplate(
      [
        ["client", "trigger", "Cliente web", "Web client"],
        ["api", "action", "API", "API"],
        ["cache", "transform", "Caché", "Cache"],
        ["db", "output", "Base de datos", "Database"],
        ["queue", "action", "Cola de trabajos", "Job queue"],
      ],
      [
        ["client", "api"],
        ["api", "cache"],
        ["api", "db"],
        ["api", "queue"],
      ]
    ),
  },
  {
    id: "diagram-decision",
    kind: "diagram",
    extension: "excalidraw",
    title: { es: "Proceso con decisión", en: "Decision process" },
    description: { es: "Inicio, revisión y dos caminos", en: "Start, review and two paths" },
    build: diagramTemplate(
      [
        ["start", "trigger", "Solicitud", "Request"],
        ["review", "action", "Revisar", "Review"],
        ["ok", "condition", "¿Aprobada?", "Approved?"],
        ["publish", "output", "Publicar", "Publish"],
        ["fix", "action", "Pedir cambios", "Request changes"],
      ],
      [
        ["start", "review"],
        ["review", "ok"],
        ["ok", "publish", ["sí", "yes"]],
        ["ok", "fix", "no"],
      ]
    ),
  },
  {
    id: "diagram-pipeline",
    kind: "diagram",
    extension: "excalidraw",
    title: { es: "Pipeline CI/CD", en: "CI/CD pipeline" },
    description: {
      es: "Commit, pruebas, build y despliegue",
      en: "Commit, tests, build and deploy",
    },
    build: diagramTemplate(
      [
        ["commit", "trigger", "Commit", "Commit"],
        ["test", "action", "Pruebas", "Tests"],
        ["build", "transform", "Build", "Build"],
        ["staging", "action", "Staging", "Staging"],
        ["prod", "output", "Producción", "Production"],
      ],
      [
        ["commit", "test"],
        ["test", "build"],
        ["build", "staging"],
        ["staging", "prod"],
      ]
    ),
  },
  {
    id: "flow-commits",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Informe diario de commits", en: "Daily commit report" },
    description: {
      es: "Cada mañana lee git y guarda un resumen en una nota",
      en: "Every morning reads git and saves a summary to a note",
    },
    build: flowTemplate(
      [
        ["morning", "trigger", "Cada mañana", "Every morning", { type: "schedule", at: "09:00" }],
        [
          "log",
          "action",
          "Últimos commits",
          "Latest commits",
          { type: "command", command: "git log --since=yesterday --oneline", timeout: 30 },
        ],
        [
          "report",
          "output",
          "Guardar informe",
          "Save report",
          {
            type: "writeNote",
            path: "informes/commits.md",
            content: "## {{steps.morning.output.at}}\n\n{{input.stdout}}",
            append: true,
          },
        ],
      ],
      [
        ["morning", "log"],
        ["log", "report"],
      ]
    ),
  },
  {
    id: "flow-monitor",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Monitor de una web", en: "Website monitor" },
    description: {
      es: "Cada 15 minutos comprueba una URL y anota si falla",
      en: "Every 15 minutes checks a URL and logs failures",
    },
    build: flowTemplate(
      [
        ["tick", "trigger", "Cada 15 minutos", "Every 15 minutes", { type: "schedule", every: 15 }],
        [
          "check",
          "action",
          "Consultar la web",
          "Check the site",
          {
            type: "http",
            method: "GET",
            url: "https://example.com",
            allowErrors: true,
            retries: 2,
            retryDelay: 5,
          },
        ],
        [
          "up",
          "condition",
          "¿Responde bien?",
          "Is it up?",
          { type: "condition", field: "status", operator: "<", value: "400" },
        ],
        ["ok", "action", "Todo en orden", "All good"],
        [
          "alert",
          "output",
          "Anotar la caída",
          "Log the outage",
          {
            type: "writeNote",
            path: "monitor.md",
            content: "- {{steps.tick.output.at}}: HTTP {{input.status}}",
            append: true,
          },
        ],
      ],
      [
        ["tick", "check"],
        ["check", "up"],
        ["up", "ok", ["sí", "yes"]],
        ["up", "alert", "no"],
      ]
    ),
  },
  {
    id: "flow-summarize",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Resumir notas nuevas con IA", en: "Summarize new notes with AI" },
    description: {
      es: "Cuando cambia la carpeta notas/, la IA resume y lo guarda",
      en: "When notes/ changes, AI summarizes it and saves it",
    },
    build: flowTemplate(
      [
        [
          "watch",
          "trigger",
          "Cambió notas/",
          "notes/ changed",
          { type: "fileWatch", path: "notas" },
        ],
        [
          "read",
          "action",
          "Leer el archivo",
          "Read the file",
          { type: "command", command: 'cat "{{input.path}}"' },
        ],
        [
          "summary",
          "ai",
          "Resumir",
          "Summarize",
          { type: "ai", prompt: "Resume en 3 viñetas:\n{{input.stdout}}" },
        ],
        [
          "save",
          "output",
          "Guardar resumen",
          "Save summary",
          {
            type: "writeNote",
            path: "resumenes.md",
            content: "### {{steps.watch.output.path}}\n{{input}}",
            append: true,
          },
        ],
      ],
      [
        ["watch", "read"],
        ["read", "summary"],
        ["summary", "save"],
      ]
    ),
  },
  {
    id: "flow-list",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Procesar una lista", en: "Process a list" },
    description: {
      es: "Envía cada elemento a una API, con reintentos",
      en: "Sends each item to an API, with retries",
    },
    build: flowTemplate(
      [
        [
          "start",
          "trigger",
          "Datos",
          "Data",
          { type: "manual", payload: '{\n  "items": ["uno", "dos", "tres"]\n}' },
        ],
        [
          "send",
          "action",
          "Enviar cada elemento",
          "Send each item",
          {
            type: "http",
            method: "POST",
            url: "https://httpbin.org/post",
            body: '{"item": "{{item}}", "n": "{{index}}"}',
            forEach: "items",
            retries: 2,
            retryDelay: 2,
          },
        ],
        [
          "log",
          "output",
          "Registrar",
          "Log",
          { type: "writeNote", path: "envios.md", content: "{{input}}", append: true },
        ],
      ],
      [
        ["start", "send"],
        ["send", "log"],
      ]
    ),
  },
];

export function buildTemplate(template: Template, language: TemplateLang, name: string): string {
  return template.build(language, name);
}
