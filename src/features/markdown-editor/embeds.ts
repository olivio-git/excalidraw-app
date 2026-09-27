import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import { isActiveRange } from "./live-preview";
import { noteContext } from "./note-context";
import { DIAGRAM_EXTENSION, IMAGE_EXTENSION, baseName } from "./paths";

/**
 * Block-level previews, shown when the cursor is elsewhere:
 * - a line with only `![alt](diagram.excalidraw)` → rendered diagram
 * - a line with only `![alt](image.png)` → the image
 * - `$$ … $$` → display math (KaTeX)
 * Block decorations must come from state (not a view plugin) in CodeMirror 6.
 */

/** A line consisting only of an image/embed: `![alt](dest "title")`. */
export const EMBED_LINE = /^!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)\s*$/;

/** Destination of an embed line match (`<a b.png>` or `a%20b.png`). */
export function embedHref(match: RegExpExecArray): string {
  return match[2] ?? match[3];
}

function imageMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return `image/${ext}`;
}

/**
 * Dispatch when previews may be stale (tab re-activated, light/dark switch).
 * Widgets re-check their file's modification time and only re-render the
 * preview if it changed, so this is cheap to call often.
 */
export const refreshEmbeds = StateEffect.define<null>();

/** Bumped by `refreshEmbeds`, so widgets re-validate their cached preview. */
const embedVersion = StateField.define<number>({
  create: () => 0,
  update: (value, transaction) =>
    transaction.effects.some((effect) => effect.is(refreshEmbeds)) ? value + 1 : value,
});

/** Latest preview per file/kind/mode, re-rendered only when the file's mtime changes. */
const previews = new Map<string, { mtime: number | null; url: Promise<string> }>();

async function previewUrl(
  view: EditorView,
  href: string,
  kind: "diagram" | "image",
  dark: boolean
): Promise<string> {
  const context = view.state.facet(noteContext);
  const path = await context.resolve(href);
  const mtime = await context.modifiedAt(path).catch(() => null);
  const key = `${path}|${kind}|${dark}`;
  const cached = previews.get(key);
  if (cached && cached.mtime !== null && cached.mtime === mtime) return cached.url;

  const url = (async () => {
    const blob =
      kind === "diagram"
        ? await context.renderDiagram(path, dark)
        : new Blob([(await context.readFile(path)) as BlobPart], { type: imageMime(path) });
    return URL.createObjectURL(blob);
  })();
  previews.set(key, { mtime, url });
  url.catch(() => previews.delete(key));
  cached?.url.then(
    (old) => URL.revokeObjectURL(old),
    () => {}
  );
  return url;
}

/** Drop all cached previews. */
export function clearPreviewCache(): void {
  for (const { url } of previews.values())
    url.then(
      (value) => URL.revokeObjectURL(value),
      () => {}
    );
  previews.clear();
}

class EmbedWidget extends WidgetType {
  readonly href: string;
  readonly alt: string;
  readonly kind: "diagram" | "image";
  readonly dark: boolean;
  readonly lineFrom: number;
  readonly version: number;
  constructor(
    href: string,
    alt: string,
    kind: "diagram" | "image",
    dark: boolean,
    lineFrom: number,
    version: number
  ) {
    super();
    this.href = href;
    this.alt = alt;
    this.kind = kind;
    this.dark = dark;
    this.lineFrom = lineFrom;
    this.version = version;
  }

  eq(other: EmbedWidget) {
    return (
      other.href === this.href &&
      other.alt === this.alt &&
      other.dark === this.dark &&
      other.lineFrom === this.lineFrom &&
      other.version === this.version
    );
  }

