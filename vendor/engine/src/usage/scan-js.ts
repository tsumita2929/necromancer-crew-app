/**
 * Usage scan for JavaScript and TypeScript. Reads tokens from `lex-js.ts`, finds the imports
 * of one package, and records every place the imported names are used.
 *
 * Not modelled (documented gaps): shadowing of an imported name by a local variable of the same
 * name, `eval`, computed member names, and use through re-binding (`const f = ns.pad; f()` is
 * seen as an access of `pad`, not as a call).
 */

import type { ImportForm, LiteralArg, UsageImport, UsageSite } from '../types.js';
import { type JsTok, lexJs } from './lex-js.js';

export interface RawUse {
  member: string;
  site: UsageSite;
}

export interface JsFileResult {
  imports: UsageImport[];
  uses: RawUse[];
  unresolvedDynamic: number;
}

/** Package name from a specifier, or null when the specifier is not this package. */
export function matchPackage(specifier: string, name: string): { subpath?: string } | null {
  if (specifier === name) return {};
  if (specifier.startsWith(`${name}/`)) {
    const subpath = specifier.slice(name.length + 1);
    return subpath === '' ? {} : { subpath };
  }
  return null;
}

interface Binding {
  local: string;
  /** Member imported; undefined means the module itself (default, namespace, require result). */
  member: string | undefined;
  /** `import * as ns`: a bare reference means the whole namespace. */
  namespace: boolean;
  subpath: string | undefined;
}

interface Pattern {
  entries: Array<{ member: string; local: string | undefined }>;
  hasRest: boolean;
  /** Index of the token after the closing brace. */
  end: number;
}

const MAX_ARG_TOKENS = 2000;
const CLIP = 60;

const isP = (t: JsTok | undefined, v: string): boolean =>
  t !== undefined && t.kind === 'punct' && t.value === v;
const isW = (t: JsTok | undefined, v: string): boolean =>
  t !== undefined && t.kind === 'ident' && t.value === v;

function memberKey(subpath: string | undefined, name: string): string {
  return subpath ? `${subpath}#${name}` : name;
}

/** Parse `{ a, b as c, type d, default as e }` (import/export lists) starting at the `{`. */
function parseNamedList(
  toks: JsTok[],
  open: number,
): { entries: Array<{ member: string; local: string; typeOnly: boolean }>; end: number } | null {
  const entries: Array<{ member: string; local: string; typeOnly: boolean }> = [];
  let i = open + 1;
  while (i < toks.length) {
    const t = toks[i];
    if (isP(t, '}')) return { entries, end: i + 1 };
    if (isP(t, ',')) {
      i++;
      continue;
    }
    let typeOnly = false;
    let cur = toks[i];
    if (
      isW(cur, 'type') &&
      toks[i + 1] &&
      (toks[i + 1]?.kind === 'ident' || toks[i + 1]?.kind === 'string') &&
      !isW(toks[i + 1], 'as')
    ) {
      typeOnly = true;
      i++;
      cur = toks[i];
    }
    if (!cur || (cur.kind !== 'ident' && cur.kind !== 'string')) return null;
    const member = cur.value;
    let local = member;
    i++;
    if (isW(toks[i], 'as') && toks[i + 1]?.kind === 'ident') {
      local = toks[i + 1]?.value ?? member;
      i += 2;
    }
    entries.push({ member, local, typeOnly });
  }
  return null;
}

