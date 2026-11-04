/**
 * Usage scan for Python. Reads tokens from `lex-py.ts`, finds the imports of one distribution
 * (by its import names), and records every place the imported names are used.
 */

import type { ImportForm, LiteralArg, UsageImport, UsageSite } from '../types.js';
import { normalizePypiName } from '../util/names.js';
import { lexPy, type PyTok } from './lex-py.js';
import type { RawUse } from './scan-js.js';

/** Distribution names whose import name differs. Keys are PEP 503 normalised. */
export const PY_IMPORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  pycrypto: ['Crypto'],
  pycryptodome: ['Crypto'],
  pycryptodomex: ['Cryptodome'],
  pyyaml: ['yaml'],
  pillow: ['PIL'],
  'scikit-learn': ['sklearn'],
  beautifulsoup4: ['bs4'],
  'python-dateutil': ['dateutil'],
  'opencv-python': ['cv2'],
  'msgpack-python': ['msgpack'],
  'python-jose': ['jose'],
  pyjwt: ['jwt'],
  'python-dotenv': ['dotenv'],
  'python-slugify': ['slugify'],
  attrs: ['attr', 'attrs'],
  pymongo: ['pymongo', 'bson', 'gridfs'],
  protobuf: ['google'],
  setuptools: ['setuptools', 'pkg_resources'],
  distribute: ['setuptools', 'pkg_resources'],
  pyopenssl: ['OpenSSL'],
  pyserial: ['serial'],
  'python-magic': ['magic'],
  'ruamel-yaml': ['ruamel'],
  'google-cloud-storage': ['google'],
};

/** Import names to look for: the caller's, the built-in table, or the distribution name itself. */
export function pythonImportNames(
  name: string,
  given?: readonly string[],
): { names: Set<string>; caseInsensitive: boolean } {
  if (given && given.length > 0) return { names: new Set(given), caseInsensitive: false };
  const norm = normalizePypiName(name);
  const known = PY_IMPORT_NAMES[norm];
  if (known) return { names: new Set(known), caseInsensitive: false };
  return { names: new Set([norm.replace(/-/g, '_')]), caseInsensitive: true };
}

interface PyBinding {
  local: string;
  /** Attribute path from the package root, e.g. ["decoder", "TomlDecodeError"]. */
  base: string[];
}

export interface PyFileResult {
  imports: UsageImport[];
  uses: RawUse[];
}

const CLIP = 60;
const MAX_ARG_TOKENS = 2000;

const isP = (t: PyTok | undefined, v: string): boolean =>
  t !== undefined && t.kind === 'punct' && t.value === v;
const isW = (t: PyTok | undefined, v: string): boolean =>
  t !== undefined && t.kind === 'ident' && t.value === v;

const KEYWORDS = new Set([
  'import',
  'from',
  'as',
  'def',
  'class',
  'lambda',
  'for',
  'in',
  'is',
  'not',
  'and',
  'or',
  'if',
  'else',
  'elif',
  'while',
  'with',
  'try',
  'except',
  'finally',
  'return',
  'yield',
  'raise',
  'pass',
  'global',
  'nonlocal',
  'del',
  'assert',
  'break',
  'continue',
  'await',
  'async',
]);

function literalOf(toks: PyTok[], a: number, b: number): LiteralArg {
  const first = toks[a];
  if (!first) return { kind: 'other' };
  const len = b - a;
  if (len === 1) {
    if (first.kind === 'string') return { kind: 'string', text: first.value.slice(0, CLIP) };
    if (first.kind === 'number') return { kind: 'number', text: first.value.slice(0, CLIP) };
    if (first.kind === 'ident') {
      if (first.value === 'True' || first.value === 'False')
        return { kind: 'boolean', text: first.value };
      if (first.value === 'None') return { kind: 'null', text: 'None' };
    }
  }
  if (len === 2 && (isP(first, '-') || isP(first, '+')) && toks[a + 1]?.kind === 'number') {
    return { kind: 'number', text: `${first.value}${toks[a + 1]?.value ?? ''}`.slice(0, CLIP) };
  }
  return { kind: 'other' };
}

