/**
 * npm semver: parse versions, parse ranges, find the highest version in a range.
 * Pure and total: invalid input gives `null`, never an exception.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers, empty for a stable version. */
  pre: Array<string | number>;
}

const VERSION =
  /^[v=\s]*(\d{1,15})\.(\d{1,15})\.(\d{1,15})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

export function parseVersion(text: string): SemVer | null {
  const m = VERSION.exec(text);
  if (!m) return null;
  const pre = m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

export function isStable(version: SemVer): boolean {
  return version.pre.length === 0;
}

function compareIdentifiers(a: string | number, b: string | number): number {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return a < b ? -1 : a > b ? 1 : 0;
  if (aNum) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1; // a stable version is above its pre-releases
  if (b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const c = compareIdentifiers(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

type Op = '<' | '<=' | '>' | '>=' | '=';
interface Comparator {
  op: Op;
  version: SemVer;
}
/** A range is a union ("||") of comparator sets; a version must satisfy every comparator of one set. */
export type Range = Comparator[][];

const ZERO: SemVer = { major: 0, minor: 0, patch: 0, pre: [] };

function v(major: number, minor: number, patch: number, pre: Array<string | number> = []): SemVer {
  return { major, minor, patch, pre };
}

interface Partial3 {
  major?: number;
  minor?: number;
  patch?: number;
  pre: Array<string | number>;
}

const PARTIAL =
  /^[v=\s]*(x|X|\*|\d{1,15})(?:\.(x|X|\*|\d{1,15})(?:\.(x|X|\*|\d{1,15})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?)?)?$/;

function parsePartial(text: string): Partial3 | null {
  const m = PARTIAL.exec(text.trim());
  if (!m) return null;
  const part = (s: string | undefined): number | undefined =>
    s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s);
  const major = part(m[1]);
  const minor = major === undefined ? undefined : part(m[2]);
  const patch = minor === undefined ? undefined : part(m[3]);
  const pre =
    patch !== undefined && m[4]
      ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
      : [];
  return { major, minor, patch, pre };
}

const ANY: Comparator[] = [{ op: '>=', version: ZERO }];

function lowerOf(p: Partial3): SemVer {
  return v(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p.pre);
}

/** Exclusive upper bound of a partial: 1 -> 2.0.0, 1.2 -> 1.3.0, 1.2.3 -> none. */
function upperOf(p: Partial3): SemVer | null {
  if (p.major === undefined) return null;
  if (p.minor === undefined) return v(p.major + 1, 0, 0);
  if (p.patch === undefined) return v(p.major, p.minor + 1, 0);
  return null;
}

function between(low: SemVer, high: SemVer | null): Comparator[] {
  const set: Comparator[] = [{ op: '>=', version: low }];
  if (high) set.push({ op: '<', version: high });
  return set;
}

function caret(p: Partial3): Comparator[] {
  if (p.major === undefined) return ANY;
  const low = lowerOf(p);
  if (p.major > 0 || p.minor === undefined) return between(low, v(p.major + 1, 0, 0));
  if (p.minor > 0 || p.patch === undefined) return between(low, v(0, p.minor + 1, 0));
  return between(low, v(0, 0, (p.patch ?? 0) + 1));
}

function tilde(p: Partial3): Comparator[] {
  if (p.major === undefined) return ANY;
  const low = lowerOf(p);
  if (p.minor === undefined) return between(low, v(p.major + 1, 0, 0));
  return between(low, v(p.major, p.minor + 1, 0));
}

function parseComparator(token: string): Comparator[] | null {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? '';
  const partial = parsePartial(m[2] ?? '');
  if (!partial) return null;
  switch (op) {
    case '^':
      return caret(partial);
    case '~':
    case '~>':
      return tilde(partial);
    case '>': {
      if (partial.major === undefined) return [{ op: '<', version: ZERO }]; // nothing is above "*"
      const up = upperOf(partial);
      return up ? [{ op: '>=', version: up }] : [{ op: '>', version: lowerOf(partial) }];
    }
    case '>=':
      return [{ op: '>=', version: lowerOf(partial) }];
    case '<':
      return [{ op: '<', version: lowerOf(partial) }];
    case '<=': {
      const up = upperOf(partial);
      if (partial.major === undefined) return ANY;
      return up ? [{ op: '<', version: up }] : [{ op: '<=', version: lowerOf(partial) }];
    }
    default: {
      // "" or "=": an exact version, or an x-range
      if (partial.major === undefined) return ANY;
      const up = upperOf(partial);
      return up ? between(lowerOf(partial), up) : [{ op: '=', version: lowerOf(partial) }];
    }
  }
}

function parseSet(text: string): Comparator[] | null {
  let source = text.trim();
  if (source === '' || source === 'latest') return ANY;
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(source);
  if (hyphen) {
    const from = parsePartial(hyphen[1] ?? '');
    const to = parsePartial(hyphen[2] ?? '');
    if (!from || !to) return null;
    const set: Comparator[] = [{ op: '>=', version: lowerOf(from) }];
    const up = upperOf(to);
    if (to.major !== undefined) {
      set.push(up ? { op: '<', version: up } : { op: '<=', version: lowerOf(to) });
    }
    return set;
  }
  // "^ 1.2.3" and ">= 1.0.0" are written with a space after the operator.
  source = source.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1');
  const out: Comparator[] = [];
  for (const token of source.split(/\s+/)) {
    const comparators = parseComparator(token);
    if (!comparators) return null;
    out.push(...comparators);
  }
  return out;
}

/** Parse an npm range. Returns null when any part cannot be read. */
export function parseRange(text: string): Range | null {
  if (text.length > 1000) return null;
  const sets: Comparator[][] = [];
  for (const part of text.split('||')) {
    const set = parseSet(part);
    if (!set) return null;
    sets.push(set);
  }
  return sets;
}

function testComparator(version: SemVer, c: Comparator): boolean {
  const cmp = compareVersions(version, c.version);
  switch (c.op) {
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    default:
      return cmp === 0;
  }
}

/** npm rule: a pre-release only satisfies a set that names a pre-release of the same x.y.z. */
export function satisfies(version: SemVer, range: Range): boolean {
  return range.some((set) => {
    if (!set.every((c) => testComparator(version, c))) return false;
    if (version.pre.length === 0) return true;
    return set.some(
      (c) =>
        c.version.pre.length > 0 &&
        c.version.major === version.major &&
        c.version.minor === version.minor &&
        c.version.patch === version.patch,
    );
  });
}

/** Highest version (as written in `versions`) that satisfies `rangeText`, or null. */
export function maxSatisfying(versions: readonly string[], rangeText: string): string | null {
  const range = parseRange(rangeText);
  if (!range) return null;
  let best: { text: string; parsed: SemVer } | null = null;
  for (const text of versions) {
    const parsed = parseVersion(text);
    if (!parsed || !satisfies(parsed, range)) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { text, parsed };
  }
  return best ? best.text : null;
}
