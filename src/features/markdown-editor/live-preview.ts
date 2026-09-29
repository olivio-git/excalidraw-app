import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { toggleTaskAt } from "./formatting";
import { noteContext } from "./note-context";

/**
 * "Live preview" in the style of Obsidian/Inkdrop: Markdown stays plain text,
 * but its syntax (`#`, `**`, `[]()`, `>`…) is hidden and the result styled,
 * except on the lines the cursor is on, where the raw text is shown for editing.
 */

/** Whether any selection range touches the lines spanned by [from, to]. */
export function isActiveRange(state: EditorState, from: number, to: number): boolean {
  const start = state.doc.lineAt(from).from;
  const end = state.doc.lineAt(to).to;
  return state.selection.ranges.some((range) => range.from <= end && range.to >= start);
}

const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  readonly markerFrom: number;
  constructor(checked: boolean, markerFrom: number) {
    super();
    this.checked = checked;
    this.markerFrom = markerFrom;
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.markerFrom === this.markerFrom;
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-md-task";
    input.setAttribute("aria-label", this.checked ? "Tarea completada" : "Tarea pendiente");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      toggleTaskAt(this.markerFrom)(view);
    });
    return input;
  }
  ignoreEvent() {
    return true;
  }
}

/** GitHub alert types (`> [!NOTE]`…) and their labels. */
export const CALLOUTS: Record<string, string> = {
  note: "Nota",
  tip: "Consejo",
  important: "Importante",
  warning: "Advertencia",
  caution: "Precaución",
};

const CALLOUT_LINE = /^\s*>\s*\[!(note|tip|important|warning|caution)\]/i;

class LabelWidget extends WidgetType {
  readonly text: string;
  readonly className: string;
  constructor(text: string, className: string) {
    super();
    this.text = text;
    this.className = className;
  }
  eq(other: LabelWidget) {
    return other.text === this.text && other.className === this.className;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    return span;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-md-hr";
    return hr;
  }
}

export class InlineMathWidget extends WidgetType {
  readonly tex: string;
  constructor(tex: string) {
    super();
    this.tex = tex;
  }
  eq(other: InlineMathWidget) {
    return other.tex === this.tex;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-math";
    katex.render(this.tex, span, { throwOnError: false, displayMode: false });
    return span;
  }
}

