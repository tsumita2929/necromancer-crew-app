/**
 * A small Python lexer. It only has to be right about what is code and what is not:
 * comments, strings (all prefixes, single and triple quotes) and line structure. Linear time,
 * never throws.
 *
 * Tokens of kind `newline` end a logical line (a newline outside brackets and not escaped).
 * The expressions inside f-strings are lexed too, so `f"{toml.loads(s)}"` counts as a use.
 */

export type PyTokKind = 'ident' | 'punct' | 'string' | 'number' | 'newline';

export interface PyTok {
  kind: PyTokKind;
  value: string;
  line: number;
  col: number;
}

const OPERATORS = [
  '**=',
  '//=',
  '>>=',
  '<<=',
  '...',
  '->',
  ':=',
  '==',
  '!=',
  '<=',
  '>=',
  '**',
  '//',
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
  '@=',
];
const ID_START = /[\p{ID_Start}_]/u;
const ID_PART = /[\p{ID_Continue}]/u;
const STRING_PREFIX = /^(?:[rRuUbBfF]|[rR][bBfF]|[bBfF][rR])$/;
const MAX_FSTRING_DEPTH = 4;

export function lexPy(text: string, depth = 0, baseLine = 1): PyTok[] {
  const toks: PyTok[] = [];
  const n = text.length;
  let i = 0;
  let line = baseLine;
  let lineStart = 0;
  let brackets = 0;

  const push = (
    kind: PyTokKind,
    value: string,
    at: number,
    atLine: number,
    atLineStart: number,
  ) => {
    toks.push({ kind, value, line: atLine, col: at - atLineStart + 1 });
  };

  const readString = (quoteAt: number, prefix: string, tokStart: number): void => {
    const startLine = line;
    const startLineStart = lineStart;
    const q = text.charAt(quoteAt);
    const triple = text.charAt(quoteAt + 1) === q && text.charAt(quoteAt + 2) === q;
    const raw = /r/i.test(prefix);
    const isF = /f/i.test(prefix);
    let j = quoteAt + (triple ? 3 : 1);
    const bodyStart = j;
    let closed = false;
    while (j < n) {
      const c = text.charAt(j);
      if (c === '\\' && !raw) {
        if (text.charAt(j + 1) === '\n') {
          line++;
          lineStart = j + 2;
        }
        j += 2;
        continue;
      }
      if (c === '\\' && raw) {
        j += 2;
        continue;
      }
      if (c === '\n') {
        if (!triple) break; // unclosed: end at the line end
        line++;
        lineStart = j + 1;
      }
      if (c === q && (!triple || (text.charAt(j + 1) === q && text.charAt(j + 2) === q))) {
        closed = true;
        break;
      }
      j++;
    }
    const body = text.slice(bodyStart, j);
    push('string', body, tokStart, startLine, startLineStart);
    if (isF && depth < MAX_FSTRING_DEPTH) {
      // Lex the replacement fields so that uses inside them are seen.
      let k = 0;
      while (k < body.length) {
        const c = body.charAt(k);
        if (c === '{' && body.charAt(k + 1) === '{') {
          k += 2;
          continue;
        }
        if (c === '{') {
          let d = 1;
          let m = k + 1;
          while (m < body.length && d > 0) {
            if (body.charAt(m) === '{') d++;
            else if (body.charAt(m) === '}') d--;
            m++;
          }
          const expr = body.slice(k + 1, m - 1).replace(/[!:](?!=).*$/s, '');
          for (const t of lexPy(expr, depth + 1, startLine)) {
            if (t.kind !== 'newline') toks.push({ ...t, line: startLine, col: 0 });
          }
          k = m;
          continue;
        }
        k++;
      }
    }
    i = closed ? j + (triple ? 3 : 1) : j;
  };

  while (i < n) {
    const c = text.charAt(i);
    if (c === '\n') {
      if (brackets === 0) push('newline', '\n', i, line, lineStart);
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\ufeff') {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < n && text.charAt(i) !== '\n') i++;
      continue;
    }
    if (
      c === '\\' &&
      (text.charAt(i + 1) === '\n' || (text.charAt(i + 1) === '\r' && text.charAt(i + 2) === '\n'))
    ) {
      i += text.charAt(i + 1) === '\r' ? 3 : 2;
      line++;
      lineStart = i;
      continue;
    }
    const start = i;
    const startLine = line;
    const startLineStart = lineStart;
    if (c === '"' || c === "'") {
      readString(i, '', start);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text.charAt(i + 1)))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(text.charAt(j))) {
        if (text.charAt(j) === '.' && !/[0-9]/.test(text.charAt(j + 1))) break;
        j++;
      }
      push('number', text.slice(i, j), start, startLine, startLineStart);
      i = j;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(text.charAt(j))) j++;
      const word = text.slice(i, j);
      const q = text.charAt(j);
      if ((q === '"' || q === "'") && STRING_PREFIX.test(word)) {
        readString(j, word, start);
        continue;
      }
      push('ident', word, start, startLine, startLineStart);
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
    if (op === '(' || op === '[' || op === '{') brackets++;
    else if ((op === ')' || op === ']' || op === '}') && brackets > 0) brackets--;
    push('punct', op, start, startLine, startLineStart);
    i += op.length;
  }
  if (depth === 0) push('newline', '\n', n, line, lineStart);
  return toks;
}
