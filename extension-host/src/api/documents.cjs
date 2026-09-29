"use strict";

const path = require("node:path");
const { Position, Range, EndOfLine, Uri } = require("./types.cjs");

/**
 * `vscode.TextDocument`: an immutable-looking view over text that the host
 * updates in place when the app reports edits (so extensions holding a
 * document reference always see the current content, like in VS Code).
 */

const DEFAULT_WORD = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g;

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    } else if (ch === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

class TextDocumentData {
  constructor(uri, languageId, version, text, save) {
    this.uri = uri;
    this.languageId = languageId;
    this.version = version;
    this.isDirty = false;
    this.isClosed = false;
    this._save = save;
    this.setText(text);
    this.document = createDocument(this);
  }

  setText(text) {
    this.text = text;
    this.lineStarts = computeLineStarts(text);
    this.eol = text.includes("\r\n") ? EndOfLine.CRLF : EndOfLine.LF;
  }

  offsetAt(position) {
    const p = this.validatePosition(position);
    return this.lineStarts[p.line] + p.character;
  }

  positionAt(offset) {
    const clamped = Math.max(0, Math.min(Math.floor(offset), this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.lineStarts[mid] <= clamped) low = mid;
      else high = mid - 1;
    }
    const lineEnd = this.lineEndOffset(low);
    return new Position(low, Math.min(clamped, lineEnd) - this.lineStarts[low]);
  }

  lineEndOffset(line) {
    const start = this.lineStarts[line];
    if (line + 1 >= this.lineStarts.length) return this.text.length;
    let end = this.lineStarts[line + 1];
    if (end > start && this.text[end - 1] === "\n") end--;
    if (end > start && this.text[end - 1] === "\r") end--;
    return end;
  }

  lineText(line) {
    return this.text.slice(this.lineStarts[line], this.lineEndOffset(line));
  }

  validatePosition(position) {
    let line = Math.max(0, Math.min(position.line, this.lineStarts.length - 1));
    let character = position.line < 0 ? 0 : position.character;
    if (position.line >= this.lineStarts.length) {
      line = this.lineStarts.length - 1;
      character = Infinity;
    }
    const length = this.lineEndOffset(line) - this.lineStarts[line];
    character = Math.max(0, Math.min(character, length));
    if (
      line === position.line &&
      character === position.character &&
      position instanceof Position
    ) {
      return position;
    }
    return new Position(line, character);
  }

  validateRange(range) {
    const start = this.validatePosition(range.start);
    const end = this.validatePosition(range.end);
    if (start === range.start && end === range.end) return range;
    return new Range(start, end);
  }

  getText(range) {
    if (!range) return this.text;
    const r = this.validateRange(range);
    return this.text.slice(this.offsetAt(r.start), this.offsetAt(r.end));
  }

  lineAt(lineOrPosition) {
    const line = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
    if (line < 0 || line >= this.lineStarts.length) throw new Error("Illegal value for `line`");
    const text = this.lineText(line);
    const start = this.lineStarts[line];
    const endWithBreak =
      line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
    const firstNonWhitespace = text.search(/\S/);
    return {
      lineNumber: line,
      text,
      range: new Range(line, 0, line, text.length),
      rangeIncludingLineBreak: new Range(new Position(line, 0), this.positionAt(endWithBreak)),
      firstNonWhitespaceCharacterIndex:
        firstNonWhitespace === -1 ? text.length : firstNonWhitespace,
      isEmptyOrWhitespace: firstNonWhitespace === -1,
      _start: start,
    };
  }

  getWordRangeAtPosition(position, regex) {
    const p = this.validatePosition(position);
    const text = this.lineText(p.line);
    const pattern = regex
      ? new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`)
      : new RegExp(DEFAULT_WORD.source, "g");
    let match;
    while ((match = pattern.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (start <= p.character && p.character <= end && match[0].length > 0) {
        return new Range(p.line, start, p.line, end);
      }
      if (match[0].length === 0) pattern.lastIndex++;
    }
    return undefined;
  }

  /** Apply LSP-style changes: `{ range?, text }` (range in line/character). */
  applyChanges(changes, version) {
    for (const change of changes) {
      if (!change.range) {
        this.setText(change.text);
        continue;
      }
      const start = this.offsetAt(
        new Position(change.range.start.line, change.range.start.character)
      );
      const end = this.offsetAt(new Position(change.range.end.line, change.range.end.character));
      this.setText(this.text.slice(0, start) + change.text + this.text.slice(end));
    }
    this.version = version ?? this.version + 1;
  }
}

function createDocument(data) {
  return {
    get uri() {
      return data.uri;
    },
    get fileName() {
      return data.uri.fsPath;
    },
    get isUntitled() {
      return data.uri.scheme === "untitled";
    },
    get languageId() {
      return data.languageId;
    },
    get version() {
      return data.version;
    },
    get isDirty() {
      return data.isDirty;
    },
    get isClosed() {
      return data.isClosed;
    },
    get eol() {
      return data.eol;
    },
    get lineCount() {
      return data.lineStarts.length;
    },
    get encoding() {
      return "utf8";
    },
    save: () => (data._save ? data._save(data) : Promise.resolve(false)),
    lineAt: (lineOrPosition) => data.lineAt(lineOrPosition),
    offsetAt: (position) => data.offsetAt(position),
    positionAt: (offset) => data.positionAt(offset),
    getText: (range) => data.getText(range),
    getWordRangeAtPosition: (position, regex) => data.getWordRangeAtPosition(position, regex),
    validateRange: (range) => data.validateRange(range),
    validatePosition: (position) => data.validatePosition(position),
  };
}

/** Apply TextEdits (VS Code semantics: all ranges refer to the original text). */
function applyTextEdits(text, edits) {
  const data = new TextDocumentData(Uri.file("/tmp/x"), "plaintext", 1, text);
  const resolved = edits
    .map((edit) => ({
      start: data.offsetAt(edit.range.start),
      end: data.offsetAt(edit.range.end),
      text: edit.newText ?? "",
    }))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  for (const edit of resolved)
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

function languageIdFromPath(filePath, languages) {
  const base = path.basename(filePath).toLowerCase();
  for (const language of languages) {
    if (language.filenames?.some((name) => name.toLowerCase() === base)) return language.id;
  }
  let best;
  for (const language of languages) {
    for (const ext of language.extensions ?? []) {
      const e = ext.toLowerCase();
      if (base.endsWith(e) && (!best || e.length > best.length))
        best = { id: language.id, length: e.length };
    }
  }
  return best ? best.id : "plaintext";
}

module.exports = { TextDocumentData, applyTextEdits, languageIdFromPath, computeLineStarts };