/** Parse a destructuring pattern `{ a, b: c, d = 1, ...rest }` starting at the `{`. */
function parsePattern(toks: JsTok[], open: number): Pattern | null {
  const entries: Pattern['entries'] = [];
  let hasRest = false;
  let i = open + 1;
  while (i < toks.length) {
    const t = toks[i];
    if (isP(t, '}')) return { entries, hasRest, end: i + 1 };
    if (isP(t, ',')) {
      i++;
      continue;
    }
    if (isP(t, '...')) {
      hasRest = true;
      i += 2;
      continue;
    }
    if (!t || (t.kind !== 'ident' && t.kind !== 'string')) return null;
    const member = t.value;
    i++;
    let local: string | undefined = member;
    if (isP(toks[i], ':')) {
      i++;
      const target = toks[i];
      if (target?.kind === 'ident') {
        local = target.value;
        i++;
      } else {
        local = undefined; // nested pattern: skip it
        let depth = 0;
        while (i < toks.length) {
          const u = toks[i];
          if (isP(u, '{') || isP(u, '[') || isP(u, '(')) depth++;
          else if (isP(u, '}') || isP(u, ']') || isP(u, ')')) {
            if (depth === 0) break;
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          i++;
        }
      }
    }
    if (isP(toks[i], '=')) {
      // default value: skip to the next top-level comma or the closing brace
      let depth = 0;
      i++;
      while (i < toks.length) {
        const u = toks[i];
        if (isP(u, '{') || isP(u, '[') || isP(u, '(')) depth++;
        else if (isP(u, '}') || isP(u, ']') || isP(u, ')')) {
          if (depth === 0) break;
          depth--;
        } else if (isP(u, ',') && depth === 0) break;
        i++;
      }
    }
    entries.push({ member, local });
  }
  return null;
}

/** Index of the `{` that matches the `}` at `close`, searching backwards. */
function matchingOpenBrace(toks: JsTok[], close: number): number {
  let depth = 0;
  for (let i = close; i >= 0 && close - i < 5000; i--) {
    const t = toks[i];
    if (isP(t, '}')) depth++;
    else if (isP(t, '{')) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function literalOf(toks: JsTok[], a: number, b: number): LiteralArg {
  const len = b - a;
  const first = toks[a];
  if (!first) return { kind: 'other' };
  if (len === 1) {
    if (first.kind === 'string') return { kind: 'string', text: first.value.slice(0, CLIP) };
    if (first.kind === 'number') return { kind: 'number', text: first.value.slice(0, CLIP) };
    if (first.kind === 'ident') {
      if (first.value === 'true' || first.value === 'false')
        return { kind: 'boolean', text: first.value };
      if (first.value === 'null') return { kind: 'null', text: 'null' };
      if (first.value === 'undefined') return { kind: 'undefined', text: 'undefined' };
    }
    if (first.kind === 'template') return { kind: 'string', text: first.value.slice(0, CLIP) };
  }
  if (len === 2 && (isP(first, '-') || isP(first, '+')) && toks[a + 1]?.kind === 'number') {
    return { kind: 'number', text: `${first.value}${toks[a + 1]?.value ?? ''}`.slice(0, CLIP) };
  }
  return { kind: 'other' };
}

interface Call {
  args: number;
  spread: boolean;
  literals: LiteralArg[];
}

/** Read the arguments of the call whose `(` is at `open`. Bounded, so nested calls stay linear. */
function readCall(toks: JsTok[], open: number): Call {
  const literals: LiteralArg[] = [];
  let spread = false;
  let depth = 0;
  let argStart = open + 1;
  let count = 0;
  const limit = Math.min(toks.length, open + MAX_ARG_TOKENS);
  const closeArg = (end: number) => {
    if (end > argStart) {
      count++;
      if (isP(toks[argStart], '...')) spread = true;
      literals.push(literalOf(toks, argStart, end));
    }
  };
  for (let i = open + 1; i < limit; i++) {
    const t = toks[i];
    if (!t) break;
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (depth === 0) {
          if (t.value === ')') {
            closeArg(i);
            return { args: count, spread, literals };
          }
          break;
        }
        depth--;
      } else if (t.value === ',' && depth === 0) {
        closeArg(i);
        argStart = i + 1;
      }
    }
  }
  // Unclosed or too long: report what was read.
  closeArg(limit);
  return { args: count, spread, literals };
}

const DECLARING = new Set([
  'function',
  'class',
  'const',
  'let',
  'var',
  'import',
  'interface',
  'enum',
  'namespace',
  'type',
  'typeof',
]);

export function scanJs(path: string, text: string, packageName: string): JsFileResult {
  const toks = lexJs(text);
  const imports: UsageImport[] = [];
  const bindings: Binding[] = [];
  const uses: RawUse[] = [];
  const skip = new Set<number>(); // token indexes that are part of a declaration
  let unresolvedDynamic = 0;

  const addImport = (
    token: JsTok,
    specifier: string,
    form: ImportForm,
    pkg: { subpath?: string },
    extra: { local?: string; member?: string; typeOnly?: boolean },
  ) => {
    const entry: UsageImport = {
      file: path,
      line: token.line,
      specifier,
      form,
      typeOnly: extra.typeOnly === true,
    };
    if (extra.local !== undefined) entry.local = extra.local;
    if (extra.member !== undefined) entry.member = extra.member;
    if (pkg.subpath) entry.subpath = pkg.subpath;
    imports.push(entry);
  };

  const addUse = (token: JsTok, member: string, kind: UsageSite['kind'], call?: Call) => {
    const site: UsageSite = { file: path, line: token.line, column: token.col, kind };
    if (call) {
      site.args = call.args;
      if (call.spread) site.spread = true;
      site.literals = call.literals;
    }
    uses.push({ member, site });
  };

  /** Record the use that follows a base expression ending before token `k`. */
  const useAfterBase = (
    anchor: JsTok,
    k: number,
    base: string | undefined,
    binding: Pick<Binding, 'namespace' | 'subpath'>,
  ) => {
    const parts: string[] = [];
    let i = k;
    for (;;) {
      const t = toks[i];
      if (isP(t, '?.') && isP(toks[i + 1], '(')) {
        i++;
        continue;
      }
      if (isP(t, '.') || isP(t, '?.')) {
        const next = toks[i + 1];
        if (next && next.kind === 'ident') {
          parts.push(next.value);
          i += 2;
          continue;
        }
        break;
      }
      if (isP(t, '[') && toks[i + 1]?.kind === 'string' && isP(toks[i + 2], ']')) {
        parts.push(toks[i + 1]?.value ?? '');
        i += 3;
        continue;
      }
      if (isP(t, '!') && (isP(toks[i + 1], '.') || isP(toks[i + 1], '('))) {
        i++; // TypeScript non-null assertion
        continue;
      }
      break;
    }
    const nameParts = base !== undefined ? [base, ...parts] : parts;
    const bare = nameParts.length === 0;
    const name = bare ? (binding.namespace ? '*' : 'default') : nameParts.join('.');
    const member = memberKey(binding.subpath, name);
    if (isP(toks[i], '(')) {
      // A bare namespace called as a function is the module's callable export.
      addUse(
        anchor,
        bare ? memberKey(binding.subpath, 'default') : member,
        'call',
        readCall(toks, i),
      );
    } else {
      addUse(anchor, member, bare ? 'reference' : 'access');
    }
  };

  const bindPattern = (pattern: Pattern, spec: { subpath: string | undefined }) => {
    for (const e of pattern.entries) {
      if (e.local)
        bindings.push({
          local: e.local,
          member: e.member,
          namespace: false,
          subpath: spec.subpath,
        });
    }
  };

  /** What `require(...)` or `import(...)` ending at token `end` (the `)`) is bound to. */
  const bindResult = (
    start: number,
    end: number,
    spec: { subpath: string | undefined },
    anchor: JsTok,
  ): void => {
    let j = start - 1;
    let wrapped = false;
    if (isW(toks[j], 'await') && isP(toks[j - 1], '(') && isP(toks[end + 1], ')')) {
      wrapped = true;
      j -= 1;
    } else if (isW(toks[j], 'await')) {
      j -= 1;
    }
    // `require('x').foo` and `require('x')(…)`: the value is a member or a call result, not the module.
    let chainEnd = wrapped ? end + 2 : end + 1;
    const chain: string[] = [];
    while (
      (isP(toks[chainEnd], '.') || isP(toks[chainEnd], '?.')) &&
      toks[chainEnd + 1]?.kind === 'ident'
    ) {
      chain.push(toks[chainEnd + 1]?.value ?? '');
      chainEnd += 2;
    }
    const calledAfter = isP(toks[chainEnd], '(');
    if (!wrapped && isP(toks[j], '=') && j >= 1 && chain.length > 0 && !calledAfter) {
      const target = toks[j - 1];
      if (target?.kind === 'ident' && !DECLARING.has(target.value)) {
        skip.add(j - 1);
        bindings.push({
          local: target.value,
          member: chain.join('.'),
          namespace: false,
          subpath: spec.subpath,
        });
        addUse(anchor, memberKey(spec.subpath, chain.join('.')), 'access');
        return;
      }
    }
    if (!wrapped && isP(toks[j], '=') && j >= 1 && chain.length === 0 && !calledAfter) {
      let b = j - 1;
      if (isP(toks[b], '}')) {
        const open = matchingOpenBrace(toks, b);
        if (open >= 0) {
          const pattern = parsePattern(toks, open);
          if (pattern) {
            for (let q = open; q <= b; q++) skip.add(q);
            bindPattern(pattern, spec);
          }
        }
        return;
      }
      // Optional type annotation: `const x: T = require(...)`
      if (toks[b]?.kind === 'ident' && isP(toks[b - 1], ':') && toks[b - 2]?.kind === 'ident')
        b -= 2;
      const target = toks[b];
      if (target?.kind === 'ident' && !DECLARING.has(target.value)) {
        skip.add(b);
        bindings.push({
          local: target.value,
          member: undefined,
          namespace: false,
          subpath: spec.subpath,
        });
      }
      return;
    }
    // Used in place: require('x').foo(…), require('x')(…), (await import('x')).foo
    useAfterBase(anchor, wrapped ? end + 2 : end + 1, undefined, {
      namespace: false,
      subpath: spec.subpath,
    });
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t || t.kind !== 'ident') continue;

    if (t.value === 'import' && !isP(toks[i - 1], '.')) {
      const next = toks[i + 1];
      if (isP(next, '(')) {
        const lit = toks[i + 2];
        if (lit?.kind === 'string' && (isP(toks[i + 3], ')') || isP(toks[i + 3], ','))) {
          const pkg = matchPackage(lit.value, packageName);
          if (pkg) {
            addImport(t, lit.value, 'dynamic', pkg, {});
            let close = i + 3;
            if (isP(toks[close], ',')) {
              let depth = 0;
              for (close = i + 3; close < toks.length && close < i + 200; close++) {
                if (isP(toks[close], '(')) depth++;
                else if (isP(toks[close], ')')) {
                  if (depth === 0) break;
                  depth--;
                }
              }
            }
            bindResult(i, close, { subpath: pkg.subpath }, t);
          }
        } else if (!lit || !(lit.kind === 'string')) {
          unresolvedDynamic++;
        }
        continue;
      }
      if (isP(next, '.')) continue; // import.meta
      readStaticImport(i, t);
      continue;
    }

    if (
      t.value === 'export' &&
      (isP(toks[i + 1], '{') || isP(toks[i + 1], '*') || isW(toks[i + 1], 'type'))
    ) {
      readReExport(i, t);
      continue;
    }

    if (t.value === 'require' && !isP(toks[i - 1], '.') && isP(toks[i + 1], '(')) {
      const lit = toks[i + 2];
      if (lit?.kind === 'string' && isP(toks[i + 3], ')')) {
        const pkg = matchPackage(lit.value, packageName);
        if (pkg) {
          // `import x = require('y')` is handled with the import statement.
          if (
            isP(toks[i - 1], '=') &&
            toks[i - 2]?.kind === 'ident' &&
            (isW(toks[i - 3], 'import') || (isW(toks[i - 3], 'type') && isW(toks[i - 4], 'import')))
          ) {
            continue;
          }
          addImport(t, lit.value, 'require', pkg, {});
          bindResult(i, i + 3, { subpath: pkg.subpath }, t);
        }
      }
    }
  }

  function readStaticImport(i: number, start: JsTok): void {
    let j = i + 1;
    let typeOnly = false;
    if (
      isW(toks[j], 'type') &&
      !isW(toks[j + 1], 'from') &&
      toks[j + 1] &&
      !isP(toks[j + 1], ',')
    ) {
      typeOnly = true;
      j++;
    }
    const first = toks[j];
    if (!first) return;
    // import 'x'
    if (first.kind === 'string') {
      const pkg = matchPackage(first.value, packageName);
      if (pkg) addImport(start, first.value, 'side-effect', pkg, {});
      return;
    }
    // import x = require('y')
    if (
      first.kind === 'ident' &&
      isP(toks[j + 1], '=') &&
      isW(toks[j + 2], 'require') &&
      isP(toks[j + 3], '(') &&
      toks[j + 4]?.kind === 'string'
    ) {
      const spec = toks[j + 4]?.value ?? '';
      const pkg = matchPackage(spec, packageName);
      if (pkg) {
        addImport(start, spec, 'import-equals', pkg, { local: first.value, typeOnly });
        if (!typeOnly)
          bindings.push({
            local: first.value,
            member: undefined,
            namespace: false,
            subpath: pkg.subpath,
          });
        skip.add(j);
      }
      return;
    }
    const pending: Array<{
      form: ImportForm;
      local: string;
      member?: string;
      typeOnly: boolean;
      at: number;
    }> = [];
    if (first.kind === 'ident') {
      pending.push({ form: 'default', local: first.value, typeOnly, at: j });
      j++;
      if (isP(toks[j], ',')) j++;
    }
    if (isP(toks[j], '*') && isW(toks[j + 1], 'as') && toks[j + 2]?.kind === 'ident') {
      pending.push({ form: 'namespace', local: toks[j + 2]?.value ?? '', typeOnly, at: j + 2 });
      j += 3;
    } else if (isP(toks[j], '{')) {
      const list = parseNamedList(toks, j);
      if (!list) return;
      for (const e of list.entries) {
        pending.push({
          form: 'named',
          local: e.local,
          member: e.member,
          typeOnly: typeOnly || e.typeOnly,
          at: j,
        });
      }
      j = list.end;
    }
    if (!isW(toks[j], 'from') || toks[j + 1]?.kind !== 'string') return;
    const spec = toks[j + 1]?.value ?? '';
    const pkg = matchPackage(spec, packageName);
    if (!pkg) return;
    for (const p of pending) {
      addImport(start, spec, p.form, pkg, {
        local: p.local,
        ...(p.member !== undefined ? { member: p.member } : {}),
        typeOnly: p.typeOnly,
      });
      if (p.typeOnly) continue;
      if (p.form === 'named') {
        if (p.member === 'default')
          bindings.push({
            local: p.local,
            member: undefined,
            namespace: false,
            subpath: pkg.subpath,
          });
        else
          bindings.push({
            local: p.local,
            member: p.member,
            namespace: false,
            subpath: pkg.subpath,
          });
      } else {
        bindings.push({
          local: p.local,
          member: undefined,
          namespace: p.form === 'namespace',
          subpath: pkg.subpath,
        });
      }
    }
    for (let q = i; q <= j + 1; q++) skip.add(q);
  }

  function readReExport(i: number, start: JsTok): void {
    let j = i + 1;
    let typeOnly = false;
    if (isW(toks[j], 'type')) {
      typeOnly = true;
      j++;
    }
    if (isP(toks[j], '*')) {
      j++;
      let alias: string | undefined;
      if (isW(toks[j], 'as') && toks[j + 1]?.kind === 'ident') {
        alias = toks[j + 1]?.value;
        j += 2;
      }
      if (isW(toks[j], 'from') && toks[j + 1]?.kind === 'string') {
        const spec = toks[j + 1]?.value ?? '';
        const pkg = matchPackage(spec, packageName);
        if (pkg) {
          addImport(start, spec, 're-export-all', pkg, {
            ...(alias ? { local: alias } : {}),
            typeOnly,
          });
          if (!typeOnly) addUse(start, memberKey(pkg.subpath, '*'), 're-export');
        }
      }
      return;
    }
    if (isP(toks[j], '{')) {
      const list = parseNamedList(toks, j);
      if (!list) return;
      j = list.end;
      if (isW(toks[j], 'from') && toks[j + 1]?.kind === 'string') {
        const spec = toks[j + 1]?.value ?? '';
        const pkg = matchPackage(spec, packageName);
        if (pkg) {
          for (const e of list.entries) {
            const ty = typeOnly || e.typeOnly;
            addImport(start, spec, 're-export', pkg, {
              member: e.member,
              local: e.local,
              typeOnly: ty,
            });
            if (!ty) addUse(start, memberKey(pkg.subpath, e.member), 're-export');
          }
        }
        for (let q = i; q <= j + 1; q++) skip.add(q);
      }
    }
  }

  // Uses of the bound names.
  const byLocal = new Map<string, Binding[]>();
  for (const b of bindings) {
    const list = byLocal.get(b.local);
    if (list) list.push(b);
    else byLocal.set(b.local, [b]);
  }
  if (byLocal.size > 0) {
    for (let p = 0; p < toks.length; p++) {
      const t = toks[p];
      if (!t || t.kind !== 'ident' || skip.has(p)) continue;
      const list = byLocal.get(t.value);
      if (!list) continue;
      const prev = toks[p - 1];
      if (isP(prev, '.') || isP(prev, '?.')) continue;
      if (prev && prev.kind === 'ident' && DECLARING.has(prev.value) && prev.value !== 'typeof')
        continue;
      if (isP(toks[p + 1], ':') && (isP(prev, '{') || isP(prev, ','))) continue; // object key
      if (isP(toks[p + 1], '=>')) continue; // a parameter of the same name
      const binding = list[0];
      if (!binding) continue;
      useAfterBase(t, p + 1, binding.member, binding);
    }
  }

  return { imports, uses, unresolvedDynamic };
}
