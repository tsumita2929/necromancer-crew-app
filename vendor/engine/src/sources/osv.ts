import type { Http } from '../net/http.js';
import { asArray, asString, isRecord } from '../util/guards.js';
import type { Ecosystem } from '../types.js';

export interface OsvQuery {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export const osvKey = (q: OsvQuery): string => `${q.ecosystem}:${q.name}@${q.version}`;

const BATCH = 1000;
/** Full records are read for a package version only when the batch lists two or more records for it. */
const EXPAND_POOL = 4;
const MAX_PAGES = 5;

/** One OSV record, reduced to what merging needs. */
export interface OsvRecord {
  id: string;
  aliases: string[];
  withdrawn: boolean;
}

/** One vulnerability: the records that name each other, merged. */
export interface Vulnerability {
  /** The id to show: GHSA first, then CVE, then the others, each in sorted order. */
  id: string;
  /** Every other id of the same vulnerability, sorted. */
  aliases: string[];
}

export interface OsvOutcome {
  /** Representative ids of the distinct vulnerabilities, sorted. */
  advisories: Map<string, string[]>;
  /** For each query with advisories: representative id to the other ids of that vulnerability. */
  aliases: Map<string, Record<string, string[]>>;
  /** Set when some batch failed; those queries have no entry in `advisories`. */
  failure?: string;
  /** Queries whose answer is missing because of the failure. */
  missing: Set<string>;
  /** Queries whose ids are counted as OSV listed them, because the full records could not be read. */
  unmerged: Set<string>;
}

const PREFERENCE = ['GHSA-', 'CVE-'];

function rank(id: string): number {
  const i = PREFERENCE.findIndex((p) => id.startsWith(p));
  return i < 0 ? PREFERENCE.length : i;
}

/**
 * Merges records that name each other (in `id` or `aliases`) or share a third id, so that a GHSA, a
 * PYSEC and a CVE record of one vulnerability count once, also along a chain (GHSA names a CVE, the
 * PYSEC record names the same CVE). Withdrawn records do not count. Pure and deterministic.
 */
export function mergeVulnerabilities(records: readonly OsvRecord[]): Vulnerability[] {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as string;
    parent.set(a, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const live = records.filter((r) => !r.withdrawn && r.id !== '');
  for (const r of live) {
    union(r.id, r.id);
    for (const alias of r.aliases) if (alias !== '') union(r.id, alias);
  }
  const groups = new Map<string, Set<string>>();
  for (const r of live) {
    const root = find(r.id);
    const set = groups.get(root) ?? new Set<string>();
    set.add(r.id);
    for (const alias of r.aliases) if (alias !== '') set.add(alias);
    groups.set(root, set);
  }
  // An alias can also be the id of a withdrawn record: it still names this vulnerability.
  const out: Vulnerability[] = [];
  for (const ids of groups.values()) {
    const sorted = [...ids].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const [id, ...aliases] = sorted as [string, ...string[]];
    out.push({ id, aliases: aliases.sort() });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function toRecord(value: unknown): OsvRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value['id']);
  if (!id) return undefined;
  const withdrawn = asString(value['withdrawn']);
  return {
    id,
    aliases: asArray(value['aliases']).filter(
      (a): a is string => typeof a === 'string' && a !== '',
    ),
    withdrawn: withdrawn !== undefined && withdrawn !== '',
  };
}

/** `POST /v1/query`: the full records of one package version (the batch answer has only ids). */
async function fetchRecords(http: Http, q: OsvQuery): Promise<OsvRecord[] | string> {
  const records: OsvRecord[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await http.request('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package: { name: q.name, ecosystem: q.ecosystem === 'npm' ? 'npm' : 'PyPI' },
        version: q.version,
        ...(token ? { page_token: token } : {}),
      }),
    });
    if (!r.ok) return r.reason;
    if (!isRecord(r.data)) return 'unexpected answer: OSV query';
    for (const v of asArray(r.data['vulns'])) {
      const rec = toRecord(v);
      if (rec) records.push(rec);
    }
    token = asString(r.data['next_page_token']);
    if (!token) return records;
  }
  return records;
}

/** One batch request per 1000 queries, then the full records for the versions that have two or more records. */
export async function queryOsv(http: Http, queries: OsvQuery[]): Promise<OsvOutcome> {
  const outcome: OsvOutcome = {
    advisories: new Map(),
    aliases: new Map(),
    missing: new Set(),
    unmerged: new Set(),
  };
  const seen = new Set<string>();
  const unique = queries.filter((q) => {
    const key = osvKey(q);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const affected: Array<{ q: OsvQuery; ids: string[] }> = [];
  for (let start = 0; start < unique.length; start += BATCH) {
    const chunk = unique.slice(start, start + BATCH);
    const body = JSON.stringify({
      queries: chunk.map((q) => ({
        package: { name: q.name, ecosystem: q.ecosystem === 'npm' ? 'npm' : 'PyPI' },
        version: q.version,
      })),
    });
    const r = await http.request('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const results = r.ok && isRecord(r.data) ? r.data['results'] : undefined;
    if (!r.ok || !Array.isArray(results) || results.length !== chunk.length) {
      outcome.failure = r.ok ? 'unexpected answer: OSV batch' : r.reason;
      for (const q of chunk) outcome.missing.add(osvKey(q));
      continue;
    }
    chunk.forEach((q, i) => {
      const entry: unknown = results[i];
      const ids = isRecord(entry)
        ? asArray(entry['vulns'])
            .map((v) => (isRecord(v) ? asString(v['id']) : undefined))
            .filter((id): id is string => typeof id === 'string' && id !== '')
        : [];
      const sorted = [...new Set(ids)].sort();
      outcome.advisories.set(osvKey(q), sorted);
      // One record cannot duplicate itself: only versions with two or more records are read in full.
      if (sorted.length >= 2) affected.push({ q, ids: sorted });
    });
  }

  // The batch lists records, not vulnerabilities: one vulnerability often has a GHSA, a PYSEC and a CVE
  // record. Read the full records of the affected versions and merge them.
  const queue = [...affected];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const key = osvKey(next.q);
      const got = await fetchRecords(http, next.q).catch((e: unknown) =>
        e instanceof Error ? e.message : 'OSV query failed',
      );
      if (typeof got === 'string') {
        outcome.unmerged.add(key);
        outcome.failure ??= `${got} (advisory aliases not merged for ${next.q.name})`;
        continue;
      }
      // Ids the batch listed and the full answer did not carry are kept as they are.
      const known = new Set(got.flatMap((r) => [r.id, ...r.aliases]));
      const extra: OsvRecord[] = next.ids
        .filter((id) => !known.has(id))
        .map((id) => ({ id, aliases: [], withdrawn: false }));
      const vulns = mergeVulnerabilities([...got, ...extra]);
      outcome.advisories.set(
        key,
        vulns.map((v) => v.id),
      );
      const aliases: Record<string, string[]> = {};
      for (const v of vulns) if (v.aliases.length > 0) aliases[v.id] = v.aliases;
      if (Object.keys(aliases).length > 0) outcome.aliases.set(key, aliases);
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXPAND_POOL, queue.length) }, worker));
  return outcome;
}