interface PyCall {
  args: number;
  spread: boolean;
  keywords: string[];
  literals: LiteralArg[];
}

function readCall(toks: PyTok[], open: number): PyCall {
  const keywords: string[] = [];
  const literals: LiteralArg[] = [];
  let spread = false;
  let count = 0;
  let depth = 0;
  let argStart = open + 1;
  const limit = Math.min(toks.length, open + MAX_ARG_TOKENS);
  const closeArg = (end: number) => {
    if (end <= argStart) return;
    const first = toks[argStart];
    if (isP(first, '*') || isP(first, '**')) {
      spread = true;
      return;
    }
    if (first?.kind === 'ident' && isP(toks[argStart + 1], '=') && argStart + 1 < end) {
      keywords.push(first.value);
      return;
    }
    count++;
    literals.push(literalOf(toks, argStart, end));
  };
  for (let i = open + 1; i < limit; i++) {
    const t = toks[i];
    if (!t || t.kind === 'newline') break;
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (depth === 0) {
          closeArg(i);
          return { args: count, spread, keywords, literals };
        }
        depth--;
      } else if (t.value === ',' && depth === 0) {
        closeArg(i);
        argStart = i + 1;
      }
    }
  }
  closeArg(limit);
  return { args: count, spread, keywords, literals };
}

