/**
 * PEP 440 versions and specifiers, plus the Poetry forms (^, ~, bare versions).
 * Pure and total: invalid input gives `null`, never an exception.
 */

export interface PepVersion {
  epoch: number;
  release: number[];
  /** [rank, number] with rank a=0, b=1, rc=2; null when absent. */
  pre: [number, number] | null;
  post: number | null;
  dev: number | null;
}

const VERSION =
  /^\s*v?(?:(\d{1,9})!)?(\d{1,9}(?:\.\d{1,9}){0,15})(?:[-_.]?(alpha|beta|preview|pre|rc|a|b|c)[-_.]?(\d{0,9}))?(?:-(\d{1,9})|[-_.]?(post|rev|r)[-_.]?(\d{0,9}))?(?:[-_.]?dev[-_.]?(\d{0,9}))?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?\s*$/i;

const PRE_RANK: Record<string, number> = {
  a: 0,
  alpha: 0,
  b: 1,
  beta: 1,
  c: 2,
  rc: 2,
  pre: 2,
  preview: 2,
};

export function parsePepVersion(text: string): PepVersion | null {
  const m = VERSION.exec(text);
  if (!m) return null;
  const preName = m[3]?.toLowerCase();
  let post: number | null = null;
  if (m[5] !== undefined) post = Number(m[5]);
  else if (m[6] !== undefined) post = m[7] ? Number(m[7]) : 0;
  return {
    epoch: m[1] ? Number(m[1]) : 0,
    release: (m[2] ?? '0').split('.').map(Number),
    pre: preName !== undefined ? [PRE_RANK[preName] ?? 0, m[4] ? Number(m[4]) : 0] : null,
    post,
    dev: m[8] !== undefined ? (m[8] ? Number(m[8]) : 0) : null,
  };
}

export function isStablePep(version: PepVersion): boolean {
  return version.pre === null && version.dev === null;
}

function cmpNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpRelease(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const c = cmpNumber(a[i] ?? 0, b[i] ?? 0);
    if (c !== 0) return c;
  }
  return 0;
}

export function comparePep(a: PepVersion, b: PepVersion): number {
  if (a.epoch !== b.epoch) return cmpNumber(a.epoch, b.epoch);
  const r = cmpRelease(a.release, b.release);
  if (r !== 0) return r;
  // Ordering of the tail follows the packaging library: dev-only releases sort before
  // pre-releases, a missing pre-release sorts after any pre-release, a missing post and
  // dev behave as -infinity and +infinity.
  const preKey = (v: PepVersion): [number, number] =>
    v.pre ?? (v.post === null && v.dev !== null ? [-1, 0] : [Infinity, 0]);
  const pa = preKey(a);
  const pb = preKey(b);
  if (pa[0] !== pb[0]) return cmpNumber(pa[0], pb[0]);
  if (pa[1] !== pb[1]) return cmpNumber(pa[1], pb[1]);
  const postA = a.post ?? -1;
  const postB = b.post ?? -1;
  if (postA !== postB) return cmpNumber(postA, postB);
  const devA = a.dev ?? Infinity;
  const devB = b.dev ?? Infinity;
  return cmpNumber(devA, devB);
}

type SpecOp = '==' | '!=' | '>=' | '<=' | '>' | '<' | '===';
interface Clause {
  op: SpecOp;
  version: PepVersion;
  /** For "==1.2.*": match on the given release prefix. */
  prefix?: number[];
  text: string;
}

/** Release prefix of a wildcard version like "1.2.*" (null if it is not one). */
function wildcardPrefix(text: string): { epoch: number; prefix: number[] } | null {
  const m = /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)\.\*\s*$/.exec(text);
  return m ? { epoch: m[1] ? Number(m[1]) : 0, prefix: (m[2] ?? '').split('.').map(Number) } : null;
}

function bump(release: number[], index: number): number[] {
  const out = release.slice(0, index + 1);
  out[index] = (out[index] ?? 0) + 1;
  return out;
}

function mk(release: number[], epoch = 0): PepVersion {
  return { epoch, release, pre: null, post: null, dev: null };
}

