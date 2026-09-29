import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { PluginManager } from "@/plugins/plugin-manager";
import { notify } from "@/shared/lib/notify";
import {
  editorContributions,
  type CodeDocument,
  type CodeEditorContribution,
  type ContentChange,
  type EditorSelection,
  type TextPosition,
} from "@/features/code-editor/editor-contributions";
import { codeEditorRegistry } from "@/features/code-editor/code-editor-registry";
import { toOffset, toTextPosition } from "@/features/code-editor/setup";
import { toCodeMirrorTemplate } from "@/features/code-editor/snippets";
import { revealInEditor } from "@/features/code-editor/reveal";
import type { HostConnection } from "./host-connection";
import type { ExtensionHostService } from "./extension-host-service";
import { useExtensionHostStore } from "./host-store";
import { useDiagnosticsStore, diagnosticsForPath, type HostDiagnostic } from "./view-stores";

/**
 * Bridges the code editor and the extension host: keeps open documents in
 * sync (`workspace.onDidOpenTextDocument` & co.) and turns the providers
 * extensions register into CodeMirror features — completion, hover,
 * diagnostics, go to definition, signature help and formatting.
 */

export interface LanguageCapabilities {
  completion: boolean;
  completionTriggers: string[];
  hover: boolean;
  definition: boolean;
  signatureHelp: boolean;
  signatureTriggers: string[];
  formatting: boolean;
}

interface Range {
  start: TextPosition;
  end: TextPosition;
}

interface HostCompletionItem {
  id: string;
  label: string;
  labelDetail?: string;
  labelDescription?: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText: string;
  isSnippet: boolean;
  range?: Range;
  preselect?: boolean;
  additionalTextEdits?: Array<{ range: Range; newText: string }>;
  command?: { command: string };
}

interface TextEditPayload {
  range: Range;
  newText: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPLETION_TYPES: Record<number, string> = {
  0: "text",
  1: "method",
  2: "function",
  3: "function",
  4: "property",
  5: "variable",
  6: "class",
  7: "interface",
  8: "namespace",
  9: "property",
  11: "constant",
  12: "enum",
  13: "keyword",
  14: "text",
  19: "enum",
  20: "constant",
  21: "class",
  24: "type",
};

export function completionType(kind: number | undefined): string | undefined {
  return kind === undefined ? undefined : (COMPLETION_TYPES[kind] ?? "text");
}

const SEVERITIES: Diagnostic["severity"][] = ["error", "warning", "info", "hint"];

export function toCodeMirrorDiagnostics(doc: Text, diagnostics: HostDiagnostic[]): Diagnostic[] {
  return diagnostics.map((d) => {
    const from = toOffset(doc, d.range.start);
    const to = Math.max(from, toOffset(doc, d.range.end));
    return {
      from,
      to,
      severity: SEVERITIES[d.severity] ?? "info",
      message: d.message,
      source: [d.source, d.code].filter(Boolean).join(" ") || undefined,
    };
  });
}

/** Apply LSP-style edits (ranges relative to the current document) in one transaction. */
export function applyEditsToView(view: EditorView, edits: TextEditPayload[]): void {
  const doc = view.state.doc;
  const changes = edits.map((edit) => ({
    from: toOffset(doc, edit.range.start),
    to: toOffset(doc, edit.range.end),
    insert: edit.newText,
  }));
  view.dispatch({ changes, userEvent: "input" });
}

function markdownElement(
  markdown: string | string[],
  padded = true
): { dom: HTMLElement; destroy: () => void } {
  const dom = document.createElement("div");
  dom.className = `qori-lsp-markdown max-w-[520px] max-h-80 overflow-auto text-xs leading-5${padded ? " px-3 py-2" : ""}`;
  const root = createRoot(dom);
  const text = Array.isArray(markdown) ? markdown.join("\n\n---\n\n") : markdown;
  root.render(<ReactMarkdown>{text}</ReactMarkdown>);
  return { dom, destroy: () => queueMicrotask(() => root.unmount()) };
}

// ── Bridge ────────────────────────────────────────────────────────────────────

export class LanguageBridge {
  private readonly capabilities = new Map<string, LanguageCapabilities>();
  private readonly host: ExtensionHostService;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: ExtensionHostService) {
    this.host = host;
  }

