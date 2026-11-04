/**
 * The e18e module-replacements dataset (es-tooling/module-replacements).
 * Three JSON manifests, read from raw.githubusercontent.com, which does not count
 * against the GitHub API limit.
 */

import type { Http } from '../net/http.js';
import { asArray, asString, getOwn, isRecord, type UnknownRecord } from '../util/guards.js';
import type { Successor } from '../types.js';
import { badShape, fail, type Fetched } from './result.js';

const BASE = 'https://raw.githubusercontent.com/es-tooling/module-replacements/main/manifests';
/** Order matters: platform replacements first, then snippets, then preferred packages. */
export const MANIFESTS = ['native', 'micro-utilities', 'preferred'] as const;
type ManifestName = (typeof MANIFESTS)[number];

interface Manifest {
  mappings: UnknownRecord;
  replacements: UnknownRecord;
}

export interface ReplacementIndex {
  /** Successors for an npm package name, best first. Empty when none. */
  lookup(name: string): Successor[];
  /** Manifests that could not be read, with the reason. */
  failures: Array<{ manifest: string; reason: string }>;
}

async function loadManifest(http: Http, name: ManifestName): Promise<Fetched<Manifest>> {
  const r = await http.request(`${BASE}/${name}.json`);
  if (!r.ok) return fail(r);
  if (!isRecord(r.data) || !isRecord(r.data['mappings'])) return badShape(`${name}.json`);
  const replacements = isRecord(r.data['replacements']) ? r.data['replacements'] : {};
  return { ok: true, value: { mappings: r.data['mappings'], replacements } };
}

function docUrl(entry: UnknownRecord | undefined, mapping: UnknownRecord): string | undefined {
  const url = (entry && getOwn(entry, 'url')) ?? getOwn(mapping, 'url');
  if (!isRecord(url)) return undefined;
  const type = asString(url['type']);
  const id = asString(url['id']);
  if (!id) return undefined;
  if (type === 'mdn') return `https://developer.mozilla.org/docs/${id}`;
  if (type === 'node') return `https://nodejs.org/api/${id.replace(/^api\//, '')}`;
  if (type === 'e18e') return `https://e18e.dev/docs/replacements/${id}.html`;
  return undefined;
}

function toSuccessor(
  id: string,
  manifest: Manifest,
  mapping: UnknownRecord,
): Successor | undefined {
  const rawEntry = getOwn(manifest.replacements, id);
  const entry = isRecord(rawEntry) ? rawEntry : undefined;
  const url = docUrl(entry, mapping);
  const withUrl = url ? { url } : {};
  const type = entry ? asString(entry['type']) : undefined;
  if (type === 'native') {
    return {
      name: id,
      ecosystem: 'npm',
      kind: 'native',
      reason: `${id} is built into the platform, so the package is not needed.`,
      source: 'module-replacements',
      ...withUrl,
    };
  }
  if (type === 'removal') {
    return {
      name: id,
      ecosystem: 'npm',
      kind: 'native',
      reason: asString(entry?.['description']) ?? 'The platform covers this now.',
      source: 'module-replacements',
      ...withUrl,
    };
  }
  if (type === 'simple' || id.startsWith('snippet::')) {
    const description = asString(entry?.['description']);
    return {
      name: id.replace(/^snippet::/, ''),
      ecosystem: 'npm',
      kind: 'raise',
      reason: description
        ? description.replace(/\s+/g, ' ')
        : 'A short snippet replaces this package, and the project can own it.',
      source: 'module-replacements',
      ...withUrl,
    };
  }
  if (type === 'documented') {
    const target = asString(entry?.['replacementModule']) ?? id;
    return {
      name: target,
      ecosystem: 'npm',
      kind: 'package',
      reason: `${target} is the package e18e recommends instead.`,
      source: 'module-replacements',
      ...withUrl,
    };
  }
  // An id with no entry is a bare package name.
  return {
    name: id,
    ecosystem: 'npm',
    kind: 'package',
    reason: `${id} is the package e18e recommends instead.`,
    source: 'module-replacements',
    ...withUrl,
  };
}

/** Load the three manifests once and build a lookup. Never throws. */
export async function loadReplacements(http: Http): Promise<ReplacementIndex> {
  const failures: ReplacementIndex['failures'] = [];
  const loaded: Manifest[] = [];
  const results = await Promise.all(MANIFESTS.map((m) => loadManifest(http, m)));
  results.forEach((result, i) => {
    if (result.ok) loaded.push(result.value);
    else failures.push({ manifest: `${MANIFESTS[i]}.json`, reason: result.reason });
  });
  return {
    failures,
    lookup(name: string): Successor[] {
      const out: Successor[] = [];
      for (const manifest of loaded) {
        const mapping = getOwn(manifest.mappings, name);
        if (!isRecord(mapping)) continue;
        for (const id of asArray(mapping['replacements'])) {
          if (typeof id !== 'string') continue;
          const successor = toSuccessor(id, manifest, mapping);
          if (successor) out.push(successor);
        }
      }
      return out;
    },
  };
}
