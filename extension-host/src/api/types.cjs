"use strict";

/**
 * Value types of the `vscode` API (Uri, Position, Range, EventEmitter, ...).
 * Extensions construct these and even subclass them at load time
 * (vscode-languageclient does `class X extends vscode.CompletionItem`), so
 * they must exist with VS Code's shapes and semantics.
 */

const path = require("node:path");

// ─── Disposable / events / cancellation ──────────────────────────────────────

class Disposable {
  static from(...disposables) {
    return new Disposable(() => {
      for (const d of disposables) if (d && typeof d.dispose === "function") d.dispose();
    });
  }
  constructor(callOnDispose) {
    this._callOnDispose = callOnDispose;
  }
  dispose() {
    if (typeof this._callOnDispose === "function") {
      const fn = this._callOnDispose;
      this._callOnDispose = undefined;
      fn();
    }
  }
}

class EventEmitter {
  constructor() {
    this._listeners = new Set();
    this._disposed = false;
    this.event = (listener, thisArgs, disposables) => {
      const entry = { listener, thisArgs };
      this._listeners.add(entry);
      const disposable = new Disposable(() => this._listeners.delete(entry));
      if (Array.isArray(disposables)) disposables.push(disposable);
      return disposable;
    };
  }
  fire(data) {
    if (this._disposed) return;
    for (const { listener, thisArgs } of [...this._listeners]) {
      try {
        listener.call(thisArgs, data);
      } catch (error) {
        console.error("[exthost] event listener failed:", error);
      }
    }
  }
  dispose() {
    this._disposed = true;
    this._listeners.clear();
  }
}

/** An event that never fires (placeholders for unsupported sources). */
const noneEvent = () => new Disposable(() => {});

class CancellationError extends Error {
  constructor() {
    super("Canceled");
    this.name = "Canceled";
  }
}

class CancellationTokenSource {
  constructor() {
    this._emitter = new EventEmitter();
    const self = this;
    this.token = {
      isCancellationRequested: false,
      onCancellationRequested: self._emitter.event,
    };
  }
  cancel() {
    if (this.token.isCancellationRequested) return;
    this.token.isCancellationRequested = true;
    this._emitter.fire(undefined);
  }
  dispose() {
    this._emitter.dispose();
  }
}

const CancellationToken = {
  None: Object.freeze({ isCancellationRequested: false, onCancellationRequested: noneEvent }),
  Cancelled: Object.freeze({ isCancellationRequested: true, onCancellationRequested: noneEvent }),
};

// ─── Uri ─────────────────────────────────────────────────────────────────────

const isWindows = process.platform === "win32";
const URI_REGEX = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

function encodePath(value) {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");
}

