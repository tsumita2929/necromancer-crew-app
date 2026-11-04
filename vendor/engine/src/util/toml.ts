/**
 * A small, tolerant TOML reader. It reads what pyproject.toml files use: tables,
 * arrays of tables, dotted keys, all string forms, numbers, booleans, dates (kept as
 * text), arrays and inline tables.
 *
 * It never throws. On a syntax error it returns what it read before the error, with
 * the line of the error, so a damaged file still yields its earlier dependencies.
 * Tables are null-prototype objects, so a key named "__proto__" is just a key.
 */

import type { UnknownRecord } from './guards.js';

export interface TomlResult {
  value: UnknownRecord;
  error?: { line: number; message: string };
}

class TomlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

const MAX_DEPTH = 64;

function table(): UnknownRecord {
  return Object.create(null) as UnknownRecord;
}

function isTable(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseToml(text: string): TomlResult {
  const root = table();
  try {
    new Reader(text, root).run();
    return { value: root };
  } catch (error) {
    if (error instanceof TomlError) {
      return { value: root, error: { line: error.line, message: error.message } };
    }
    // Stack overflow or anything unexpected: report it as a syntax problem.
    return { value: root, error: { line: 0, message: 'The file could not be read as TOML.' } };
  }
}

class Reader {
  private pos = 0;
  private line = 1;

  constructor(
    private readonly src: string,
    private readonly root: UnknownRecord,
  ) {}

  run(): void {
    let current = this.root;
    for (;;) {
      this.skipBlank();
      if (this.eof()) return;
      if (this.peek() === '[') {
        current = this.readHeader();
      } else {
        this.readKeyValue(current, 0);
      }
      this.endOfStatement();
    }
  }

  // --- low level -----------------------------------------------------------

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(offset = 0): string {
    return this.src.charAt(this.pos + offset);
  }

  private fail(message: string): never {
    throw new TomlError(message, this.line);
  }

  private next(): string {
    const ch = this.src.charAt(this.pos++);
    if (ch === '\n') this.line++;
    return ch;
  }

  private skipSpaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
  }

  private skipComment(): void {
    if (this.peek() === '#') {
      while (!this.eof() && this.peek() !== '\n') this.pos++;
    }
  }

  /** Skip whitespace, newlines and comments between statements. */
  private skipBlank(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') this.next();
      else if (ch === '#') this.skipComment();
      else return;
    }
  }

  private endOfStatement(): void {
    this.skipSpaces();
    this.skipComment();
    if (this.eof()) return;
    if (this.peek() === '\r') this.pos++;
    if (this.peek() !== '\n') this.fail('Unexpected text after a value.');
  }

  // --- keys and tables -----------------------------------------------------

  private readKeyPart(): string {
    this.skipSpaces();
    const ch = this.peek();
    if (ch === '"') return this.readBasicString();
    if (ch === "'") return this.readLiteralString();
    const start = this.pos;
    while (/[A-Za-z0-9_-]/.test(this.peek())) this.pos++;
    if (this.pos === start) this.fail('Expected a key.');
    return this.src.slice(start, this.pos);
  }

  private readKeyPath(): string[] {
    const parts = [this.readKeyPart()];
    for (;;) {
      this.skipSpaces();
      if (this.peek() !== '.') return parts;
      this.pos++;
      parts.push(this.readKeyPart());
    }
  }

  /** Walk (and create) a table path. Arrays of tables continue in their last element. */
  private descend(from: UnknownRecord, path: string[]): UnknownRecord {
    let node = from;
    for (const key of path) {
      const existing = node[key];
      if (existing === undefined) {
        const created = table();
        node[key] = created;
        node = created;
      } else if (Array.isArray(existing)) {
        const last: unknown = existing[existing.length - 1];
        if (!isTable(last)) this.fail(`Key "${key}" is not a table.`);
        node = last;
      } else if (isTable(existing)) {
        node = existing;
      } else {
        this.fail(`Key "${key}" is not a table.`);
      }
    }
    return node;
  }

  private readHeader(): UnknownRecord {
    const isArray = this.peek(1) === '[';
    this.pos += isArray ? 2 : 1;
    const path = this.readKeyPath();
    this.skipSpaces();
    if (isArray) {
      if (this.peek() !== ']' || this.peek(1) !== ']')
        this.fail('Unclosed array-of-tables header.');
      this.pos += 2;
      const parent = this.descend(this.root, path.slice(0, -1));
      const last = path[path.length - 1] ?? '';
      const existing = parent[last];
      const item = table();
      if (existing === undefined) parent[last] = [item];
      else if (Array.isArray(existing)) existing.push(item);
      else this.fail(`Key "${last}" is not an array of tables.`);
      return item;
    }
    if (this.peek() !== ']') this.fail('Unclosed table header.');
    this.pos++;
    return this.descend(this.root, path);
  }

  private readKeyValue(into: UnknownRecord, depth: number): void {
    const path = this.readKeyPath();
    this.skipSpaces();
    if (this.peek() !== '=') this.fail('Expected "=" after a key.');
    this.pos++;
    this.skipSpaces();
    const value = this.readValue(depth);
    const holder = this.descend(into, path.slice(0, -1));
    holder[path[path.length - 1] ?? ''] = value;
  }

  // --- values --------------------------------------------------------------

  private readValue(depth: number): unknown {
    if (depth > MAX_DEPTH) this.fail('Values are nested too deeply.');
    const ch = this.peek();
    if (ch === '"') {
      return this.peek(1) === '"' && this.peek(2) === '"'
        ? this.readMultilineBasic()
        : this.readBasicString();
    }
    if (ch === "'") {
      return this.peek(1) === "'" && this.peek(2) === "'"
        ? this.readMultilineLiteral()
        : this.readLiteralString();
    }
    if (ch === '[') return this.readArray(depth);
    if (ch === '{') return this.readInlineTable(depth);
    return this.readScalar();
  }

  private readScalar(): unknown {
    const start = this.pos;
    while (!this.eof() && !/[\s,\]}#]/.test(this.peek())) this.pos++;
    let token = this.src.slice(start, this.pos);
    if (token === '') this.fail('Expected a value.');
    // A date and a time may be separated by one space.
    if (/^\d{4}-\d\d-\d\d$/.test(token) && this.peek() === ' ' && /\d/.test(this.peek(1))) {
      this.pos++;
      const timeStart = this.pos;
      while (!this.eof() && !/[\s,\]}#]/.test(this.peek())) this.pos++;
      token = `${token} ${this.src.slice(timeStart, this.pos)}`;
    }
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^[+-]?(inf|nan)$/.test(token))
      return Number(token.replace('nan', 'NaN').replace('inf', 'Infinity'));
    if (/^[+-]?(0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+)$/i.test(token)) {
      return Number(token.replace(/_/g, '').replace(/^\+/, ''));
    }
    if (/^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?$/.test(token)) {
      return Number(token.replace(/_/g, ''));
    }
    if (/^\d{4}-\d\d-\d\d([Tt ]\d\d:\d\d(:\d\d(\.\d+)?)?([Zz]|[+-]\d\d:\d\d)?)?$/.test(token))
      return token;
    if (/^\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(token)) return token;
    return this.fail(`Unrecognised value "${token.slice(0, 20)}".`);
  }

  private readArray(depth: number): unknown[] {
    this.pos++; // [
    const items: unknown[] = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) this.fail('Unclosed array.');
      if (this.peek() === ']') {
        this.pos++;
        return items;
      }
      items.push(this.readValue(depth + 1));
      this.skipBlank();
      if (this.peek() === ',') this.pos++;
      else if (this.peek() !== ']') this.fail('Expected "," or "]" in an array.');
    }
  }

  private readInlineTable(depth: number): UnknownRecord {
    this.pos++; // {
    const result = table();
    for (;;) {
      this.skipBlank();
      if (this.eof()) this.fail('Unclosed inline table.');
      if (this.peek() === '}') {
        this.pos++;
        return result;
      }
      this.readKeyValue(result, depth + 1);
      this.skipBlank();
      if (this.peek() === ',') this.pos++;
      else if (this.peek() !== '}') this.fail('Expected "," or "}" in an inline table.');
    }
  }

  // --- strings -------------------------------------------------------------

  private readLiteralString(): string {
    this.pos++; // '
    const start = this.pos;
    while (!this.eof() && this.peek() !== "'" && this.peek() !== '\n') this.pos++;
    if (this.peek() !== "'") this.fail('Unclosed string.');
    const out = this.src.slice(start, this.pos);
    this.pos++;
    return out;
  }

  private readMultilineLiteral(): string {
    this.pos += 3;
    if (this.peek() === '\r') this.pos++;
    if (this.peek() === '\n') this.next();
    const end = this.src.indexOf("'''", this.pos);
    if (end < 0) this.fail('Unclosed multi-line string.');
    const out = this.src.slice(this.pos, end);
    for (const ch of out) if (ch === '\n') this.line++;
    this.pos = end + 3;
    // Up to two extra quotes may close the string.
    let extra = 0;
    let tail = '';
    while (extra < 2 && this.peek() === "'") {
      tail += "'";
      this.pos++;
      extra++;
    }
    return out + tail;
  }

  private readBasicString(): string {
    this.pos++; // "
    let out = '';
    for (;;) {
      if (this.eof() || this.peek() === '\n') this.fail('Unclosed string.');
      const ch = this.next();
      if (ch === '"') return out;
      out += ch === '\\' ? this.readEscape() : ch;
    }
  }

  private readMultilineBasic(): string {
    this.pos += 3;
    if (this.peek() === '\r') this.pos++;
    if (this.peek() === '\n') this.next();
    let out = '';
    for (;;) {
      if (this.eof()) this.fail('Unclosed multi-line string.');
      if (this.peek() === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
        this.pos += 3;
        let extra = 0;
        while (extra < 2 && this.peek() === '"') {
          out += '"';
          this.pos++;
          extra++;
        }
        return out;
      }
      const ch = this.next();
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      // A backslash at the end of a line trims the line break and following space.
      if (/[ \t\r\n]/.test(this.peek())) {
        let probe = this.pos;
        while (/[ \t\r]/.test(this.src.charAt(probe))) probe++;
        if (this.src.charAt(probe) === '\n') {
          this.pos = probe;
          while (/[ \t\r\n]/.test(this.peek())) this.next();
          continue;
        }
      }
      out += this.readEscape();
    }
  }

  private readEscape(): string {
    const ch = this.next();
    switch (ch) {
      case 'b':
        return '\b';
      case 't':
        return '\t';
      case 'n':
        return '\n';
      case 'f':
        return '\f';
      case 'r':
        return '\r';
      case 'e':
        return '\u001b';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case 'u':
        return this.readCodePoint(4);
      case 'U':
        return this.readCodePoint(8);
      default:
        return this.fail('Invalid escape in a string.');
    }
  }

  private readCodePoint(length: number): string {
    const hex = this.src.slice(this.pos, this.pos + length);
    if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) this.fail('Invalid unicode escape.');
    this.pos += length;
    const code = parseInt(hex, 16);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) this.fail('Invalid unicode escape.');
    return String.fromCodePoint(code);
  }
}