  toDOM(view: EditorView) {
    const figure = document.createElement("figure");
    figure.className = `cm-md-embed cm-md-embed-${this.kind}`;

    const frame = document.createElement("div");
    frame.className = "cm-md-embed-frame";
    frame.textContent = "Cargando…";
    figure.append(frame);

    const caption = document.createElement("figcaption");
    const label = document.createElement("span");
    label.textContent = this.alt || baseName(this.href);
    caption.append(label);

    const actions = document.createElement("span");
    actions.className = "cm-md-embed-actions";
    if (this.kind === "diagram") {
      actions.append(
        this.button("Abrir diagrama", () => view.state.facet(noteContext).open(this.href))
      );
    }
    actions.append(
      this.button("Editar Markdown", () => {
        view.dispatch({ selection: { anchor: this.lineFrom }, scrollIntoView: true });
        view.focus();
      })
    );
    caption.append(actions);
    figure.append(caption);

    previewUrl(view, this.href, this.kind, this.dark).then(
      (url) => {
        const img = document.createElement("img");
        img.src = url;
        img.alt = this.alt;
        img.draggable = false;
        frame.replaceChildren(img);
        view.requestMeasure();
      },
      (error) => {
        frame.classList.add("cm-md-embed-error");
        frame.textContent = `No se pudo mostrar ${this.href}: ${String(error)}`;
      }
    );
    return figure;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

class DisplayMathWidget extends WidgetType {
  readonly tex: string;
  readonly from: number;
  constructor(tex: string, from: number) {
    super();
    this.tex = tex;
    this.from = from;
  }
  eq(other: DisplayMathWidget) {
    return other.tex === this.tex && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const div = document.createElement("div");
    div.className = "cm-md-math-block";
    katex.render(this.tex, div, { throwOnError: false, displayMode: true });
    div.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });
    return div;
  }
  ignoreEvent() {
    return false;
  }
}

/** `$$` blocks: `$$ x $$` on one line, or `$$` … `$$` fences on their own lines. */
export function findMathBlocks(
  state: EditorState
): Array<{ from: number; to: number; tex: string }> {
  const blocks: Array<{ from: number; to: number; tex: string }> = [];
  const { doc } = state;
  let open: { from: number; body: string[] } | null = null;
  let inCode = false;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text.trim();
    if (/^(```|~~~)/.test(text)) inCode = !inCode;
    if (inCode) continue;
    if (open) {
      if (text === "$$") {
        blocks.push({ from: open.from, to: line.to, tex: open.body.join("\n") });
        open = null;
      } else {
        open.body.push(line.text);
      }
      continue;
    }
    const single = /^\$\$(.+)\$\$$/.exec(text);
    if (single) blocks.push({ from: line.from, to: line.to, tex: single[1] });
    else if (text === "$$") open = { from: line.from, body: [] };
  }
  return blocks;
}

function buildEmbeds(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const dark = state.facet(noteContext)?.isDark() ?? false;
  const version = state.field(embedVersion, false) ?? 0;
  const { doc } = state;
  let inCode = false;

  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (/^\s*(```|~~~)/.test(line.text)) inCode = !inCode;
    if (inCode) continue;
    const match = EMBED_LINE.exec(line.text);
    if (!match || isActiveRange(state, line.from, line.to)) continue;
    const href = embedHref(match);
    const path = decodeURIComponent(href.split("#")[0]);
    const kind = DIAGRAM_EXTENSION.test(path)
      ? "diagram"
      : IMAGE_EXTENSION.test(path)
        ? "image"
        : null;
    // Remote images are left as text: the CSP only allows local/blob images.
    if (!kind || /^[a-z][a-z\d+.-]*:\/\//i.test(href)) continue;
    decorations.push(
      Decoration.replace({
        widget: new EmbedWidget(href, match[1], kind, dark, line.from, version),
        block: true,
      }).range(line.from, line.to)
    );
  }

  for (const block of findMathBlocks(state)) {
    if (isActiveRange(state, block.from, block.to)) continue;
    decorations.push(
      Decoration.replace({
        widget: new DisplayMathWidget(block.tex, block.from),
        block: true,
      }).range(block.from, block.to)
    );
  }

  return Decoration.set(decorations, true);
}

export const embeds = StateField.define<DecorationSet>({
  create: buildEmbeds,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      transaction.effects.some((effect) => effect.is(refreshEmbeds))
    ) {
      return buildEmbeds(transaction.state);
    }
    return value;
  },
  provide: (field) => [
    embedVersion,
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
