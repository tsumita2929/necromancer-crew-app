/**
 * Helpers that put untrusted text into generated code safely (R2.12).
 *
 * Rule: text from a diagnosis, a usage scan or a manifest reaches generated code only through
 * `jsStr` / `pyStr` (escaped string literals), `jsIdent` / `pyIdent` (identifiers from a safe
 * alphabet), `slug` (file names), or `comment` (one flat line). Nothing else is interpolated.
 */

/** A JavaScript string literal for any text, safe inside source code and inside `//` lines. */
export function jsStr(text: unknown): string {
  const s = toText(text);
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else {
      const high = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const low = ((cp - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${high.toString(16)}\\u${low.toString(16)}`;
    }
  }
  return `${out}"`;
}

/** A Python string literal for any text (ASCII source, escapes for everything else). */
export function pyStr(text: unknown): string {
  const s = toText(text);
  let out = "'";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "'") out += "\\'";
    else if (ch === '\\') out += '\\\\';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\U${cp.toString(16).padStart(8, '0')}`;
  }
  return `${out}'`;
}

function toText(value: unknown): string {
  try {
    return String(value ?? '');
  } catch {
    return '';
  }
}

/** An identifier of letters, digits and underscores that does not start with a digit. */
export function jsIdent(text: unknown, fallback = 'dep'): string {
  const s = toText(text)
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const id = s === '' ? fallback : s;
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

export const pyIdent = jsIdent;

/** A file or folder name part: lower-case letters, digits and hyphens. */
export function slug(text: unknown, fallback = 'dependency'): string {
  const s = toText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return s === '' ? fallback : s;
}

/** One flat line of text for a `//` or `#` comment: no line breaks, no control characters. */
export function comment(text: unknown, max = 120): string {
  const s = toText(text)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Text for a Markdown table cell, in a code span. Unlike `comment`, runs of spaces are kept: the old
 * package's real answer may be several spaces. No line breaks, no control characters, no backtick or
 * pipe that would end the span or the cell.
 */
export function codeCell(text: unknown, max = 140): string {
  const s = toText(text)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\|/g, '/')
    .replace(/`/g, "'");
  const cut = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return `\`${cut === '' ? '-' : cut}\``;
}

/**
 * Text for the inside of a Python docstring: one flat line, and no quote or backslash, so the text
 * cannot close the docstring or start an escape.
 */
export function docText(text: unknown, max = 120): string {
  return comment(text, max).replace(/["\\]/g, "'");
}

/** A number literal for a finite number text, or null. Used for the project's own examples. */
export function numberLiteral(text: unknown): string | null {
  const n = Number(toText(text).replace(/_/g, ''));
  return Number.isFinite(n) ? String(n) : null;
}

/** Count `TODO(necromancer)` markers in generated files. */
export function countTodos(files: ReadonlyArray<{ content: string }>): number {
  let n = 0;
  for (const f of files) n += (f.content.match(/TODO\(necromancer\)/g) ?? []).length;
  return n;
}
