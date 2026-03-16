import type { WhenExpression } from "./types";

// ── ContextKeyService ─────────────────────────────────────────────────────────

/**
 * Manages a key-value context store and evaluates `when` expressions against it.
 *
 * Supported expression syntax:
 * - Simple key lookup:   `editorFocus`
 * - Logical NOT:        `!editorFocus`
 * - Logical AND:        `editorFocus && !readOnly`
 * - Logical OR:         `editorFocus || previewFocus`
 * - Equality:           `mode == 'vim'`
 * - Inequality:         `mode != 'vim'`
 * - Grouping:           `(editorFocus || previewFocus) && !readOnly`
 *
 * Missing context keys default to `false`.
 * Malformed expressions return `false` without throwing.
 */
export class ContextKeyServiceClass {
  private store: Map<string, unknown> = new Map();

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get(key: string): unknown {
    return this.store.get(key);
  }

  /**
   * Evaluate a when expression against the current context.
   *
   * - Returns true if `when` is undefined or empty string (binding always active).
   * - Returns false (never throws) on malformed expressions.
   */
  evaluate(when: WhenExpression | undefined): boolean {
    if (when === undefined || when.trim() === "") return true;
    try {
      return this._parseOr(when.trim(), { pos: 0 });
    } catch {
      return false;
    }
  }

  // ── Recursive descent parser ─────────────────────────────────────────────

  /**
   * Mutable cursor object — avoids threaded position arguments in every call.
   */
  private _parseOr(input: string, cursor: { pos: number }): boolean {
    let left = this._parseAnd(input, cursor);
    while (this._peek(input, cursor) === "|") {
      this._consume(input, cursor, "||");
      const right = this._parseAnd(input, cursor);
      left = left || right;
    }
    return left;
  }

  private _parseAnd(input: string, cursor: { pos: number }): boolean {
    let left = this._parseUnary(input, cursor);
    while (this._peek(input, cursor) === "&") {
      this._consume(input, cursor, "&&");
      const right = this._parseUnary(input, cursor);
      left = left && right;
    }
    return left;
  }

  private _parseUnary(input: string, cursor: { pos: number }): boolean {
    this._skipWhitespace(input, cursor);
    if (input[cursor.pos] === "!") {
      cursor.pos++; // consume '!'
      return !this._parseUnary(input, cursor);
    }
    return this._parsePrimary(input, cursor);
  }

  private _parsePrimary(input: string, cursor: { pos: number }): boolean {
    this._skipWhitespace(input, cursor);

    // Grouped expression
    if (input[cursor.pos] === "(") {
      cursor.pos++; // consume '('
      const result = this._parseOr(input, cursor);
      this._skipWhitespace(input, cursor);
      if (input[cursor.pos] === ")") cursor.pos++; // consume ')'
      return result;
    }

    // Key identifier (letters, digits, underscore, dot, dash)
    const keyMatch = /^[\w.-]+/.exec(input.slice(cursor.pos));
    if (!keyMatch) throw new Error(`Unexpected token at position ${cursor.pos}`);

    const keyName = keyMatch[0];
    cursor.pos += keyName.length;

    this._skipWhitespace(input, cursor);

    // Equality / inequality check
    const eqMatch = /^(==|!=)/.exec(input.slice(cursor.pos));
    if (eqMatch) {
      const operator = eqMatch[0];
      cursor.pos += operator.length;
      this._skipWhitespace(input, cursor);

      const value = this._parseValue(input, cursor);
      const contextValue = this.store.get(keyName);

      if (operator === "==") return contextValue === value;
      if (operator === "!=") return contextValue !== value;
    }

    // Simple boolean key lookup — missing keys default to false
    const raw = this.store.get(keyName);
    if (raw === undefined || raw === null || raw === false || raw === 0 || raw === "") return false;
    return true;
  }

  /**
   * Parse a literal value: either a quoted string or a bare word.
   */
  private _parseValue(input: string, cursor: { pos: number }): unknown {
    this._skipWhitespace(input, cursor);
    const ch = input[cursor.pos];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      cursor.pos++; // opening quote
      const start = cursor.pos;
      while (cursor.pos < input.length && input[cursor.pos] !== quote) {
        cursor.pos++;
      }
      const value = input.slice(start, cursor.pos);
      cursor.pos++; // closing quote
      return value;
    }

    // Bare word (true / false / number / identifier)
    const wordMatch = /^[\w.-]+/.exec(input.slice(cursor.pos));
    if (!wordMatch) throw new Error(`Expected value at position ${cursor.pos}`);
    cursor.pos += wordMatch[0].length;

    const word = wordMatch[0];
    if (word === "true") return true;
    if (word === "false") return false;
    const num = Number(word);
    if (!isNaN(num)) return num;
    return word;
  }

  private _skipWhitespace(input: string, cursor: { pos: number }): void {
    while (cursor.pos < input.length && /\s/.test(input[cursor.pos])) {
      cursor.pos++;
    }
  }

  private _peek(input: string, cursor: { pos: number }): string {
    this._skipWhitespace(input, cursor);
    return input[cursor.pos] ?? "";
  }

  private _consume(input: string, cursor: { pos: number }, expected: string): void {
    this._skipWhitespace(input, cursor);
    if (!input.startsWith(expected, cursor.pos)) {
      throw new Error(`Expected "${expected}" at position ${cursor.pos}`);
    }
    cursor.pos += expected.length;
  }
}

export const contextKeyService = new ContextKeyServiceClass();