  private get running(): boolean {
    return useExtensionHostStore.getState().status === "running";
  }

  capabilitiesFor(filePath: string): LanguageCapabilities | undefined {
    return this.capabilities.get(filePath);
  }

  async refreshCapabilities(doc: CodeDocument): Promise<void> {
    if (!this.running) return;
    try {
      const caps = await this.host.request<LanguageCapabilities>("languages.capabilities", {
        path: doc.filePath,
      });
      if (caps) this.capabilities.set(doc.filePath, caps);
    } catch {
      this.capabilities.delete(doc.filePath);
    }
  }

  /** Providers changed in the host (an extension activated): re-query open documents. */
  scheduleCapabilityRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      for (const doc of editorContributions.getOpenDocuments()) void this.refreshCapabilities(doc);
    }, 150);
  }

  /** Send every open document to a host that just started. */
  replayOpenDocuments(): void {
    for (const doc of editorContributions.getOpenDocuments()) this.opened(doc);
    const active = editorContributions.getActiveDocument();
    if (active) this.host.notify("editor.active", { path: active.filePath });
  }

  opened(doc: CodeDocument): void {
    this.host.notify("document.opened", {
      path: doc.filePath,
      languageId: doc.languageId,
      version: doc.version,
      text: doc.getText(),
    });
    void this.refreshCapabilities(doc);
  }

  changed(doc: CodeDocument, changes: ContentChange[]): void {
    this.host.notify(
      "document.changed",
      changes.length > 0
        ? { path: doc.filePath, version: doc.version, changes }
        : { path: doc.filePath, version: doc.version, text: doc.getText() }
    );
  }

  selection(doc: CodeDocument, selections: EditorSelection[]): void {
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(
      () => this.host.notify("editor.selection", { path: doc.filePath, selections }),
      80
    );
  }

  closed(doc: CodeDocument): void {
    this.capabilities.delete(doc.filePath);
    this.host.notify("document.closed", { path: doc.filePath });
  }

  // ── CodeMirror features ──────────────────────────────────────────────────

  completionSource(doc: CodeDocument): CompletionSource {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const caps = this.capabilities.get(doc.filePath);
      if (!caps?.completion || !this.running) return null;
      const before = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
      const triggerCharacter = caps.completionTriggers.includes(before) ? before : undefined;
      const word = context.matchBefore(/[\w$@]+$/);
      if (!context.explicit && !triggerCharacter && !word) return null;

      const result = await this.host
        .request<{ id: number; items: HostCompletionItem[]; isIncomplete: boolean }>(
          "languages.completion",
          {
            path: doc.filePath,
            position: toTextPosition(context.state.doc, context.pos),
            triggerCharacter: context.explicit ? undefined : triggerCharacter,
          }
        )
        .catch(() => null);
      if (!result || context.aborted || result.items.length === 0) return null;

      const from = word?.from ?? context.pos;
      const options: Completion[] = result.items.map((item) => ({
        label: item.label,
        detail: item.labelDescription ?? item.labelDetail ?? item.detail,
        type: completionType(item.kind),
        boost: item.preselect ? 50 : undefined,
        info: () => this.completionInfo(result.id, item),
        apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
          const itemFrom = item.range ? toOffset(view.state.doc, item.range.start) : applyFrom;
          if (item.isSnippet) {
            snippet(toCodeMirrorTemplate(item.insertText))(view, _completion, itemFrom, applyTo);
          } else {
            view.dispatch({
              changes: { from: itemFrom, to: applyTo, insert: item.insertText },
              selection: { anchor: itemFrom + item.insertText.length },
              userEvent: "input.complete",
            });
          }
          if (item.additionalTextEdits?.length) applyEditsToView(view, item.additionalTextEdits);
          if (item.command) {
            void this.host.request("languages.completionCommand", {
              id: result.id,
              itemId: item.id,
            });
          }
        },
      }));
      return { from, options, validFor: result.isIncomplete ? undefined : /^[\w$@-]*$/ };
    };
  }

  private async completionInfo(
    requestId: number,
    item: HostCompletionItem
  ): Promise<{ dom: Node; destroy: () => void } | null> {
    let documentation = item.documentation;
    let detail = item.detail;
    if (!documentation) {
      const resolved = await this.host
        .request<{ detail?: string; documentation?: string } | null>(
          "languages.resolveCompletion",
          {
            id: requestId,
            itemId: item.id,
          }
        )
        .catch(() => null);
      documentation = resolved?.documentation;
      detail = resolved?.detail ?? detail;
    }
    if (!documentation && !detail) return null;
    const parts = [detail ? `\`${detail}\`` : "", documentation ?? ""].filter(Boolean);
    return markdownElement(parts.join("\n\n"), false);
  }

  hoverExtension(doc: CodeDocument): Extension {
    return hoverTooltip(async (view, pos) => {
      if (!this.capabilities.get(doc.filePath)?.hover || !this.running) return null;
      const result = await this.host
        .request<{ contents: string[]; range?: Range } | null>("languages.hover", {
          path: doc.filePath,
          position: toTextPosition(view.state.doc, pos),
        })
        .catch(() => null);
      if (!result || result.contents.length === 0) return null;
      const from = result.range ? toOffset(view.state.doc, result.range.start) : pos;
      const to = result.range ? toOffset(view.state.doc, result.range.end) : pos;
      return {
        pos: from,
        end: to,
        above: true,
        create: () => markdownElement(result.contents),
      };
    });
  }

  diagnosticsExtension(doc: CodeDocument): Extension {
    const path = doc.filePath;
    const plugin = ViewPlugin.fromClass(
      class {
        private readonly unsubscribe: () => void;
        constructor(view: EditorView) {
          const push = () =>
            queueMicrotask(() =>
              view.dispatch(
                setDiagnostics(
                  view.state,
                  toCodeMirrorDiagnostics(view.state.doc, diagnosticsForPath(path))
                )
              )
            );
          let last = useDiagnosticsStore.getState().byPath[path];
          this.unsubscribe = useDiagnosticsStore.subscribe((state) => {
            if (state.byPath[path] === last) return;
            last = state.byPath[path];
            push();
          });
          if (last) push();
        }
        destroy() {
          this.unsubscribe();
        }
      }
    );
    return [lintGutter(), plugin];
  }

  async goToDefinition(view: EditorView, doc: CodeDocument, pos: number): Promise<boolean> {
    if (!this.running) return false;
    const locations = await this.host
      .request<Array<{ path: string; range: Range }>>("languages.definition", {
        path: doc.filePath,
        position: toTextPosition(view.state.doc, pos),
      })
      .catch(() => []);
    const target = locations?.[0];
    if (!target) {
      notify("No se encontró la definición", { type: "info" });
      return false;
    }
    if (target.path === doc.filePath) {
      const anchor = toOffset(view.state.doc, target.range.start);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      return true;
    }
    return revealInEditor(target.path, target.range.start, target.range.end);
  }

  async format(view: EditorView, doc: CodeDocument): Promise<boolean> {
    if (!this.capabilities.get(doc.filePath)?.formatting || !this.running) {
      notify("No hay un formateador para este lenguaje", { type: "info" });
      return false;
    }
    const edits = await this.host
      .request<TextEditPayload[] | null>("languages.format", {
        path: doc.filePath,
        options: { tabSize: view.state.tabSize, insertSpaces: true },
      })
      .catch(() => null);
    if (!edits || edits.length === 0) return false;
    applyEditsToView(view, edits);
    return true;
  }

  navigationExtension(doc: CodeDocument): Extension {
    return [
      keymap.of([
        {
          key: "F12",
          run: (view) => {
            void this.goToDefinition(view, doc, view.state.selection.main.head);
            return true;
          },
        },
        {
          key: "Shift-Alt-f",
          run: (view) => {
            void this.format(view, doc);
            return true;
          },
        },
      ]),
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null || !this.capabilities.get(doc.filePath)?.definition) return false;
          event.preventDefault();
          void this.goToDefinition(view, doc, pos);
          return true;
        },
      }),
    ];
  }

  signatureHelpExtension(doc: CodeDocument): Extension {
    const setSignature = StateEffect.define<Tooltip | null>();
    const field = StateField.define<Tooltip | null>({
      create: () => null,
      update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setSignature)) return effect.value;
        if (!value) return value;
        if (tr.docChanged) {
          const pos = tr.changes.mapPos(value.pos);
          if (tr.newDoc.lineAt(pos).number !== tr.newDoc.lineAt(tr.newSelection.main.head).number)
            return null;
          return { ...value, pos };
        }
        if (
          tr.selection &&
          tr.newDoc.lineAt(tr.newSelection.main.head).number !== tr.newDoc.lineAt(value.pos).number
        ) {
          return null;
        }
        return value;
      },
      provide: (f) => showTooltip.from(f),
    });

    const request = (view: EditorView, triggerCharacter?: string) => {
      const pos = view.state.selection.main.head;
      void this.host
        .request<{
          activeSignature: number;
          activeParameter: number;
          signatures: Array<{
            label: string;
            documentation?: string;
            activeParameter?: number;
            parameters: Array<{ label: string | [number, number] }>;
          }>;
        } | null>("languages.signatureHelp", {
          path: doc.filePath,
          position: toTextPosition(view.state.doc, pos),
          triggerCharacter,
        })
        .then((help) => {
          const signature = help?.signatures[help.activeSignature] ?? help?.signatures[0];
          if (!signature) {
            view.dispatch({ effects: setSignature.of(null) });
            return;
          }
          const activeIndex = signature.activeParameter ?? help!.activeParameter;
          const param = signature.parameters[activeIndex]?.label;
          const [start, end] = Array.isArray(param)
            ? param
            : typeof param === "string" && param
              ? [signature.label.indexOf(param), signature.label.indexOf(param) + param.length]
              : [-1, -1];
          view.dispatch({
            effects: setSignature.of({
              pos,
              above: true,
              strictSide: true,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "qori-signature px-2 py-1 text-xs font-mono";
                const label = document.createElement("div");
                if (start >= 0 && end > start) {
                  label.append(signature.label.slice(0, start));
                  const strong = document.createElement("strong");
                  strong.textContent = signature.label.slice(start, end);
                  strong.className = "text-primary";
                  label.append(strong, signature.label.slice(end));
                } else {
                  label.textContent = signature.label;
                }
                dom.append(label);
                if (signature.documentation) {
                  const docs = document.createElement("div");
                  docs.className = "mt-1 font-sans text-muted-foreground";
                  docs.textContent = signature.documentation;
                  dom.append(docs);
                }
                return { dom };
              },
            }),
          });
        })
        .catch(() => undefined);
    };

    return [
      field,
      EditorView.updateListener.of((update: ViewUpdate) => {
        const caps = this.capabilities.get(doc.filePath);
        if (!caps?.signatureHelp || !this.running || !update.docChanged) return;
        const typed = update.transactions.some((tr) => tr.isUserEvent("input.type"));
        if (!typed) return;
        const pos = update.state.selection.main.head;
        const char = update.state.sliceDoc(pos - 1, pos);
        if (char === ")") update.view.dispatch({ effects: setSignature.of(null) });
        else if (caps.signatureTriggers.includes(char)) request(update.view, char);
        else if (update.state.field(field)) request(update.view);
      }),
      keymap.of([
        {
          key: "Escape",
          run: (view) => {
            if (!view.state.field(field)) return false;
            view.dispatch({ effects: setSignature.of(null) });
            return true;
          },
        },
        {
          key: "Mod-Shift-Space",
          run: (view) => {
            request(view);
            return true;
          },
        },
      ]),
    ];
  }

  contribution(): CodeEditorContribution {
    return {
      id: "exthost-language-bridge",
      onDidOpen: (doc) => this.opened(doc),
      onDidChange: (doc, changes) => this.changed(doc, changes),
      onDidChangeSelection: (doc, selections) => this.selection(doc, selections),
      onDidSave: (doc) => this.host.notify("document.saved", { path: doc.filePath }),
      onDidClose: (doc) => this.closed(doc),
      onDidFocus: (doc) => this.host.notify("editor.active", { path: doc?.filePath ?? null }),
      extensions: (doc) => [
        this.hoverExtension(doc),
        this.diagnosticsExtension(doc),
        this.navigationExtension(doc),
        this.signatureHelpExtension(doc),
      ],
      completionSources: (doc) => [this.completionSource(doc)],
    };
  }
}

