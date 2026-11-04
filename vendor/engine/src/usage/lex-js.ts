/**
 * A small JavaScript / TypeScript lexer. It is not a parser: it only has to be right about
 * what is code and what is not (comments, strings, template text, regular expressions), so that
 * the recogniser never reads an import out of a comment or a string.
 *
 * Linear time, never throws. An unclosed string ends at the end of its line, so one stray
 * apostrophe in JSX text damages one line and not the rest of the file.
 */

export type JsTokKind = 'ident' | 'punct' | 'string' | 'template' | 'number' | 'regex';

export interface JsTok {
  kind: JsTokKind;
  /** Identifier or punctuation text; decoded content for strings; raw text for the rest. */
  value: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
}

/** Longest operators first, so `===` is not read as `==` and `=`. */
const OPERATORS = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '?.',
  '??',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '++',
  '--',
  '**',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
];

/** After these words a `/` starts a regular expression, not a division. */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'void',
  'delete',
  'throw',
  'yield',
  'await',
  'of',
]);

const ID_START = /[\p{ID_Start}$_#]/u;
const ID_PART = /[\p{ID_Continue}$\u200c\u200d]/u;

export function lexJs(text: string): JsTok[] {
  const toks: JsTok[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  /** Stack of open `{` kinds: true for a `${` inside a template. */
  const braces: boolean[] = [];

  const push = (
    kind: JsTokKind,
    value: string,
    at: number,
    atLine: number,
    atLineStart: number,
  ) => {
    toks.push({ kind, value, line: atLine, col: at - atLineStart + 1 });
  };
  const newline = (at: number) => {
    line++;
    lineStart = at + 1;
  };

  /** Read template text from `i` (just after a backtick or a closing `}`) to `${` or the closing backtick. */
  const readTemplatePiece = () => {
    const start = i;
    const startLine = line;
    const startLineStart = lineStart;
    let raw = '';
    while (i < n) {
      const c = text.charAt(i);
      if (c === '\\') {
        raw += text.slice(i, i + 2);
        if (text.charAt(i + 1) === '\n') newline(i + 1);
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        push('template', raw, start, startLine, startLineStart);
        return;
      }
      if (c === '$' && text.charAt(i + 1) === '{') {
        i += 2;
        braces.push(true);
        push('template', raw, start, startLine, startLineStart);
        return;
      }
      if (c === '\n') newline(i);
      raw += c;
      i++;
    }
    push('template', raw, start, startLine, startLineStart);
  };

  if (text.startsWith('#!')) {
    while (i < n && text.charAt(i) !== '\n') i++;
  }

  while (i < n) {
    const c = text.charAt(i);
    if (c === '\n') {
      newline(i);
      i++;
      continue;
    }
    if (
      c === ' ' ||
      c === '\t' ||
      c === '\r' ||
      c === '\f' ||
      c === '\v' ||
      c === '\ufeff' ||
      c === '\u00a0'
    ) {
      i++;
      continue;
    }
    if (c === '/' && text.charAt(i + 1) === '/') {
      while (i < n && text.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && text.charAt(i + 1) === '*') {
      i += 2;
      while (i < n && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) {
        if (text.charAt(i) === '\n') newline(i);
        i++;
      }
      i += 2;
      continue;
    }
    const startLine = line;
    const startLineStart = lineStart;
    const start = i;
    if (c === '"' || c === "'") {
      i++;
      let value = '';
      while (i < n) {
        const d = text.charAt(i);
        if (d === c) {
          i++;
          break;
        }
        if (d === '\n') break; // unclosed: stop at the end of the line
        if (d === '\\') {
          const e = text.charAt(i + 1);
          if (e === '\n') {
            newline(i + 1);
          } else if (e === 'n') value += '\n';
          else if (e === 't') value += '\t';
          else if (e === 'r') value += '\r';
          else value += e;
          i += 2;
          continue;
        }
        value += d;
        i++;
      }
      push('string', value, start, startLine, startLineStart);
      continue;
    }
    if (c === '`') {
      i++;
      readTemplatePiece();
      continue;
    }
    if (c === '}' && braces.length > 0 && braces[braces.length - 1] === true) {
      braces.pop();
      i++;
      readTemplatePiece();
      continue;
    }
    if (c === '/') {
      const prev = toks[toks.length - 1];
      const regexAllowed =
        prev === undefined ||
        (prev.kind === 'punct' && prev.value !== ')' && prev.value !== ']' && prev.value !== '}') ||
        (prev.kind === 'ident' && REGEX_AFTER_WORD.has(prev.value)) ||
        prev.kind === 'template';
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n) {
          const d = text.charAt(j);
          if (d === '\n') break;
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) {
            closed = true;
            break;
          }
          j++;
        }
        if (closed) {
          j++;
          while (j < n && /[a-z]/i.test(text.charAt(j))) j++;
          push('regex', text.slice(i, j), start, startLine, startLineStart);
          i = j;
          continue;
        }
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text.charAt(i + 1)))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(text.charAt(j))) {
        // `1..toString` and `1.e3`: keep it simple, a dot followed by a non-digit ends the number
        if (text.charAt(j) === '.' && !/[0-9]/.test(text.charAt(j + 1))) break;
        j++;
      }
      push('number', text.slice(i, j), start, startLine, startLineStart);
      i = j;
      continue;
    }
    if (ID_START.test(c) || (c === '\\' && text.charAt(i + 1) === 'u')) {
      let j = i + 1;
      while (j < n && (ID_PART.test(text.charAt(j)) || text.charAt(j) === '\\')) j++;
      push('ident', text.slice(i, j), start, startLine, startLineStart);
      i = j;
      continue;
    }
    // Surrogate pairs (astral identifiers) arrive as two code units; read one code point.
    const cp = text.codePointAt(i) ?? 0;
    if (cp > 0xffff && ID_START.test(String.fromCodePoint(cp))) {
      let j = i + 2;
      while (j < n && ID_PART.test(String.fromCodePoint(text.codePointAt(j) ?? 0))) {
        j += (text.codePointAt(j) ?? 0) > 0xffff ? 2 : 1;
      }
      push('ident', text.slice(i, j), start, startLine, startLineStart);
      i = j;
      continue;
    }
    let op = c;
    for (const candidate of OPERATORS) {
      if (text.startsWith(candidate, i)) {
        op = candidate;
        break;
      }
    }
    if (op === '{') braces.push(false);
    else if (op === '}') braces.pop();
    push('punct', op, start, startLine, startLineStart);
    i += op.length;
  }
  return toks;
}
