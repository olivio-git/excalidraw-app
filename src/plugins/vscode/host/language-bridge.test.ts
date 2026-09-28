import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";

// plugin-api pulls in Excalidraw, which does not load under jsdom.
vi.mock("@/plugins/plugin-api", () => ({ createPluginAPI: vi.fn() }));

import { toContentChanges, toOffset, toTextPosition } from "@/features/code-editor/setup";
import {
  editorContributions,
  type CodeDocument,
} from "@/features/code-editor/editor-contributions";
import {
  LanguageBridge,
  applyEditsToView,
  completionType,
  toCodeMirrorDiagnostics,
} from "./language-bridge";
import { useExtensionHostStore } from "./host-store";
import type { ExtensionHostService } from "./extension-host-service";

function fakeHost(responses: Record<string, unknown> = {}) {
  const notifications: Array<{ method: string; params: any }> = [];
  const requests: Array<{ method: string; params: any }> = [];
  const host = {
    notify: (method: string, params: unknown) => notifications.push({ method, params }),
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      return responses[method];
    },
  } as unknown as ExtensionHostService;
  return { host, notifications, requests };
}

function document(text: string, filePath = "/w/a.demo"): CodeDocument {
  let current = text;
  return {
    filePath,
    languageId: "demo",
    version: 1,
    getText: () => current,
    set text(value: string) {
      current = value;
    },
  } as CodeDocument;
}

afterEach(() => useExtensionHostStore.setState({ status: "idle" }));

describe("position conversion", () => {
  const doc = Text.of(["hello", "wörld 🌍", ""]);

  it("maps offsets to 0-based line/UTF-16 character and back", () => {
    expect(toTextPosition(doc, 0)).toEqual({ line: 0, character: 0 });
    expect(toTextPosition(doc, 8)).toEqual({ line: 1, character: 2 });
    expect(toOffset(doc, { line: 1, character: 2 })).toBe(8);
    // Clamped to the document.
    expect(toOffset(doc, { line: 9, character: 99 })).toBe(doc.length);
  });

  it("lists changes back to front so they apply sequentially", () => {
    const state = EditorState.create({ doc: "abc\ndef" });
    const tr = state.update({
      changes: [
        { from: 0, to: 1, insert: "X" },
        { from: 5, to: 6, insert: "YY" },
      ],
    });
    const changes = toContentChanges(state.doc, tr.changes);
    expect(changes).toEqual([
      { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, text: "YY" },
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "X" },
    ]);
    // Replaying them sequentially on the old text gives the new text.
    let text = state.doc;
    for (const change of changes) {
      text = text.replace(
        toOffset(text, change.range.start),
        toOffset(text, change.range.end),
        Text.of([change.text])
      );
    }
    expect(text.toString()).toBe(tr.newDoc.toString());
  });
});

describe("conversions", () => {
  it("maps diagnostics severities and ranges", () => {
    const doc = Text.of(["let x = 1", "TODO"]);
    const result = toCodeMirrorDiagnostics(doc, [
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
        message: "Pendiente",
        severity: 1,
        source: "lint",
        code: "T1",
      },
      {
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
        message: "x",
        severity: 0,
      },
    ]);
    expect(result[0]).toEqual({
      from: 10,
      to: 14,
      severity: "warning",
      message: "Pendiente",
      source: "lint T1",
    });
    expect(result[1].severity).toBe("error");
  });

  it("maps completion kinds to CodeMirror types", () => {
    expect(completionType(2)).toBe("function");
    expect(completionType(5)).toBe("variable");
    expect(completionType(13)).toBe("keyword");
    expect(completionType(undefined)).toBeUndefined();
  });

  it("applies edits relative to the current document in one transaction", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "one two" }) });
    applyEditsToView(view, [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "1" },
      { range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } }, newText: "!" },
    ]);
    expect(view.state.doc.toString()).toBe("1 two!");
    view.destroy();
  });
});

describe("LanguageBridge", () => {
  it("syncs documents and asks for capabilities", async () => {
    useExtensionHostStore.setState({ status: "running" });
    const { host, notifications, requests } = fakeHost({
      "languages.capabilities": {
        completion: true,
        completionTriggers: ["-"],
        hover: true,
        definition: false,
        signatureHelp: false,
        signatureTriggers: [],
        formatting: false,
      },
    });
    const bridge = new LanguageBridge(host);
    const doc = document("hello");
    bridge.opened(doc);
    bridge.changed(doc, [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, text: "!" },
    ]);
    bridge.closed(doc);

    expect(notifications.map((n) => n.method)).toEqual([
      "document.opened",
      "document.changed",
      "document.closed",
    ]);
    expect(notifications[0].params).toEqual({
      path: "/w/a.demo",
      languageId: "demo",
      version: 1,
      text: "hello",
    });
    expect(notifications[1].params.changes[0].text).toBe("!");
    await vi.waitFor(() =>
      expect(requests.some((r) => r.method === "languages.capabilities")).toBe(true)
    );
  });

  it("offers LSP completions only where providers exist, honoring trigger characters", async () => {
    useExtensionHostStore.setState({ status: "running" });
    const { host, requests } = fakeHost({
      "languages.capabilities": {
        completion: true,
        completionTriggers: ["-"],
        hover: false,
        definition: false,
        signatureHelp: false,
        signatureTriggers: [],
        formatting: false,
      },
      "languages.completion": {
        id: 3,
        isIncomplete: false,
        items: [
          {
            id: "0:0",
            label: "Get-Thing",
            kind: 2,
            insertText: "Get-Thing -Name ${1:x}",
            isSnippet: true,
            detail: "cmdlet",
          },
          {
            id: "0:1",
            label: "Get-Other",
            kind: 5,
            insertText: "Get-Other",
            isSnippet: false,
            labelDescription: "módulo",
          },
        ],
      },
    });
    const bridge = new LanguageBridge(host);
    const doc = document("Get-");
    const source = bridge.completionSource(doc);
    const state = EditorState.create({ doc: "Get-" });

    // No capabilities yet: nothing is requested.
    expect(await source(new CompletionContext(state, 4, false))).toBeNull();
    await bridge.refreshCapabilities(doc);

    const result = await source(new CompletionContext(state, 4, false));
    expect(requests.find((r) => r.method === "languages.completion")?.params).toEqual({
      path: "/w/a.demo",
      position: { line: 0, character: 4 },
      triggerCharacter: "-",
    });
    expect(result?.options.map((o) => [o.label, o.type, o.detail])).toEqual([
      ["Get-Thing", "function", "cmdlet"],
      ["Get-Other", "variable", "módulo"],
    ]);
  });

  it("replays open documents to a host that starts later", () => {
    const { host, notifications } = fakeHost();
    const bridge = new LanguageBridge(host);
    const doc = document("abc", "/w/late.demo");
    const off = editorContributions.register({ id: "test-noop" });
    editorContributions.didOpen(doc);
    bridge.replayOpenDocuments();
    editorContributions.didClose(doc);
    off();
    expect(notifications.find((n) => n.method === "document.opened")?.params.path).toBe(
      "/w/late.demo"
    );
  });
});