function activeView(): { view: EditorView; doc: CodeDocument } | null {
  const doc = editorContributions.getActiveDocument();
  const view = doc ? codeEditorRegistry.get(doc.filePath)?.getView() : null;
  return doc && view ? { view, doc } : null;
}

/** App-side handlers for editor requests coming from extensions. */
export function registerLanguageHandlers(
  connection: HostConnection,
  bridge: LanguageBridge
): Array<() => void> {
  const viewFor = (path: string) => codeEditorRegistry.get(path)?.getView() ?? null;
  return [
    connection.on("languages.providersChanged", () => bridge.scheduleCapabilityRefresh()),
    connection.on("document.applyEdits", ({ path, edits }) => {
      const view = viewFor(path);
      if (!view) return false;
      applyEditsToView(view, edits);
      return true;
    }),
    connection.on("editor.insertSnippet", ({ path, snippet: template, ranges }) => {
      const view = viewFor(path);
      if (!view) return false;
      const range = ranges?.[0];
      const from = range ? toOffset(view.state.doc, range.start) : view.state.selection.main.from;
      const to = range ? toOffset(view.state.doc, range.end) : view.state.selection.main.to;
      snippet(toCodeMirrorTemplate(template))(view, { label: "" }, from, to);
      return true;
    }),
    connection.on("editor.setSelection", ({ path, selections }) => {
      const view = viewFor(path);
      const first = selections?.[0];
      if (!view || !first) return;
      view.dispatch({
        selection: {
          anchor: toOffset(view.state.doc, first.anchor),
          head: toOffset(view.state.doc, first.active),
        },
        scrollIntoView: true,
      });
    }),
    connection.on("editor.reveal", ({ path, range }) => {
      const view = viewFor(path);
      if (!view) return;
      view.dispatch({
        effects: EditorView.scrollIntoView(toOffset(view.state.doc, range.start), { y: "center" }),
      });
    }),
  ];
}

let bridge: LanguageBridge | null = null;

/** Register the bridge with the code editor and the workbench. Call once. */
export function initLanguageBridge(host: ExtensionHostService): LanguageBridge {
  if (bridge) return bridge;
  const instance = new LanguageBridge(host);
  bridge = instance;
  editorContributions.register(instance.contribution());
  // A host that starts (or restarts) after files were opened gets them now.
  useExtensionHostStore.subscribe((state, prev) => {
    if (state.status === "running" && prev.status !== "running") instance.replayOpenDocuments();
  });
  PluginManager.registerDynamicCommand(
    { id: "editor.action.formatDocument", name: "Formatear documento", category: "Editor" },
    async () => {
      const active = activeView();
      if (active) await instance.format(active.view, active.doc);
    }
  );
  PluginManager.registerDynamicCommand(
    { id: "editor.action.revealDefinition", name: "Ir a la definición", category: "Editor" },
    async () => {
      const active = activeView();
      if (active)
        await instance.goToDefinition(
          active.view,
          active.doc,
          active.view.state.selection.main.head
        );
    }
  );
  return instance;
}

export function getLanguageBridge(): LanguageBridge | null {
  return bridge;
}
