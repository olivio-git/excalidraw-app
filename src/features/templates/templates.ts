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

// ── Visual 3D diagrams ─────────────────────────────────────────────────────

/** A dense neural network: spheres in vertical layers, every neuron linked to the next layer. */
const neuralNetwork = (lang: TemplateLang, name: string) => {
  const sizes = [3, 5, 5, 2];
  const colors = ["#22c55e", "#6366f1", "#8b5cf6", "#f43f5e"];
  const layerNames =
    lang === "es"
      ? ["Entrada", "Oculta 1", "Oculta 2", "Salida"]
      : ["Input", "Hidden 1", "Hidden 2", "Output"];
  const nodes: FlowNode[] = [];
  const edges: FlowDocument["edges"] = [];
  sizes.forEach((count, layer) => {
    for (let i = 0; i < count; i++) {
      const first = layer === 0;
      const last = layer === sizes.length - 1;
      nodes.push({
        id: `l${layer}n${i}`,
        kind: "element",
        label: first ? `x${i + 1}` : last ? `y${i + 1}` : "",
        position: [0, 0, 0],
        layer,
        color: colors[layer],
        style: {
          shape: "sphere",
          size: 0.9,
          glow: last,
          label: first || last ? "above" : "hidden",
        },
      });
    }
    nodes.push({
      id: `title${layer}`,
      kind: "note",
      label: layerNames[layer],
      position: [0, 0, 0],
      layer,
      style: { shape: "plane", size: [2, 0.5, 0.04], label: "inside", opacity: 0.5 },
      color: colors[layer],
    });
  });
  sizes.slice(0, -1).forEach((count, layer) => {
    for (let i = 0; i < count; i++)
      for (let j = 0; j < sizes[layer + 1]; j++)
        edges.push({
          id: `w${layer}-${i}-${j}`,
          from: `l${layer}n${i}`,
          to: `l${layer + 1}n${j}`,
          style: { arrow: false, width: 1.2 },
        });
  });
  const laid = applyLayout({ type: "qori-flow3d", version: 1, name, nodes, edges }, "layers", {
    gap: 4.5,
    spacing: 1.5,
  });
  // Layer titles float over their column.
  const top = Math.max(...laid.nodes.map((n) => n.position[1]));
  laid.nodes = laid.nodes.map((node) => {
    if (!node.id.startsWith("title")) return node;
    const column = laid.nodes.find((n) => n.layer === node.layer && !n.id.startsWith("title"));
    return { ...node, position: [column?.position[0] ?? 0, top + 1.6, 0] };
  });
  return serializeFlow(laid);
};

/** Bricks stacked in a staggered tower: positions in three axes, sizes and colors. */
const brickTower = (lang: TemplateLang, name: string) => {
  const colors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];
  const nodes: FlowNode[] = [];
  for (let level = 0; level < 5; level++)
    for (let i = 0; i < 2; i++) {
      const alongX = level % 2 === 0;
      nodes.push({
        id: `b${level}-${i}`,
        kind: "element",
        label: i === 0 ? `${lang === "es" ? "Nivel" : "Level"} ${level + 1}` : "",
        position: alongX ? [0, level * 0.65, i * 1.1 - 0.55] : [i * 1.1 - 0.55, level * 0.65, 0],
        color: colors[level],
        style: {
          shape: "box",
          size: alongX ? [2.2, 0.6, 1] : [1, 0.6, 2.2],
          label: i === 0 ? "above" : "hidden",
          icon: level === 4 && i === 0 ? "⭐" : undefined,
        },
      });
    }
  return serializeFlow({ type: "qori-flow3d", version: 1, name, nodes, edges: [] });
};

/** A three-tier architecture: clients, services and data, with real shapes. */
const architecture = (lang: TemplateLang, name: string) => {
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const node = (
    id: string,
    label: string,
    position: FlowNode["position"],
    color: string,
    style: FlowNode["style"]
  ): FlowNode => ({ id, kind: "element", label, position, color, style });
  const nodes: FlowNode[] = [
    node("web", "Web", [-4.5, 4.4, 0], "#0ea5e9", {
      shape: "plane",
      size: [2, 1.3, 0.06],
      icon: "🖥️",
    }),
    node("mobile", t("Móvil", "Mobile"), [0, 4.4, 0], "#0ea5e9", {
      shape: "plane",
      size: [0.9, 1.5, 0.06],
      icon: "📱",
    }),
    node("partners", "API", [4.5, 4.4, 0], "#0ea5e9", {
      shape: "plane",
      size: [2, 1.3, 0.06],
      icon: "🔌",
    }),
    node("gateway", "Gateway", [0, 1.8, 0], "#f59e0b", { shape: "diamond", size: 1.1, glow: true }),
    node("auth", t("Autenticación", "Auth"), [-4.5, -0.8, 0], "#8b5cf6", {
      shape: "box",
      icon: "🔐",
    }),
    node("orders", t("Pedidos", "Orders"), [0, -0.8, 0], "#8b5cf6", { shape: "box", icon: "📦" }),
    node("search", t("Búsqueda", "Search"), [4.5, -0.8, 0], "#8b5cf6", {
      shape: "box",
      icon: "🔎",
    }),
    node("users", t("Usuarios", "Users"), [-4.5, -3.6, 0], "#10b981", {
      shape: "cylinder",
      icon: "DB",
    }),
    node("ordersdb", t("Pedidos", "Orders"), [0, -3.6, 0], "#10b981", {
      shape: "cylinder",
      icon: "DB",
    }),
    node("index", t("Índice", "Index"), [4.5, -3.6, 0], "#10b981", {
      shape: "cylinder",
      icon: "🗂️",
    }),
    node("queue", t("Cola", "Queue"), [0, -0.8, -4], "#ec4899", {
      shape: "capsule",
      size: [0.8, 1.6, 0.8],
    }),
  ];
  const edge = (from: string, to: string, style?: FlowDocument["edges"][number]["style"]) => ({
    id: `${from}-${to}`,
    from,
    to,
    style,
  });
  const edges = [
    edge("web", "gateway"),
    edge("mobile", "gateway"),
    edge("partners", "gateway"),
    edge("gateway", "auth"),
    edge("gateway", "orders"),
    edge("gateway", "search"),
    edge("auth", "users"),
    edge("orders", "ordersdb"),
    edge("search", "index"),
    edge("orders", "queue", { dashed: true, color: "#ec4899" }),
  ];
  return serializeFlow({ type: "qori-flow3d", version: 1, name, nodes, edges });
};

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
  {
    id: "visual-neural-network",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Red neuronal (3D)", en: "Neural network (3D)" },
    description: {
      es: "Capas de neuronas en columnas verticales, todas conectadas a la capa siguiente",
      en: "Layers of neurons in vertical columns, each linked to the next layer",
    },
    build: neuralNetwork,
  },
  {
    id: "visual-architecture",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Arquitectura en capas (3D)", en: "Layered architecture (3D)" },
    description: {
      es: "Clientes, gateway, servicios y bases de datos con formas e iconos",
      en: "Clients, gateway, services and databases with shapes and icons",
    },
    build: architecture,
  },
  {
    id: "visual-bricks",
    kind: "flow",
    extension: "flow3d",
    title: { es: "Torre de bloques (3D)", en: "Brick tower (3D)" },
    description: {
      es: "Bloques apilados a distintas alturas, como piezas de construcción",
      en: "Bricks stacked at different heights, like building pieces",
    },
    build: brickTower,
  },
];

export function buildTemplate(template: Template, language: TemplateLang, name: string): string {
  return template.build(language, name);
}