/** Inline `$…$` math (not `$$`, not escaped), outside code. */
const INLINE_MATH = /(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g;

interface PreviewDecorations {
  all: DecorationSet;
  /** Only the replaced (hidden or widget) ranges: the cursor skips over them. */
  atomic: DecorationSet;
}

function buildDecorations(view: EditorView): PreviewDecorations {
  const { state } = view;
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const codeRanges: Array<[number, number]> = [];
  /** `[!NOTE]` markers of callouts, which must not be styled as links. */
  const calloutMarkers: Array<[number, number]> = [];

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const parent = node.node.parent;
        switch (node.name) {
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            const level = node.name.slice(-1);
            decorations.push(
              Decoration.line({ class: `cm-md-heading cm-md-h${level}` }).range(
                state.doc.lineAt(node.from).from
              )
            );
            break;
          }
          case "HeaderMark": {
            if (
              parent &&
              parent.name.startsWith("ATXHeading") &&
              !isActiveRange(state, node.from, node.to)
            ) {
              // Hide "# " including the following space.
              const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
              decorations.push(hide.range(node.from, end));
            }
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark": {
            if (parent && !isActiveRange(state, parent.from, parent.to)) {
              decorations.push(hide.range(node.from, node.to));
            }
            break;
          }
          case "StrongEmphasis":
            decorations.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
            break;
          case "Emphasis":
            decorations.push(Decoration.mark({ class: "cm-md-em" }).range(node.from, node.to));
            break;
          case "Strikethrough":
            decorations.push(Decoration.mark({ class: "cm-md-strike" }).range(node.from, node.to));
            break;
          case "InlineCode": {
            codeRanges.push([node.from, node.to]);
            decorations.push(
              Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to)
            );
            if (!isActiveRange(state, node.from, node.to)) {
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "CodeMark") decorations.push(hide.range(child.from, child.to));
              }
            }
            break;
          }
          case "FencedCode":
          case "CodeBlock": {
            codeRanges.push([node.from, node.to]);
            const first = state.doc.lineAt(node.from);
            const last = state.doc.lineAt(node.to);
            const fenced = node.name === "FencedCode";
            const editing = isActiveRange(state, node.from, node.to);
            for (let line = first; ; line = state.doc.line(line.number + 1)) {
              const classes = ["cm-md-codeblock"];
              if (line.number === first.number) classes.push("cm-md-codeblock-first");
              if (line.number === last.number) classes.push("cm-md-codeblock-last");
              if (fenced && (line.number === first.number || line.number === last.number))
                classes.push("cm-md-codeblock-fence");
              decorations.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
              if (line.number >= last.number || line.number >= state.doc.lines) break;
            }
            // Outside the block, the fences become a language label and an empty line.
            if (fenced && !editing && last.number > first.number) {
              const info = node.node.getChild("CodeInfo");
              const language = info ? state.sliceDoc(info.from, info.to) : "";
              decorations.push(
                Decoration.replace({
                  widget: new LabelWidget(language || "código", "cm-md-code-lang"),
                }).range(first.from, first.to)
              );
              if (/^\s*(```|~~~)\s*$/.test(last.text) && last.from < last.to) {
                decorations.push(hide.range(last.from, last.to));
              }
            }
            return false;
          }
          case "Link": {
            if (calloutMarkers.some(([a, b]) => node.from >= a && node.to <= b)) return false;
            decorations.push(
              Decoration.mark({
                class: "cm-md-link",
                attributes: { title: "Ctrl+clic para abrir" },
              }).range(node.from, node.to)
            );
            if (!isActiveRange(state, node.from, node.to)) {
              // Show only the link text: hide "[", and everything from "]" on.
              const marks = [];
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "LinkMark") marks.push(child);
              }
              if (marks.length >= 2) {
                decorations.push(hide.range(marks[0].from, marks[0].to));
                decorations.push(hide.range(marks[1].from, node.to));
              }
            }
            return false;
          }
          case "Blockquote": {
            const first = state.doc.lineAt(node.from);
            const callout = CALLOUT_LINE.exec(first.text);
            const type = callout?.[1].toLowerCase();
            const lineClass = type ? `cm-md-callout cm-md-callout-${type}` : "cm-md-quote";
            for (let line = first; ; line = state.doc.line(line.number + 1)) {
              decorations.push(Decoration.line({ class: lineClass }).range(line.from));
              if (line.to >= node.to || line.number >= state.doc.lines) break;
            }
            if (type) {
              const markerFrom = first.from + first.text.indexOf("[");
              const markerTo = markerFrom + type.length + 3;
              calloutMarkers.push([markerFrom, markerTo]);
              if (!isActiveRange(state, first.from, first.to)) {
                decorations.push(
                  Decoration.replace({
                    widget: new LabelWidget(CALLOUTS[type], "cm-md-callout-label"),
                  }).range(markerFrom, markerTo)
                );
              }
            }
            break;
          }
          case "QuoteMark": {
            if (!isActiveRange(state, node.from, node.to)) {
              const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
              decorations.push(hide.range(node.from, end));
            }
            break;
          }
          case "ListMark": {
            const mark = state.sliceDoc(node.from, node.to);
            if (/^[-*+]$/.test(mark) && !isActiveRange(state, node.from, node.to)) {
              const item = parent?.getChild("Task");
              // Task items show only the checkbox.
              if (item) decorations.push(hide.range(node.from, Math.min(node.to + 1, item.from)));
              else
                decorations.push(
                  Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to)
                );
            }
            break;
          }
          case "TaskMarker": {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            const cursorInside = state.selection.ranges.some(
              (range) => range.from <= node.to && range.to >= node.from
            );
            if (!cursorInside) {
              decorations.push(
                Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(
                  node.from,
                  node.to
                )
              );
            }
            if (checked && parent) {
              decorations.push(
                Decoration.mark({ class: "cm-md-task-done" }).range(node.to, parent.to)
              );
            }
            break;
          }
          case "HorizontalRule": {
            if (!isActiveRange(state, node.from, node.to)) {
              decorations.push(
                Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to)
              );
            }
            break;
          }
        }
      },
    });

    // Inline math, skipping code spans/blocks and the lines being edited.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (!isActiveRange(state, line.from, line.to)) {
        for (const match of line.text.matchAll(INLINE_MATH)) {
          const start = line.from + match.index!;
          const end = start + match[0].length;
          if (codeRanges.some(([a, b]) => start < b && end > a)) continue;
          decorations.push(
            Decoration.replace({ widget: new InlineMathWidget(match[1]) }).range(start, end)
          );
        }
      }
      pos = line.to + 1;
    }
  }

  const all = Decoration.set(decorations, true);
  const atomic = Decoration.set(
    decorations.filter((range) => range.value.point),
    true
  );
  return { all, atomic };
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ all: this.decorations, atomic: this.atomic } = buildDecorations(view));
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        ({ all: this.decorations, atomic: this.atomic } = buildDecorations(update.view));
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  }
);

/** Ctrl/Cmd+click opens links (notes, diagrams, URLs, `#heading`). */
export const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    let node = syntaxTree(view.state).resolveInner(pos, 1);
    while (node && node.name !== "Link" && node.name !== "Image" && node.parent) node = node.parent;
    const url =
      node && (node.name === "Link" || node.name === "Image") ? node.getChild("URL") : null;
    const href = url ? view.state.sliceDoc(url.from, url.to) : null;
    if (!href) return false;
    event.preventDefault();
    view.state.facet(noteContext).open(href, { beside: event.shiftKey });
    return true;
  },
});
