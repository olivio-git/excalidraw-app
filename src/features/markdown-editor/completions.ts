import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { noteContext } from "./note-context";
import {
  DIAGRAM_EXTENSION,
  IMAGE_EXTENSION,
  baseName,
  encodeLinkPath,
  fileName,
  posixDirname,
  relativePath,
} from "./paths";
import { listWorkspaceFiles } from "./workspace-files";

/**
 * Inkdrop/Notion-style helpers, all producing plain Markdown:
 * - `/` at the start of a word → block snippets (headings, lists, table…)
 * - `[[` → link to a workspace note, or embed a diagram/image
 */

interface SlashCommand {
  label: string;
  detail: string;
  keywords: string;
  template: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Título 1", detail: "# ", keywords: "h1 heading titulo", template: "# ${}" },
  { label: "Título 2", detail: "## ", keywords: "h2 heading titulo", template: "## ${}" },
  { label: "Título 3", detail: "### ", keywords: "h3 heading titulo", template: "### ${}" },
  { label: "Lista", detail: "- ", keywords: "bullet list lista", template: "- ${}" },
  { label: "Lista numerada", detail: "1. ", keywords: "numbered ordered", template: "1. ${}" },
  { label: "Tarea", detail: "- [ ] ", keywords: "todo task checkbox tarea", template: "- [ ] ${}" },
  { label: "Cita", detail: "> ", keywords: "quote blockquote cita", template: "> ${}" },
  {
    label: "Bloque de código",
    detail: "```",
    keywords: "code codigo fence",
    template: "```${lenguaje}\n${}\n```",
  },
  {
    label: "Tabla",
    detail: "| |",
    keywords: "table tabla",
    template: "| ${Columna} | Columna |\n| --- | --- |\n| ${} |  |",
  },
  { label: "Separador", detail: "---", keywords: "divider hr separator", template: "---\n${}" },
  {
    label: "Fórmula (bloque)",
    detail: "$$",
    keywords: "math latex katex formula ecuacion",
    template: "$$\n${}\n$$",
  },
  { label: "Fórmula (en línea)", detail: "$…$", keywords: "math inline latex", template: "$${}$" },
  {
    label: "Aviso",
    detail: "> [!NOTE]",
    keywords: "callout alert note tip warning aviso nota",
    template: "> [!NOTE]\n> ${}",
  },
  {
    label: "Enlace o diagrama…",
    detail: "[[",
    keywords: "link enlace nota diagrama embed excalidraw imagen",
    template: "[[${}",
  },
];

export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)\/[\p{L}\d-]*$/u);
  if (!match) return null;
  const slash = match.from + match.text.indexOf("/");
  return {
    from: slash,
    // CodeMirror filters on `label`, so it carries the keywords ("/h2", "/todo",
    // "/tabla" all match); `displayLabel` is what the list shows.
    options: SLASH_COMMANDS.map(
      (command): Completion => ({
        label: `/${command.label} ${command.keywords}`,
        displayLabel: command.label,
        detail: command.detail,
        type: "keyword",
        apply: (view, completion, from, to) => {
          snippet(command.template)(view, completion, from, to);
          if (command.template.startsWith("[[")) startLinkCompletion(view);
        },
      })
    ),
    validFor: /^\/[\p{L}\d-]*$/u,
  };
}

function startLinkCompletion(view: EditorView): void {
  // Re-open the completion list for the `[[` just inserted.
  queueMicrotask(() => startCompletion(view));
}

/** Markdown for a link or embed from the note at `notePath` to `target`. */
export function linkMarkdown(notePath: string, target: string): string {
  const href = encodeLinkPath(relativePath(posixDirname(notePath), target));
  const name = baseName(target);
  if (DIAGRAM_EXTENSION.test(target) || IMAGE_EXTENSION.test(target)) return `![${name}](${href})`;
  return `[${name}](${href})`;
}

export async function linkCompletions(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const match = context.matchBefore(/\[\[[^\]\n]*$/);
  if (!match) return null;
  const host = context.state.facet(noteContext);
  const notePath = host.getFilePath();
  const files = await listWorkspaceFiles(host.getWorkspaceDir());
  if (context.aborted) return null;
  const root = host.getWorkspaceDir() ?? "";
  return {
    from: match.from,
    // Also consume a `]]` that bracket-closing may have inserted.
    to:
      context.state.sliceDoc(context.pos, context.pos + 2) === "]]" ? context.pos + 2 : context.pos,
    options: files
      .filter((file) => file !== notePath)
      .map((file) => {
        const kind = DIAGRAM_EXTENSION.test(file)
          ? "diagrama"
          : IMAGE_EXTENSION.test(file)
            ? "imagen"
            : "nota";
        const completion: Completion = {
          label: `[[${fileName(file)} ${relativePath(root, file)}`,
          displayLabel: baseName(file),
          detail: `${kind} · ${relativePath(root, posixDirname(file)) || "."}`,
          type: kind === "nota" ? "text" : "constant",
          apply: linkMarkdown(notePath, file),
        };
        return completion;
      }),
    validFor: /^\[\[[^\]\n]*$/,
  };
}