class Uri {
  static parse(value, _strict) {
    const match = URI_REGEX.exec(String(value));
    if (!match) return new Uri("file", "", "", "", "");
    const decode = (s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    return new Uri(
      match[2] || "file",
      decode(match[4] || ""),
      decode(match[5] || ""),
      decode(match[7] || ""),
      decode(match[9] || "")
    );
  }

  static file(fsPath) {
    let p = String(fsPath);
    let authority = "";
    if (isWindows) p = p.replace(/\\/g, "/");
    if (p.startsWith("//")) {
      const index = p.indexOf("/", 2);
      authority = index === -1 ? p.slice(2) : p.slice(2, index);
      p = index === -1 ? "/" : p.slice(index);
    }
    if (!p.startsWith("/")) p = `/${p}`;
    return new Uri("file", authority, p, "", "");
  }

  static joinPath(base, ...segments) {
    if (!base.path) throw new Error("[UriError]: cannot call joinPath on URI without path");
    const joined = path.posix.join(base.path, ...segments);
    return base.with({ path: joined });
  }

  static from(components) {
    return new Uri(
      components.scheme,
      components.authority ?? "",
      components.path ?? "",
      components.query ?? "",
      components.fragment ?? ""
    );
  }

  static isUri(thing) {
    return thing instanceof Uri;
  }

  static revive(data) {
    if (!data || data instanceof Uri) return data;
    return Uri.from(data);
  }

  constructor(scheme, authority, pathValue, query, fragment) {
    if (typeof scheme === "object" && scheme !== null) {
      ({ scheme, authority, path: pathValue, query, fragment } = scheme);
    }
    this.scheme = scheme || "file";
    this.authority = authority || "";
    this.path = pathValue || "";
    if (this.scheme === "file" || this.authority) {
      if (this.path && !this.path.startsWith("/")) this.path = `/${this.path}`;
    }
    this.query = query || "";
    this.fragment = fragment || "";
  }

  get fsPath() {
    let value;
    if (this.authority && this.path.length > 1 && this.scheme === "file") {
      value = `//${this.authority}${this.path}`;
    } else if (/^\/[a-zA-Z]:/.test(this.path)) {
      value = this.path[1].toLowerCase() + this.path.slice(2);
    } else {
      value = this.path;
    }
    return isWindows ? value.replace(/\//g, "\\") : value;
  }

  with(change) {
    if (!change) return this;
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  toString(skipEncoding) {
    const enc = skipEncoding ? (s) => s : encodePath;
    let result = `${this.scheme}:`;
    if (this.authority || this.scheme === "file") result += `//${this.authority}`;
    result += enc(this.path);
    if (this.query) result += `?${skipEncoding ? this.query : encodeURIComponent(this.query)}`;
    if (this.fragment) {
      result += `#${skipEncoding ? this.fragment : encodeURIComponent(this.fragment)}`;
    }
    return result;
  }

  toJSON() {
    return {
      $mid: 1,
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
      fsPath: this.fsPath,
      external: this.toString(),
    };
  }
}

// ─── Positions and ranges ────────────────────────────────────────────────────

class Position {
  static isPosition(thing) {
    return thing instanceof Position;
  }
  constructor(line, character) {
    if (line < 0) throw new Error("Illegal argument: line must be non-negative");
    if (character < 0) throw new Error("Illegal argument: character must be non-negative");
    this.line = line;
    this.character = character;
  }
  isBefore(other) {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }
  isBeforeOrEqual(other) {
    return this.isBefore(other) || this.isEqual(other);
  }
  isAfter(other) {
    return !this.isBeforeOrEqual(other);
  }
  isAfterOrEqual(other) {
    return !this.isBefore(other);
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
  compareTo(other) {
    if (this.isBefore(other)) return -1;
    if (this.isAfter(other)) return 1;
    return 0;
  }
  translate(lineDeltaOrChange = 0, characterDelta = 0) {
    if (typeof lineDeltaOrChange === "object") {
      characterDelta = lineDeltaOrChange.characterDelta ?? 0;
      lineDeltaOrChange = lineDeltaOrChange.lineDelta ?? 0;
    }
    return new Position(this.line + lineDeltaOrChange, this.character + characterDelta);
  }
  with(lineOrChange, character) {
    if (typeof lineOrChange === "object" && lineOrChange !== null) {
      return new Position(lineOrChange.line ?? this.line, lineOrChange.character ?? this.character);
    }
    return new Position(lineOrChange ?? this.line, character ?? this.character);
  }
  toJSON() {
    return { line: this.line, character: this.character };
  }
}

class Range {
  static isRange(thing) {
    return thing instanceof Range;
  }
  constructor(startLineOrStart, startCharacterOrEnd, endLine, endCharacter) {
    let start;
    let end;
    if (typeof startLineOrStart === "number") {
      start = new Position(startLineOrStart, startCharacterOrEnd);
      end = new Position(endLine, endCharacter);
    } else {
      start = startLineOrStart;
      end = startCharacterOrEnd;
    }
    if (start.isAfter(end)) [start, end] = [end, start];
    this.start = start;
    this.end = end;
  }
  get isEmpty() {
    return this.start.isEqual(this.end);
  }
  get isSingleLine() {
    return this.start.line === this.end.line;
  }
  contains(positionOrRange) {
    if (positionOrRange instanceof Range) {
      return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
    }
    return positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end);
  }
  isEqual(other) {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
  intersection(other) {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    return start.isAfter(end) ? undefined : new Range(start, end);
  }
  union(other) {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new Range(start, end);
  }
  with(startOrChange, end) {
    if (
      startOrChange &&
      !(startOrChange instanceof Position) &&
      typeof startOrChange === "object"
    ) {
      return new Range(startOrChange.start ?? this.start, startOrChange.end ?? this.end);
    }
    return new Range(startOrChange ?? this.start, end ?? this.end);
  }
  toJSON() {
    return [this.start.toJSON(), this.end.toJSON()];
  }
}

class Selection extends Range {
  static isSelection(thing) {
    return thing instanceof Selection;
  }
  constructor(anchorLineOrAnchor, anchorCharacterOrActive, activeLine, activeCharacter) {
    let anchor;
    let active;
    if (typeof anchorLineOrAnchor === "number") {
      anchor = new Position(anchorLineOrAnchor, anchorCharacterOrActive);
      active = new Position(activeLine, activeCharacter);
    } else {
      anchor = anchorLineOrAnchor;
      active = anchorCharacterOrActive;
    }
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
  get isReversed() {
    return this.anchor === this.end;
  }
}

class Location {
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range =
      rangeOrPosition instanceof Position
        ? new Range(rangeOrPosition, rangeOrPosition)
        : rangeOrPosition;
  }
}

// ─── Edits and text ──────────────────────────────────────────────────────────

const EndOfLine = { LF: 1, CRLF: 2 };

class TextEdit {
  static replace(range, newText) {
    return new TextEdit(range, newText);
  }
  static insert(position, newText) {
    return new TextEdit(new Range(position, position), newText);
  }
  static delete(range) {
    return new TextEdit(range, "");
  }
  static setEndOfLine(eol) {
    const edit = new TextEdit(new Range(new Position(0, 0), new Position(0, 0)), "");
    edit.newEol = eol;
    return edit;
  }
  constructor(range, newText) {
    this.range = range;
    this.newText = newText;
  }
}

class SnippetTextEdit {
  static replace(range, snippet) {
    return new SnippetTextEdit(range, snippet);
  }
  static insert(position, snippet) {
    return new SnippetTextEdit(new Range(position, position), snippet);
  }
  constructor(range, snippet) {
    this.range = range;
    this.snippet = snippet;
  }
}

class WorkspaceEdit {
  constructor() {
    this._edits = [];
  }
  get size() {
    return new Set(this._edits.map((e) => e.uri.toString())).size;
  }
  replace(uri, range, newText, metadata) {
    this._edits.push({ kind: "text", uri, edit: new TextEdit(range, newText), metadata });
  }
  insert(uri, position, newText, metadata) {
    this.replace(uri, new Range(position, position), newText, metadata);
  }
  delete(uri, range, metadata) {
    this.replace(uri, range, "", metadata);
  }
  set(uri, edits) {
    this._edits = this._edits.filter((e) => e.uri.toString() !== uri.toString());
    for (const entry of edits || []) {
      const edit = Array.isArray(entry) ? entry[0] : entry;
      if (edit) this._edits.push({ kind: "text", uri, edit });
    }
  }
  get(uri) {
    return this._edits
      .filter((e) => e.kind === "text" && e.uri.toString() === uri.toString())
      .map((e) => e.edit);
  }
  has(uri) {
    return this._edits.some((e) => e.uri.toString() === uri.toString());
  }
  entries() {
    const map = new Map();
    for (const e of this._edits) {
      if (e.kind !== "text") continue;
      const key = e.uri.toString();
      if (!map.has(key)) map.set(key, [e.uri, []]);
      map.get(key)[1].push(e.edit);
    }
    return [...map.values()];
  }
  createFile(uri, options, metadata) {
    this._edits.push({ kind: "create", uri, options, metadata });
  }
  deleteFile(uri, options, metadata) {
    this._edits.push({ kind: "delete", uri, options, metadata });
  }
  renameFile(oldUri, newUri, options, metadata) {
    this._edits.push({ kind: "rename", uri: oldUri, newUri, options, metadata });
  }
}

class SnippetString {
  static isSnippetString(thing) {
    return thing instanceof SnippetString;
  }
  constructor(value = "") {
    this.value = value;
    this._tabstop = 1;
  }
  appendText(text) {
    this.value += text.replace(/[$}\\]/g, "\\$&");
    return this;
  }
  appendTabstop(number = this._tabstop++) {
    this.value += `$${number}`;
    return this;
  }
  appendPlaceholder(value, number = this._tabstop++) {
    if (typeof value === "function") {
      const nested = new SnippetString();
      nested._tabstop = this._tabstop;
      value(nested);
      this._tabstop = nested._tabstop;
      value = nested.value;
    } else {
      value = String(value).replace(/[$}\\]/g, "\\$&");
    }
    this.value += `\${${number}:${value}}`;
    return this;
  }
  appendChoice(values, number = this._tabstop++) {
    this.value += `\${${number}|${values.map((v) => v.replace(/[,|\\]/g, "\\$&")).join(",")}|}`;
    return this;
  }
  appendVariable(name, defaultValue) {
    if (typeof defaultValue === "function") {
      const nested = new SnippetString();
      nested._tabstop = this._tabstop;
      defaultValue(nested);
      this._tabstop = nested._tabstop;
      defaultValue = nested.value;
    }
    this.value += defaultValue ? `\${${name}:${defaultValue}}` : `\${${name}}`;
    return this;
  }
}

class MarkdownString {
  static isMarkdownString(thing) {
    return (
      thing instanceof MarkdownString ||
      (thing && typeof thing.value === "string" && "isTrusted" in thing)
    );
  }
  constructor(value = "", supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
    this.isTrusted = undefined;
    this.supportHtml = false;
    this.baseUri = undefined;
  }
  appendText(value) {
    this.value += value.replace(/[\\`*_{}[\]()#+\-.!<>]/g, "\\$&").replace(/\n/g, "\n\n");
    return this;
  }
  appendMarkdown(value) {
    this.value += value;
    return this;
  }
  appendCodeblock(code, language = "") {
    this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    return this;
  }
}

// ─── Workbench items ─────────────────────────────────────────────────────────

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}
ThemeIcon.File = new ThemeIcon("file");
ThemeIcon.Folder = new ThemeIcon("folder");

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
const TreeItemCheckboxState = { Unchecked: 0, Checked: 1 };

class TreeItem {
  constructor(labelOrUri, collapsibleState = TreeItemCollapsibleState.None) {
    if (labelOrUri instanceof Uri) this.resourceUri = labelOrUri;
    else this.label = labelOrUri;
    this.collapsibleState = collapsibleState;
  }
}

class DataTransferItem {
  constructor(value) {
    this.value = value;
  }
  asString() {
    return Promise.resolve(
      typeof this.value === "string" ? this.value : JSON.stringify(this.value)
    );
  }
  asFile() {
    return undefined;
  }
}

class DataTransfer {
  constructor() {
    this._items = new Map();
  }
  get(mimeType) {
    return this._items.get(mimeType.toLowerCase());
  }
  set(mimeType, value) {
    this._items.set(mimeType.toLowerCase(), value);
  }
  forEach(callback, thisArg) {
    for (const [mime, item] of this._items) callback.call(thisArg, item, mime, this);
  }
  *[Symbol.iterator]() {
    yield* this._items.entries();
  }
}

class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}

class TabInputWebview {
  constructor(viewType) {
    this.viewType = viewType;
  }
}

// ─── Language feature values ─────────────────────────────────────────────────

const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
const DiagnosticTag = { Unnecessary: 1, Deprecated: 2 };

class Diagnostic {
  constructor(range, message, severity = DiagnosticSeverity.Error) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

class DiagnosticRelatedInformation {
  constructor(location, message) {
    this.location = location;
    this.message = message;
  }
}

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
  User: 25,
  Issue: 26,
};
const CompletionItemTag = { Deprecated: 1 };
const CompletionTriggerKind = {
  Invoke: 0,
  TriggerCharacter: 1,
  TriggerForIncompleteCompletions: 2,
};

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class CompletionList {
  constructor(items = [], isIncomplete = false) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

class Hover {
  constructor(contents, range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

class SignatureInformation {
  constructor(label, documentation) {
    this.label = label;
    this.documentation = documentation;
    this.parameters = [];
  }
}
class ParameterInformation {
  constructor(label, documentation) {
    this.label = label;
    this.documentation = documentation;
  }
}
class SignatureHelp {
  constructor() {
    this.signatures = [];
    this.activeSignature = 0;
    this.activeParameter = 0;
  }
}
const SignatureHelpTriggerKind = { Invoke: 1, TriggerCharacter: 2, ContentChange: 3 };

const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  String: 14,
  Number: 15,
  Boolean: 16,
  Array: 17,
  Object: 18,
  Key: 19,
  Null: 20,
  EnumMember: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
};
const SymbolTag = { Deprecated: 1 };

class SymbolInformation {
  constructor(name, kind, rangeOrContainer, locationOrUri, containerName) {
    this.name = name;
    this.kind = kind;
    if (locationOrUri instanceof Location || locationOrUri === undefined) {
      this.containerName = typeof rangeOrContainer === "string" ? rangeOrContainer : containerName;
      this.location = locationOrUri;
    } else {
      this.containerName = containerName;
      this.location = new Location(locationOrUri, rangeOrContainer);
    }
  }
}

class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
}

const DocumentHighlightKind = { Text: 0, Read: 1, Write: 2 };
class DocumentHighlight {
  constructor(range, kind = DocumentHighlightKind.Text) {
    this.range = range;
    this.kind = kind;
  }
}

class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
}

class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
  }
  get isResolved() {
    return !!this.command;
  }
}

class CodeActionKind {
  constructor(value) {
    this.value = value;
  }
  append(parts) {
    return new CodeActionKind(this.value ? `${this.value}.${parts}` : parts);
  }
  intersects(other) {
    return this.contains(other) || other.contains(this);
  }
  contains(other) {
    return this.value === other.value || other.value.startsWith(`${this.value}.`);
  }
}
CodeActionKind.Empty = new CodeActionKind("");
CodeActionKind.QuickFix = new CodeActionKind("quickfix");
CodeActionKind.Refactor = new CodeActionKind("refactor");
CodeActionKind.RefactorExtract = new CodeActionKind("refactor.extract");
CodeActionKind.RefactorInline = new CodeActionKind("refactor.inline");
CodeActionKind.RefactorMove = new CodeActionKind("refactor.move");
CodeActionKind.RefactorRewrite = new CodeActionKind("refactor.rewrite");
CodeActionKind.Source = new CodeActionKind("source");
CodeActionKind.SourceOrganizeImports = new CodeActionKind("source.organizeImports");
CodeActionKind.SourceFixAll = new CodeActionKind("source.fixAll");
CodeActionKind.Notebook = new CodeActionKind("notebook");

const CodeActionTriggerKind = { Invoke: 1, Automatic: 2 };

class CodeAction {
  constructor(title, kind) {
    this.title = title;
    this.kind = kind;
  }
}

class FoldingRange {
  constructor(start, end, kind) {
    this.start = start;
    this.end = end;
    this.kind = kind;
  }
}
const FoldingRangeKind = { Comment: 1, Imports: 2, Region: 3 };

class SelectionRange {
  constructor(range, parent) {
    this.range = range;
    this.parent = parent;
  }
}

class Color {
  constructor(red, green, blue, alpha) {
    Object.assign(this, { red, green, blue, alpha });
  }
}
class ColorInformation {
  constructor(range, color) {
    this.range = range;
    this.color = color;
  }
}
class ColorPresentation {
  constructor(label) {
    this.label = label;
  }
}

class InlayHint {
  constructor(position, label, kind) {
    this.position = position;
    this.label = label;
    this.kind = kind;
  }
}
class InlayHintLabelPart {
  constructor(value) {
    this.value = value;
  }
}
const InlayHintKind = { Type: 1, Parameter: 2 };

class CallHierarchyItem {
  constructor(kind, name, detail, uri, range, selectionRange) {
    Object.assign(this, { kind, name, detail, uri, range, selectionRange });
  }
}
class CallHierarchyIncomingCall {
  constructor(from, fromRanges) {
    Object.assign(this, { from, fromRanges });
  }
}
class CallHierarchyOutgoingCall {
  constructor(to, fromRanges) {
    Object.assign(this, { to, fromRanges });
  }
}
class TypeHierarchyItem {
  constructor(kind, name, detail, uri, range, selectionRange) {
    Object.assign(this, { kind, name, detail, uri, range, selectionRange });
  }
}

class LinkedEditingRanges {
  constructor(ranges, wordPattern) {
    this.ranges = ranges;
    this.wordPattern = wordPattern;
  }
}

class SemanticTokensLegend {
  constructor(tokenTypes, tokenModifiers = []) {
    this.tokenTypes = tokenTypes;
    this.tokenModifiers = tokenModifiers;
  }
}
class SemanticTokens {
  constructor(data, resultId) {
    this.data = data;
    this.resultId = resultId;
  }
}
class SemanticTokensEdits {
  constructor(edits, resultId) {
    this.edits = edits;
    this.resultId = resultId;
  }
}
class SemanticTokensEdit {
  constructor(start, deleteCount, data) {
    Object.assign(this, { start, deleteCount, data });
  }
}
class SemanticTokensBuilder {
  constructor(legend) {
    this._legend = legend;
    this._data = [];
  }
  push(line, char, length, tokenType, tokenModifiers = 0) {
    this._data.push(line, char, length, tokenType, tokenModifiers);
  }
  build(resultId) {
    return new SemanticTokens(new Uint32Array(this._data), resultId);
  }
}

class InlineValueText {
  constructor(range, text) {
    this.range = range;
    this.text = text;
  }
}
class InlineValueVariableLookup {
  constructor(range, variableName, caseSensitiveLookup = true) {
    Object.assign(this, { range, variableName, caseSensitiveLookup });
  }
}
class InlineValueEvaluatableExpression {
  constructor(range, expression) {
    this.range = range;
    this.expression = expression;
  }
}
class InlineCompletionItem {
  constructor(insertText, range, command) {
    Object.assign(this, { insertText, range, command });
  }
}
class InlineCompletionList {
  constructor(items) {
    this.items = items;
  }
}
class EvaluatableExpression {
  constructor(range, expression) {
    this.range = range;
    this.expression = expression;
  }
}
class DocumentDropEdit {
  constructor(insertText) {
    this.insertText = insertText;
  }
}
class DocumentPasteEdit {
  constructor(insertText, title, kind) {
    Object.assign(this, { insertText, title, kind });
  }
}

// ─── Tasks, debug and misc (only shapes, the features are not supported) ─────

class ShellExecution {
  constructor(commandLine, argsOrOptions, options) {
    if (Array.isArray(argsOrOptions)) {
      this.command = commandLine;
      this.args = argsOrOptions;
      this.options = options;
    } else {
      this.commandLine = commandLine;
      this.options = argsOrOptions;
    }
  }
}
class ProcessExecution {
  constructor(process, argsOrOptions, options) {
    this.process = process;
    this.args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    this.options = Array.isArray(argsOrOptions) ? options : argsOrOptions;
  }
}
class CustomExecution {
  constructor(callback) {
    this.callback = callback;
  }
}
class Task {
  constructor(definition, scope, name, source, execution, problemMatchers) {
    Object.assign(this, { definition, scope, name, source, execution, problemMatchers });
    this.isBackground = false;
    this.presentationOptions = {};
  }
}
class TaskGroup {
  constructor(id, label) {
    this.id = id;
    this.label = label;
  }
}
TaskGroup.Build = new TaskGroup("build", "Build");
TaskGroup.Test = new TaskGroup("test", "Test");
TaskGroup.Clean = new TaskGroup("clean", "Clean");
TaskGroup.Rebuild = new TaskGroup("rebuild", "Rebuild");

class Breakpoint {
  constructor(enabled, condition, hitCondition, logMessage) {
    Object.assign(this, { enabled, condition, hitCondition, logMessage });
  }
}
class SourceBreakpoint extends Breakpoint {
  constructor(location, enabled, condition, hitCondition, logMessage) {
    super(enabled, condition, hitCondition, logMessage);
    this.location = location;
  }
}
class FunctionBreakpoint extends Breakpoint {
  constructor(functionName, enabled, condition, hitCondition, logMessage) {
    super(enabled, condition, hitCondition, logMessage);
    this.functionName = functionName;
  }
}
class DebugAdapterExecutable {
  constructor(command, args, options) {
    Object.assign(this, { command, args, options });
  }
}
class DebugAdapterServer {
  constructor(port, host) {
    this.port = port;
    this.host = host;
  }
}
class DebugAdapterNamedPipeServer {
  constructor(path) {
    this.path = path;
  }
}
class DebugAdapterInlineImplementation {
  constructor(implementation) {
    this.implementation = implementation;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = typeof base === "string" ? Uri.file(base) : (base.uri ?? base);
    this.base = this.baseUri.fsPath;
    this.pattern = pattern;
  }
}

class TerminalLink {
  constructor(startIndex, length, tooltip) {
    Object.assign(this, { startIndex, length, tooltip });
  }
}
class TerminalProfile {
  constructor(options) {
    this.options = options;
  }
}

class QuickInputButtons {}
QuickInputButtons.Back = { iconPath: new ThemeIcon("arrow-left"), tooltip: "Back" };

class FileSystemError extends Error {
  static FileNotFound(messageOrUri) {
    return new FileSystemError(messageOrUri, "FileNotFound");
  }
  static FileExists(messageOrUri) {
    return new FileSystemError(messageOrUri, "FileExists");
  }
  static FileNotADirectory(messageOrUri) {
    return new FileSystemError(messageOrUri, "FileNotADirectory");
  }
  static FileIsADirectory(messageOrUri) {
    return new FileSystemError(messageOrUri, "FileIsADirectory");
  }
  static NoPermissions(messageOrUri) {
    return new FileSystemError(messageOrUri, "NoPermissions");
  }
  static Unavailable(messageOrUri) {
    return new FileSystemError(messageOrUri, "Unavailable");
  }
  constructor(messageOrUri, code = "Unknown") {
    super(messageOrUri instanceof Uri ? messageOrUri.toString(true) : messageOrUri);
    this.code = code;
    this.name = `${code} (FileSystemError)`;
  }
}

class NotebookRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}
class NotebookCellData {
  constructor(kind, value, languageId) {
    Object.assign(this, { kind, value, languageId });
  }
}
class NotebookData {
  constructor(cells) {
    this.cells = cells;
  }
}
class NotebookCellOutputItem {
  constructor(data, mime) {
    this.data = data;
    this.mime = mime;
  }
  static text(value, mime = "text/plain") {
    return new NotebookCellOutputItem(Buffer.from(String(value), "utf8"), mime);
  }
  static json(value, mime = "text/x-json") {
    return NotebookCellOutputItem.text(JSON.stringify(value, undefined, "\t"), mime);
  }
  static stdout(value) {
    return NotebookCellOutputItem.text(value, "application/vnd.code.notebook.stdout");
  }
  static stderr(value) {
    return NotebookCellOutputItem.text(value, "application/vnd.code.notebook.stderr");
  }
  static error(value) {
    const error = { name: value?.name, message: value?.message, stack: value?.stack };
    return NotebookCellOutputItem.text(
      JSON.stringify(error),
      "application/vnd.code.notebook.error"
    );
  }
}
class NotebookCellOutput {
  constructor(items, idOrMetadata, metadata) {
    this.items = items;
    this.id = typeof idOrMetadata === "string" ? idOrMetadata : undefined;
    this.metadata = typeof idOrMetadata === "string" ? metadata : idOrMetadata;
  }
}
class NotebookEdit {
  constructor(range, newCells) {
    this.range = range;
    this.newCells = newCells;
  }
  static replaceCells(range, newCells) {
    return new NotebookEdit(range, newCells);
  }
  static insertCells(index, newCells) {
    return new NotebookEdit(new NotebookRange(index, index), newCells);
  }
  static deleteCells(range) {
    return new NotebookEdit(range, []);
  }
  static updateCellMetadata(index, newCellMetadata) {
    return Object.assign(new NotebookEdit(new NotebookRange(index, index), []), {
      newCellMetadata,
    });
  }
  static updateNotebookMetadata(newNotebookMetadata) {
    return Object.assign(new NotebookEdit(new NotebookRange(0, 0), []), { newNotebookMetadata });
  }
}
class TestMessage {
  constructor(message) {
    this.message = message;
  }
}
class TestTag {
  constructor(id) {
    this.id = id;
  }
}
class TestRunRequest {
  constructor(include, exclude, profile) {
    Object.assign(this, { include, exclude, profile });
  }
}
class LanguageModelChatMessage {
  static User(content) {
    return new LanguageModelChatMessage(1, content);
  }
  static Assistant(content) {
    return new LanguageModelChatMessage(2, content);
  }
  constructor(role, content, name) {
    Object.assign(this, { role, content, name });
  }
}
class LanguageModelTextPart {
  constructor(value) {
    this.value = value;
  }
}

// ─── Enums ───────────────────────────────────────────────────────────────────

const enums = {
  ViewColumn: {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ExtensionKind: { UI: 1, Workspace: 2 },
  LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  TextEditorCursorStyle: {
    Line: 1,
    Block: 2,
    Underline: 3,
    LineThin: 4,
    BlockOutline: 5,
    UnderlineThin: 6,
  },
  TextEditorLineNumbersStyle: { Off: 0, On: 1, Relative: 2, Interval: 3 },
  TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
  TextDocumentChangeReason: { Undo: 1, Redo: 2 },
  DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  IndentAction: { None: 0, Indent: 1, IndentOutdent: 2, Outdent: 3 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  FilePermission: { Readonly: 1 },
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  UIKind: { Desktop: 1, Web: 2 },
  TerminalLocation: { Panel: 1, Editor: 2 },
  TerminalExitReason: { Unknown: 0, Shutdown: 1, Process: 2, User: 3, Extension: 4 },
  TerminalShellExecutionCommandLineConfidence: { Low: 0, Medium: 1, High: 2 },
  EnvironmentVariableMutatorType: { Replace: 1, Append: 2, Prepend: 3 },
  TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
  TaskPanelKind: { Shared: 1, Dedicated: 2, New: 3 },
  TaskScope: { Global: 1, Workspace: 2 },
  ShellQuoting: { Escape: 1, Strong: 2, Weak: 3 },
  DebugConsoleMode: { Separate: 0, MergeWithParent: 1 },
  DebugConfigurationProviderTriggerKind: { Initial: 1, Dynamic: 2 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  CommentMode: { Editing: 0, Preview: 1 },
  CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
  NotebookCellKind: { Markup: 1, Code: 2 },
  NotebookEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  DocumentPasteTriggerKind: { Automatic: 0, PasteAs: 1 },
  LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
  SignatureHelpTriggerKind,
  CompletionItemKind,
  CompletionItemTag,
  CompletionTriggerKind,
  DiagnosticSeverity,
  DiagnosticTag,
  SymbolKind,
  SymbolTag,
  DocumentHighlightKind,
  CodeActionTriggerKind,
  FoldingRangeKind,
  InlayHintKind,
  TreeItemCollapsibleState,
  TreeItemCheckboxState,
  EndOfLine,
};

module.exports = {
  Disposable,
  EventEmitter,
  noneEvent,
  CancellationError,
  CancellationTokenSource,
  CancellationToken,
  Uri,
  Position,
  Range,
  Selection,
  Location,
  TextEdit,
  SnippetTextEdit,
  WorkspaceEdit,
  SnippetString,
  MarkdownString,
  ThemeIcon,
  ThemeColor,
  TreeItem,
  DataTransfer,
  DataTransferItem,
  TabInputText,
  TabInputWebview,
  Diagnostic,
  DiagnosticRelatedInformation,
  CompletionItem,
  CompletionList,
  Hover,
  SignatureInformation,
  ParameterInformation,
  SignatureHelp,
  SymbolInformation,
  DocumentSymbol,
  DocumentHighlight,
  DocumentLink,
  CodeLens,
  CodeActionKind,
  CodeAction,
  FoldingRange,
  SelectionRange,
  Color,
  ColorInformation,
  ColorPresentation,
  InlayHint,
  InlayHintLabelPart,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  TypeHierarchyItem,
  LinkedEditingRanges,
  SemanticTokensLegend,
  SemanticTokens,
  SemanticTokensEdits,
  SemanticTokensEdit,
  SemanticTokensBuilder,
  InlineValueText,
  InlineValueVariableLookup,
  InlineValueEvaluatableExpression,
  InlineCompletionItem,
  InlineCompletionList,
  EvaluatableExpression,
  DocumentDropEdit,
  DocumentPasteEdit,
  ShellExecution,
  ProcessExecution,
  CustomExecution,
  Task,
  TaskGroup,
  Breakpoint,
  SourceBreakpoint,
  FunctionBreakpoint,
  DebugAdapterExecutable,
  DebugAdapterServer,
  DebugAdapterNamedPipeServer,
  DebugAdapterInlineImplementation,
  RelativePattern,
  TerminalLink,
  TerminalProfile,
  QuickInputButtons,
  FileSystemError,
  NotebookRange,
  NotebookCellData,
  NotebookData,
  NotebookCellOutputItem,
  NotebookCellOutput,
  NotebookEdit,
  TestMessage,
  TestTag,
  TestRunRequest,
  LanguageModelChatMessage,
  LanguageModelTextPart,
  ...enums,
};