function clausesFor(raw: string): Clause[] | null {
  const text = raw.trim();
  if (text === '' || text === '*') return [];
  // Poetry caret and tilde
  const poetry = /^(\^|~(?!=))\s*(.+)$/.exec(text);
  if (poetry) {
    const parsed = parsePepVersion(poetry[2] ?? '');
    if (!parsed) return null;
    const rel = parsed.release;
    let upper: number[];
    if (poetry[1] === '^') {
      const firstNonZero = rel.findIndex((n) => n !== 0);
      upper = bump(rel, firstNonZero < 0 ? rel.length - 1 : firstNonZero);
    } else {
      upper = bump(rel, rel.length === 1 ? 0 : 1);
    }
    return [
      { op: '>=', version: parsed, text },
      { op: '<', version: mk(upper), text },
    ];
  }
  const m = /^(===|==|!=|~=|<=|>=|<|>)?\s*(.+)$/.exec(text);
  if (!m) return null;
  const op = m[1] ?? '==';
  const operand = (m[2] ?? '').trim();
  if (op === '~=') {
    const parsed = parsePepVersion(operand);
    if (!parsed || parsed.release.length < 2) return null;
    return [
      { op: '>=', version: parsed, text },
      {
        op: '==',
        version: mk(parsed.release.slice(0, -1), parsed.epoch),
        prefix: parsed.release.slice(0, -1),
        text,
      },
    ];
  }
  if (op === '==' || op === '!=') {
    const wild = wildcardPrefix(operand);
    if (wild) return [{ op, version: mk(wild.prefix, wild.epoch), prefix: wild.prefix, text }];
  }
  const parsed = parsePepVersion(operand);
  if (!parsed) return null;
  return [{ op: op as SpecOp, version: parsed, text }];
}

const OPERATOR = '(?:===|==|!=|~=|<=|>=|<|>|\\^|~)';

/** Poetry writes ">=1.2 <2"; PEP 440 writes ">=1.2,<2". Accept both. */
function normalizeAlternative(text: string): string {
  return text
    .trim()
    .replace(new RegExp(`(${OPERATOR})\\s+`, 'g'), '$1')
    .replace(new RegExp(`\\s+(?=${OPERATOR})`, 'g'), ',');
}

/** Parse one alternative: comma (or space) separated clauses. Null when any clause cannot be read. */
export function parseSpecifier(text: string): Clause[] | null {
  if (text.length > 1000) return null;
  const out: Clause[] = [];
  for (const part of normalizeAlternative(text).split(',')) {
    const clauses = clausesFor(part);
    if (!clauses) return null;
    out.push(...clauses);
  }
  return out;
}

/** Parse alternatives joined by "||" (Poetry). Null when any alternative cannot be read. */
export function parseSpecifierSet(text: string): Clause[][] | null {
  if (text.length > 1000) return null;
  const sets: Clause[][] = [];
  for (const alt of text.split('||')) {
    const clauses = parseSpecifier(alt);
    if (!clauses) return null;
    sets.push(clauses);
  }
  return sets;
}

function matchesPrefix(version: PepVersion, epoch: number, prefix: number[]): boolean {
  return version.epoch === epoch && prefix.every((n, i) => (version.release[i] ?? 0) === n);
}

function testClause(version: PepVersion, c: Clause): boolean {
  if (c.prefix) {
    const hit = matchesPrefix(version, c.version.epoch, c.prefix);
    return c.op === '!=' ? !hit : hit;
  }
  const cmp = comparePep(version, c.version);
  switch (c.op) {
    case '==':
    case '===':
      return cmp === 0;
    case '!=':
      return cmp !== 0;
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    default:
      return cmp < 0;
  }
}

export function satisfiesPep(version: PepVersion, clauses: Clause[]): boolean {
  return clauses.every((c) => testClause(version, c));
}

/** Highest stable version satisfying the specifier (a pre-release only if none else does). */
export function maxSatisfyingPep(versions: readonly string[], specifier: string): string | null {
  const sets = parseSpecifierSet(specifier);
  if (!sets) return null;
  let best: { text: string; parsed: PepVersion } | null = null;
  let bestPre: { text: string; parsed: PepVersion } | null = null;
  for (const text of versions) {
    const parsed = parsePepVersion(text);
    if (!parsed || !sets.some((clauses) => satisfiesPep(parsed, clauses))) continue;
    const slot = isStablePep(parsed) ? 'stable' : 'pre';
    if (slot === 'stable') {
      if (!best || comparePep(parsed, best.parsed) > 0) best = { text, parsed };
    } else if (!bestPre || comparePep(parsed, bestPre.parsed) > 0) {
      bestPre = { text, parsed };
    }
  }
  return (best ?? bestPre)?.text ?? null;
}
