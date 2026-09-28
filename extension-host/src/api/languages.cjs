"use strict";

const path = require("node:path");
const { Disposable, EventEmitter, Uri } = require("./types.cjs");
const { globToRegExp, toPosix } = require("./glob.cjs");

/**
 * `vscode.languages`: language feature providers are kept in a registry
 * (queried by the language bridge when the editor asks for completions,
 * hovers, ...) and diagnostics are pushed to the app.
 */
function createLanguages(host) {
  const providers = [];
  const collections = new Set();
  const onDidChangeDiagnostics = new EventEmitter();
  let nextCollection = 1;

  // ── Document selectors ───────────────────────────────────────────────────
  function matchOne(selector, document) {
    if (typeof selector === "string") {
      if (selector === "*") return 5;
      return selector === document.languageId ? 10 : 0;
    }
    if (!selector || typeof selector !== "object") return 0;
    let score = 0;
    if (selector.language) {
      if (selector.language === document.languageId) score = 10;
      else if (selector.language === "*") score = 5;
      else return 0;
    }
    if (selector.scheme) {
      if (selector.scheme === document.uri.scheme) score = Math.max(score, 10);
      else if (selector.scheme === "*") score = Math.max(score, 5);
      else return 0;
    }
    if (selector.pattern) {
      const pattern =
        typeof selector.pattern === "string" ? selector.pattern : selector.pattern.pattern;
      const base =
        typeof selector.pattern === "object" ? selector.pattern.baseUri?.fsPath : undefined;
      const target = toPosix(base ? path.relative(base, document.uri.fsPath) : document.uri.fsPath);
      const regex = globToRegExp(toPosix(pattern));
      if (regex.test(target) || regex.test(path.basename(target))) score = Math.max(score, 10);
      else return 0;
    }
    if (selector.notebookType) return 0;
    return score || (selector.language || selector.scheme || selector.pattern ? 0 : 5);
  }

  function match(selector, document) {
    if (Array.isArray(selector)) return Math.max(0, ...selector.map((s) => matchOne(s, document)));
    return matchOne(selector, document);
  }

  function register(kind, extensionId) {
    return (selector, provider, ...extra) => {
      const entry = { kind, selector, provider, extra, extensionId };
      providers.push(entry);
      host.rpc.notify("languages.providersChanged", { kind });
      return new Disposable(() => {
        const index = providers.indexOf(entry);
        if (index >= 0) providers.splice(index, 1);
        host.rpc.notify("languages.providersChanged", { kind });
      });
    };
  }

  /** Providers of a kind that apply to a document, best match first. */
  function providersFor(kind, document) {
    return providers
      .filter((p) => p.kind === kind)
      .map((p) => ({ ...p, score: match(p.selector, document) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────
  function serializeDiagnostic(d) {
    return {
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
      message: typeof d.message === "string" ? d.message : (d.message?.value ?? ""),
      severity: d.severity ?? 0,
      source: d.source,
      code:
        typeof d.code === "object" && d.code !== null
          ? String(d.code.value)
          : d.code === undefined
            ? undefined
            : String(d.code),
      tags: d.tags,
    };
  }

  function createDiagnosticCollection(name) {
    const owner = name ?? `diagnostics-${nextCollection++}`;
    const entries = new Map();
    let disposed = false;
    const push = (uri) => {
      if (disposed || uri.scheme !== "file") return;
      const list = entries.get(uri.toString())?.[1] ?? [];
      host.rpc.notify("diagnostics.set", {
        owner,
        path: uri.fsPath,
        diagnostics: list.map(serializeDiagnostic),
      });
      onDidChangeDiagnostics.fire({ uris: [uri] });
    };
    const collection = {
      name: owner,
      set(uriOrEntries, diagnostics) {
        if (Array.isArray(uriOrEntries)) {
          const touched = new Map();
          for (const [uri, list] of uriOrEntries) {
            const key = uri.toString();
            if (!list) {
              entries.delete(key);
              touched.set(key, uri);
              continue;
            }
            const current = touched.has(key) ? (entries.get(key)?.[1] ?? []) : [];
            entries.set(key, [uri, [...current, ...list]]);
            touched.set(key, uri);
          }
          touched.forEach((uri) => push(uri));
          return;
        }
        const uri = uriOrEntries;
        if (!diagnostics) entries.delete(uri.toString());
        else entries.set(uri.toString(), [uri, [...diagnostics]]);
        push(uri);
      },
      delete(uri) {
        entries.delete(uri.toString());
        push(uri);
      },
      clear() {
        const uris = [...entries.values()].map(([uri]) => uri);
        entries.clear();
        uris.forEach((uri) => push(uri));
      },
      forEach(callback, thisArg) {
        for (const [uri, list] of entries.values()) callback.call(thisArg, uri, list, collection);
      },
      get(uri) {
        return entries.get(uri.toString())?.[1];
      },
      has(uri) {
        return entries.has(uri.toString());
      },
      dispose() {
        collection.clear();
        disposed = true;
        collections.delete(collection);
      },
      [Symbol.iterator]: function* iterate() {
        yield* entries.values();
      },
    };
    collections.add(collection);
    return collection;
  }

  function getDiagnostics(uri) {
    if (uri) {
      return [...collections].flatMap((c) => c.get(uri) ?? []);
    }
    const byUri = new Map();
    for (const c of collections) {
      c.forEach((u, list) => {
        const key = u.toString();
        byUri.set(key, [u, [...(byUri.get(key)?.[1] ?? []), ...list]]);
      });
    }
    return [...byUri.values()];
  }

  function knownLanguages() {
    const ids = new Set(["plaintext"]);
    for (const ext of host.extensionDescriptions()) {
      for (const language of ext.contributes?.languages ?? []) ids.add(language.id);
    }
    return [...ids];
  }

  const kinds = [
    "CompletionItemProvider",
    "HoverProvider",
    "DefinitionProvider",
    "DeclarationProvider",
    "TypeDefinitionProvider",
    "ImplementationProvider",
    "ReferenceProvider",
    "DocumentHighlightProvider",
    "DocumentSymbolProvider",
    "WorkspaceSymbolProvider",
    "CodeActionsProvider",
    "CodeLensProvider",
    "DocumentFormattingEditProvider",
    "DocumentRangeFormattingEditProvider",
    "OnTypeFormattingEditProvider",
    "RenameProvider",
    "SignatureHelpProvider",
    "DocumentLinkProvider",
    "ColorProvider",
    "FoldingRangeProvider",
    "SelectionRangeProvider",
    "CallHierarchyProvider",
    "TypeHierarchyProvider",
    "LinkedEditingRangeProvider",
    "DocumentSemanticTokensProvider",
    "DocumentRangeSemanticTokensProvider",
    "InlayHintsProvider",
    "InlineValuesProvider",
    "InlineCompletionItemProvider",
    "EvaluatableExpressionProvider",
    "DocumentDropEditProvider",
    "DocumentPasteEditProvider",
    "DocumentRangesFormattingEditProvider",
  ];

  function forExtension(extensionId) {
    const api = {
      match,
      getLanguages: async () => knownLanguages(),
      setTextDocumentLanguage: async (document, languageId) => {
        const data = host.workspace.documents.get(document.uri.toString());
        if (data) data.languageId = languageId;
        return document;
      },
      setLanguageConfiguration: () => new Disposable(() => {}),
      createDiagnosticCollection,
      getDiagnostics,
      onDidChangeDiagnostics: onDidChangeDiagnostics.event,
      createLanguageStatusItem: (id, selector) => ({
        id,
        selector,
        name: undefined,
        severity: 0,
        text: "",
        detail: undefined,
        busy: false,
        command: undefined,
        accessibilityInformation: undefined,
        dispose() {},
      }),
      registerDocumentSemanticTokensProvider: register(
        "DocumentSemanticTokensProvider",
        extensionId
      ),
    };
    for (const kind of kinds) api[`register${kind}`] = register(kind, extensionId);
    return api;
  }

  return { forExtension, providersFor, match, providers, Uri };
}

module.exports = { createLanguages };
