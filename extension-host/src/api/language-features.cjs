"use strict";

const {
  Position,
  Range,
  Uri,
  Location,
  MarkdownString,
  SnippetString,
  CancellationTokenSource,
  CompletionList,
  CompletionTriggerKind,
  SignatureHelpTriggerKind,
} = require("./types.cjs");
const { serializeRange } = require("./editors.cjs");

/**
 * Answers the editor's language feature requests (completion, hover,
 * definition, signature help, formatting) by calling the providers that
 * extensions registered through `vscode.languages.register*`.
 */

const REQUEST_TIMEOUT_MS = 5000;

function markdownValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (value instanceof MarkdownString || typeof value.value === "string") {
    // `{ language, value }` (MarkedString) renders as a code block.
    if (typeof value.language === "string")
      return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
    return value.value;
  }
  return String(value);
}

function createLanguageFeatures(host) {
  const { languages, workspace } = host;
  /** Last completion items, so the editor can ask to resolve their documentation. */
  let lastCompletion = { id: 0, items: [] };

  function documentFor(fsPath) {
    const data = workspace.documents.get(Uri.file(fsPath).toString());
    if (!data || data.isClosed) throw new Error(`Document not open: ${fsPath}`);
    return data.document;
  }

  async function withToken(run) {
    const source = new CancellationTokenSource();
    const timer = setTimeout(() => source.cancel(), REQUEST_TIMEOUT_MS);
    try {
      return await run(source.token);
    } finally {
      clearTimeout(timer);
      source.dispose();
    }
  }

  async function settle(promises) {
    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === "rejected")
        host.log("warn", `Language provider failed: ${result.reason?.message ?? result.reason}`);
    }
    return results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  }

  // ── Completion ───────────────────────────────────────────────────────────
  function serializeCompletion(item, index, providerIndex) {
    let insertText =
      item.insertText ?? (typeof item.label === "string" ? item.label : item.label?.label);
    let isSnippet = false;
    if (
      insertText instanceof SnippetString ||
      (insertText && typeof insertText.value === "string")
    ) {
      insertText = insertText.value;
      isSnippet = true;
    }
    let range;
    let insertRange;
    if (item.range instanceof Range) range = serializeRange(item.range);
    else if (item.range && item.range.replacing) {
      range = serializeRange(item.range.replacing);
      insertRange = serializeRange(item.range.inserting);
    }
    const label = typeof item.label === "string" ? item.label : (item.label?.label ?? "");
    return {
      id: `${providerIndex}:${index}`,
      label,
      labelDetail: typeof item.label === "object" ? item.label.detail : undefined,
      labelDescription: typeof item.label === "object" ? item.label.description : undefined,
      kind: item.kind,
      detail: item.detail,
      documentation: item.documentation ? markdownValue(item.documentation) : undefined,
      insertText: String(insertText ?? label),
      isSnippet,
      range,
      insertRange,
      filterText: item.filterText,
      sortText: item.sortText,
      preselect: !!item.preselect,
      deprecated: item.tags?.includes?.(1),
      additionalTextEdits: (item.additionalTextEdits ?? []).map((e) => ({
        range: serializeRange(e.range),
        newText: e.newText,
      })),
      command: item.command
        ? { command: item.command.command, hasArgs: !!item.command.arguments }
        : undefined,
    };
  }

  async function provideCompletion({ path, position, triggerCharacter }) {
    const document = documentFor(path);
    const pos = new Position(position.line, position.character);
    const providers = languages.providersFor("CompletionItemProvider", document).filter((p) => {
      if (!triggerCharacter) return true;
      return p.extra.includes(triggerCharacter);
    });
    if (providers.length === 0) return { items: [], isIncomplete: false };
    const context = {
      triggerKind: triggerCharacter
        ? CompletionTriggerKind.TriggerCharacter
        : CompletionTriggerKind.Invoke,
      triggerCharacter,
    };
    const lists = await withToken((token) =>
      settle(
        providers.map(async (p, providerIndex) => {
          const result = await p.provider.provideCompletionItems(document, pos, token, context);
          if (!result) return null;
          const list = Array.isArray(result) ? new CompletionList(result, false) : result;
          return { list, provider: p.provider, providerIndex };
        })
      )
    );
    const id = lastCompletion.id + 1;
    const items = [];
    const cached = [];
    let isIncomplete = false;
    for (const { list, provider, providerIndex } of lists) {
      isIncomplete ||= !!list.isIncomplete;
      list.items.forEach((item, index) => {
        items.push(serializeCompletion(item, index, providerIndex));
        cached.push({ key: `${providerIndex}:${index}`, item, provider });
      });
    }
    lastCompletion = { id, items: cached };
    return { id, items, isIncomplete };
  }

  async function resolveCompletion({ id, itemId }) {
    if (id !== lastCompletion.id) return null;
    const entry = lastCompletion.items.find((e) => e.key === itemId);
    if (!entry || typeof entry.provider.resolveCompletionItem !== "function") return null;
    const resolved = await withToken((token) =>
      entry.provider.resolveCompletionItem(entry.item, token)
    );
    const item = resolved ?? entry.item;
    return {
      detail: item.detail,
      documentation: item.documentation ? markdownValue(item.documentation) : undefined,
    };
  }

  async function executeCompletionCommand({ id, itemId }) {
    if (id !== lastCompletion.id) return;
    const command = lastCompletion.items.find((e) => e.key === itemId)?.item.command;
    if (command) await host.commands.executeCommand(command.command, ...(command.arguments ?? []));
  }

  // ── Hover ────────────────────────────────────────────────────────────────
  async function provideHover({ path, position }) {
    const document = documentFor(path);
    const pos = new Position(position.line, position.character);
    const providers = languages.providersFor("HoverProvider", document);
    const hovers = await withToken((token) =>
      settle(providers.map((p) => p.provider.provideHover(document, pos, token)))
    );
    const contents = hovers
      .flatMap((hover) => hover.contents.map(markdownValue))
      .filter((c) => c.trim());
    if (contents.length === 0) return null;
    const range = hovers.find((h) => h.range)?.range;
    return { contents, range: range ? serializeRange(range) : undefined };
  }

  // ── Definition ───────────────────────────────────────────────────────────
  function serializeLocation(location) {
    if (!location) return null;
    if (location.targetUri) {
      const range = location.targetSelectionRange ?? location.targetRange;
      return { path: location.targetUri.fsPath, range: serializeRange(range) };
    }
    if (location instanceof Location || (location.uri && location.range)) {
      return { path: location.uri.fsPath, range: serializeRange(location.range) };
    }
    return null;
  }

  async function provideLocations(kind, method, { path, position }) {
    const document = documentFor(path);
    const pos = new Position(position.line, position.character);
    const providers = languages.providersFor(kind, document);
    const results = await withToken((token) =>
      settle(providers.map((p) => p.provider[method](document, pos, token)))
    );
    return results
      .flatMap((r) => (Array.isArray(r) ? r : [r]))
      .map(serializeLocation)
      .filter((l) => l && l.path);
  }

  // ── Signature help ───────────────────────────────────────────────────────
  async function provideSignatureHelp({ path, position, triggerCharacter }) {
    const document = documentFor(path);
    const pos = new Position(position.line, position.character);
    const providers = languages.providersFor("SignatureHelpProvider", document);
    const context = {
      triggerKind: triggerCharacter
        ? SignatureHelpTriggerKind.TriggerCharacter
        : SignatureHelpTriggerKind.Invoke,
      triggerCharacter,
      isRetrigger: false,
      activeSignatureHelp: undefined,
    };
    for (const p of providers) {
      const help = await withToken((token) =>
        p.provider.provideSignatureHelp(document, pos, token, context)
      ).catch(() => null);
      if (!help || !help.signatures?.length) continue;
      return {
        activeSignature: help.activeSignature ?? 0,
        activeParameter: help.activeParameter ?? 0,
        signatures: help.signatures.map((s) => ({
          label: s.label,
          documentation: s.documentation ? markdownValue(s.documentation) : undefined,
          activeParameter: s.activeParameter,
          parameters: (s.parameters ?? []).map((param) => ({
            label: param.label,
            documentation: param.documentation ? markdownValue(param.documentation) : undefined,
          })),
        })),
      };
    }
    return null;
  }

  // ── Formatting ───────────────────────────────────────────────────────────
  async function provideFormatting({ path, options, range }) {
    const document = documentFor(path);
    const formatting = {
      tabSize: options?.tabSize ?? 4,
      insertSpaces: options?.insertSpaces ?? true,
    };
    if (range) {
      const r = new Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character
      );
      const providers = languages.providersFor("DocumentRangeFormattingEditProvider", document);
      if (providers.length) {
        const edits = await withToken((token) =>
          providers[0].provider.provideDocumentRangeFormattingEdits(document, r, formatting, token)
        );
        return (edits ?? []).map((e) => ({ range: serializeRange(e.range), newText: e.newText }));
      }
    }
    const providers = languages.providersFor("DocumentFormattingEditProvider", document);
    if (providers.length === 0) return null;
    const edits = await withToken((token) =>
      providers[0].provider.provideDocumentFormattingEdits(document, formatting, token)
    );
    return (edits ?? []).map((e) => ({ range: serializeRange(e.range), newText: e.newText }));
  }

  /** What the editor needs to know to trigger requests for a language. */
  function capabilities({ path }) {
    const document = documentFor(path);
    const completion = languages.providersFor("CompletionItemProvider", document);
    const signature = languages.providersFor("SignatureHelpProvider", document);
    const signatureTriggers = signature.flatMap((p) => {
      const meta = p.extra[0];
      if (typeof meta === "string") return p.extra.filter((c) => typeof c === "string");
      return meta?.triggerCharacters ?? [];
    });
    return {
      completion: completion.length > 0,
      completionTriggers: [
        ...new Set(completion.flatMap((p) => p.extra.filter((c) => typeof c === "string"))),
      ],
      hover: languages.providersFor("HoverProvider", document).length > 0,
      definition: languages.providersFor("DefinitionProvider", document).length > 0,
      signatureHelp: signature.length > 0,
      signatureTriggers: [...new Set(signatureTriggers)],
      formatting:
        languages.providersFor("DocumentFormattingEditProvider", document).length > 0 ||
        languages.providersFor("DocumentRangeFormattingEditProvider", document).length > 0,
    };
  }

  host.rpc.on("languages.capabilities", capabilities);
  host.rpc.on("languages.completion", provideCompletion);
  host.rpc.on("languages.resolveCompletion", resolveCompletion);
  host.rpc.on("languages.completionCommand", executeCompletionCommand);
  host.rpc.on("languages.hover", provideHover);
  host.rpc.on("languages.definition", (params) =>
    provideLocations("DefinitionProvider", "provideDefinition", params)
  );
  host.rpc.on("languages.references", async (params) => {
    const document = documentFor(params.path);
    const pos = new Position(params.position.line, params.position.character);
    const providers = languages.providersFor("ReferenceProvider", document);
    const results = await withToken((token) =>
      settle(
        providers.map((p) =>
          p.provider.provideReferences(document, pos, { includeDeclaration: true }, token)
        )
      )
    );
    return results.flat().map(serializeLocation).filter(Boolean);
  });
  host.rpc.on("languages.signatureHelp", provideSignatureHelp);
  host.rpc.on("languages.format", provideFormatting);

  return { provideCompletion, provideHover, capabilities };
}

module.exports = { createLanguageFeatures, markdownValue };
