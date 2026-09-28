"use strict";

const { Position, Range, Selection, Uri, SnippetString, EndOfLine } = require("./types.cjs");

/**
 * Keeps the host's view of the app's code editors: open documents (content
 * synced on every change), the active editor and its selections. Edits made
 * by extensions (`TextEditor.edit`, `WorkspaceEdit`) are applied by the app.
 */

function toRange(r) {
  return new Range(r.start.line, r.start.character, r.end.line, r.end.character);
}

function serializeRange(range) {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function createEditors(host) {
  const editors = new Map();
  const { workspace, editorEvents } = host;

  function editorFor(data) {
    const key = data.uri.toString();
    let editor = editors.get(key);
    if (editor) return editor;
    let selections = [new Selection(0, 0, 0, 0)];
    let visibleRanges = [new Range(0, 0, 0, 0)];
    const options = { tabSize: 4, insertSpaces: true, cursorStyle: 1, lineNumbers: 1 };
    editor = {
      get document() {
        return data.document;
      },
      get selection() {
        return selections[0];
      },
      set selection(value) {
        selections = [value];
        host.rpc.notify("editor.setSelection", {
          path: data.uri.fsPath,
          selections: [serializeSelection(value)],
        });
      },
      get selections() {
        return selections;
      },
      set selections(value) {
        selections = value.length ? value : selections;
        host.rpc.notify("editor.setSelection", {
          path: data.uri.fsPath,
          selections: selections.map(serializeSelection),
        });
      },
      get visibleRanges() {
        return visibleRanges;
      },
      options,
      viewColumn: 1,
      async edit(callback, editOptions = {}) {
        const edits = [];
        let eol;
        const builder = {
          replace: (location, value) => {
            const range = location instanceof Position ? new Range(location, location) : location;
            edits.push({ range: serializeRange(range), newText: value });
          },
          insert: (position, value) =>
            edits.push({ range: serializeRange(new Range(position, position)), newText: value }),
          delete: (range) => edits.push({ range: serializeRange(range), newText: "" }),
          setEndOfLine: (value) => {
            eol = value;
          },
        };
        callback(builder);
        if (eol !== undefined) {
          const text = data.text.replace(/\r?\n/g, eol === EndOfLine.CRLF ? "\r\n" : "\n");
          const end = data.positionAt(data.text.length);
          edits.splice(0, edits.length, {
            range: serializeRange(new Range(new Position(0, 0), end)),
            newText: text,
          });
        }
        if (edits.length === 0) return true;
        const result = await host.rpc.request("document.applyEdits", {
          path: data.uri.fsPath,
          edits,
          undoStopBefore: editOptions.undoStopBefore !== false,
        });
        return result !== false;
      },
      async insertSnippet(snippet, location) {
        const value = snippet instanceof SnippetString ? snippet.value : String(snippet);
        const ranges = !location
          ? selections
          : Array.isArray(location)
            ? location.map((l) => (l instanceof Position ? new Range(l, l) : l))
            : [location instanceof Position ? new Range(location, location) : location];
        const result = await host.rpc.request("editor.insertSnippet", {
          path: data.uri.fsPath,
          snippet: value,
          ranges: ranges.map(serializeRange),
        });
        return result !== false;
      },
      setDecorations() {},
      revealRange(range) {
        host.rpc.notify("editor.reveal", { path: data.uri.fsPath, range: serializeRange(range) });
      },
      show() {
        void host.rpc.request("window.showTextDocument", { path: data.uri.fsPath });
      },
      hide() {},
      _setSelections(next) {
        selections = next;
      },
      _setVisibleRanges(next) {
        visibleRanges = next;
      },
    };
    editors.set(key, editor);
    return editor;
  }

  function serializeSelection(selection) {
    return {
      anchor: { line: selection.anchor.line, character: selection.anchor.character },
      active: { line: selection.active.line, character: selection.active.character },
    };
  }

  function selectionFrom(value) {
    return new Selection(
      value.anchor.line,
      value.anchor.character,
      value.active.line,
      value.active.character
    );
  }

  function setActive(data) {
    const editor = data ? editorFor(data) : undefined;
    if (host.activeTextEditor === editor) return;
    host.activeTextEditor = editor;
    host.visibleTextEditors = editor ? [editor] : [];
    editorEvents.onDidChangeActiveTextEditor.fire(editor);
    editorEvents.onDidChangeVisibleTextEditors.fire(host.visibleTextEditors);
  }

  function dataFor(fsPath) {
    return workspace.documents.get(Uri.file(fsPath).toString());
  }

  // ── Document lifecycle from the app ──────────────────────────────────────
  host.rpc.on("document.opened", ({ path, languageId, version, text }) => {
    workspace.acceptDocument({ path, languageId, version, text });
  });

  host.rpc.on("document.changed", ({ path, version, changes, text }) => {
    const data = dataFor(path);
    if (!data) {
      if (typeof text === "string") workspace.acceptDocument({ path, version, text });
      return;
    }
    const contentChanges = [];
    if (Array.isArray(changes)) {
      for (const change of changes) {
        const range = toRange(change.range);
        const rangeOffset = data.offsetAt(range.start);
        const rangeLength = data.offsetAt(range.end) - rangeOffset;
        data.applyChanges([{ range: change.range, text: change.text }], data.version);
        contentChanges.push({ range, rangeOffset, rangeLength, text: change.text });
      }
      data.version = version ?? data.version + 1;
    } else if (typeof text === "string") {
      const range = new Range(new Position(0, 0), data.positionAt(data.text.length));
      const rangeLength = data.text.length;
      data.applyChanges([{ text }], version);
      contentChanges.push({ range, rangeOffset: 0, rangeLength, text });
    }
    data.isDirty = true;
    workspace.events.onDidChangeTextDocument.fire({
      document: data.document,
      contentChanges,
      reason: undefined,
    });
  });

  host.rpc.on("document.saved", ({ path }) => {
    const data = dataFor(path);
    if (!data) return;
    data.isDirty = false;
    workspace.events.onDidSaveTextDocument.fire(data.document);
  });

  host.rpc.on("document.closed", ({ path }) => {
    const data = dataFor(path);
    if (!data) return;
    data.isClosed = true;
    workspace.documents.delete(data.uri.toString());
    editors.delete(data.uri.toString());
    if (host.activeTextEditor?.document === data.document) setActive(undefined);
    workspace.events.onDidCloseTextDocument.fire(data.document);
  });

  host.rpc.on("editor.active", ({ path, selections }) => {
    const data = path ? dataFor(path) : undefined;
    setActive(data);
    if (data && Array.isArray(selections) && selections.length) {
      editorFor(data)._setSelections(selections.map(selectionFrom));
    }
  });

  host.rpc.on("editor.selection", ({ path, selections }) => {
    const data = dataFor(path);
    if (!data || !Array.isArray(selections) || selections.length === 0) return;
    const editor = editorFor(data);
    editor._setSelections(selections.map(selectionFrom));
    editorEvents.onDidChangeTextEditorSelection.fire({
      textEditor: editor,
      selections: editor.selections,
      kind: 1,
    });
  });

  host.rpc.on("editor.visibleRanges", ({ path, ranges }) => {
    const data = dataFor(path);
    if (!data || !Array.isArray(ranges)) return;
    const editor = editorFor(data);
    editor._setVisibleRanges(ranges.map(toRange));
    editorEvents.onDidChangeTextEditorVisibleRanges.fire({
      textEditor: editor,
      visibleRanges: editor.visibleRanges,
    });
  });

  return { editorFor, setActive, serializeRange, toRange };
}

module.exports = { createEditors, serializeRange, toRange };