export function scanPython(
  path: string,
  text: string,
  importNames: { names: Set<string>; caseInsensitive: boolean },
): PyFileResult {
  const toks = lexPy(text);
  const imports: UsageImport[] = [];
  const bindings: PyBinding[] = [];
  const uses: RawUse[] = [];
  const skip = new Set<number>();

  const isTarget = (root: string): boolean => {
    if (importNames.names.has(root)) return true;
    if (!importNames.caseInsensitive) return false;
    const lower = root.toLowerCase();
    for (const name of importNames.names) if (name.toLowerCase() === lower) return true;
    return false;
  };

  const atStatementStart = (i: number): boolean => {
    const prev = toks[i - 1];
    return prev === undefined || prev.kind === 'newline' || isP(prev, ';') || isP(prev, ':');
  };

  /** Dotted name starting at `i`: returns the parts and the index after it. */
  const readDotted = (i: number): { parts: string[]; end: number } => {
    const parts: string[] = [];
    let j = i;
    while (toks[j]?.kind === 'ident' && !KEYWORDS.has(toks[j]?.value ?? '')) {
      parts.push(toks[j]?.value ?? '');
      j++;
      if (isP(toks[j], '.') && toks[j + 1]?.kind === 'ident') j++;
      else break;
    }
    return { parts, end: j };
  };

  const addImport = (
    token: PyTok,
    specifier: string,
    form: ImportForm,
    extra: { local?: string; member?: string; guarded: boolean },
  ) => {
    const entry: UsageImport = { file: path, line: token.line, specifier, form, typeOnly: false };
    if (extra.local !== undefined) entry.local = extra.local;
    if (extra.member !== undefined) entry.member = extra.member;
    if (extra.guarded) entry.guarded = true;
    imports.push(entry);
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t || t.kind !== 'ident' || !atStatementStart(i)) continue;
    const guarded = t.col > 1 || isP(toks[i - 1], ':');

    if (t.value === 'import') {
      let j = i + 1;
      for (;;) {
        const dotted = readDotted(j);
        if (dotted.parts.length === 0) break;
        j = dotted.end;
        let alias: string | undefined;
        if (isW(toks[j], 'as') && toks[j + 1]?.kind === 'ident') {
          alias = toks[j + 1]?.value;
          j += 2;
        }
        const root = dotted.parts[0] ?? '';
        if (isTarget(root)) {
          const spec = dotted.parts.join('.');
          addImport(t, spec, 'python-import', {
            ...(alias ? { local: alias } : { local: root }),
            guarded,
          });
          if (alias) bindings.push({ local: alias, base: dotted.parts.slice(1) });
          else bindings.push({ local: root, base: [] });
        }
        if (isP(toks[j], ',')) {
          j++;
          continue;
        }
        break;
      }
      for (let q = i; q < j; q++) skip.add(q);
      continue;
    }

    if (t.value === 'from') {
      let j = i + 1;
      // Relative imports are the project's own modules, never the dependency.
      if (toks[j]?.kind === 'punct' && (toks[j]?.value === '.' || toks[j]?.value === '...')) {
        // Skip the whole statement, so `from . import toml` does not bind the name `toml`.
        for (let q = i; q < toks.length && toks[q]?.kind !== 'newline' && !isP(toks[q], ';'); q++)
          skip.add(q);
        continue;
      }
      const dotted = readDotted(j);
      j = dotted.end;
      if (dotted.parts.length === 0 || !isW(toks[j], 'import')) continue;
      const root = dotted.parts[0] ?? '';
      const target = isTarget(root);
      j++;
      const paren = isP(toks[j], '(');
      if (paren) j++;
      const spec = dotted.parts.join('.');
      const prefix = dotted.parts.slice(1);
      if (isP(toks[j], '*')) {
        if (target) addImport(t, spec, 'python-star', { guarded });
        j++;
      } else {
        for (;;) {
          const name = toks[j];
          if (!name || name.kind !== 'ident' || KEYWORDS.has(name.value)) break;
          j++;
          let local = name.value;
          if (isW(toks[j], 'as') && toks[j + 1]?.kind === 'ident') {
            local = toks[j + 1]?.value ?? local;
            j += 2;
          }
          if (target) {
            addImport(t, spec, 'python-from', {
              local,
              member: [...prefix, name.value].join('.'),
              guarded,
            });
            bindings.push({ local, base: [...prefix, name.value] });
          }
          if (isP(toks[j], ',')) {
            j++;
            continue;
          }
          break;
        }
        if (paren && isP(toks[j], ')')) j++;
      }
      for (let q = i; q < j; q++) skip.add(q);
    }
  }

  if (bindings.length > 0) {
    const byLocal = new Map<string, PyBinding>();
    for (const b of bindings) if (!byLocal.has(b.local)) byLocal.set(b.local, b);
    for (let p = 0; p < toks.length; p++) {
      const t = toks[p];
      if (!t || t.kind !== 'ident' || skip.has(p)) continue;
      const binding = byLocal.get(t.value);
      if (!binding) continue;
      const prev = toks[p - 1];
      if (isP(prev, '.')) continue;
      if (
        prev?.kind === 'ident' &&
        (prev.value === 'def' || prev.value === 'class' || prev.value === 'as')
      )
        continue;
      if (isP(toks[p + 1], '=') && (isP(prev, '(') || isP(prev, ','))) continue; // keyword argument name
      const parts = [...binding.base];
      let k = p + 1;
      while (isP(toks[k], '.') && toks[k + 1]?.kind === 'ident') {
        parts.push(toks[k + 1]?.value ?? '');
        k += 2;
      }
      const member = parts.length === 0 ? 'default' : parts.join('.');
      const site: UsageSite = { file: path, line: t.line, column: t.col, kind: 'reference' };
      if (isP(toks[k], '(')) {
        const call = readCall(toks, k);
        site.kind = 'call';
        site.args = call.args;
        if (call.spread) site.spread = true;
        if (call.keywords.length > 0) site.keywords = call.keywords;
        site.literals = call.literals;
      } else if (parts.length > binding.base.length) {
        site.kind = 'access';
      }
      uses.push({ member, site });
    }
  }
  return { imports, uses };
}
