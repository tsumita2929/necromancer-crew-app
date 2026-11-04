import type { Http } from '../net/http.js';
import { asString, isRecord } from '../util/guards.js';
import { encodePackageName } from '../util/names.js';
import { parseRepoUrl, type RepoRef } from './repo.js';
import { badShape, fail, type Fetched } from './result.js';

export interface NpmLatest {
  version: string;
  /** The deprecation message of the latest release, if it has one. */
  deprecated?: string;
  repo?: RepoRef;
}

/** The "latest" release document of a package: small, and the authority on deprecation. */
export async function getNpmLatest(http: Http, name: string): Promise<Fetched<NpmLatest>> {
  const r = await http.request(`https://registry.npmjs.org/${encodePackageName(name)}/latest`);
  if (!r.ok) return fail(r);
  if (!isRecord(r.data)) return badShape('npm registry');
  const version = asString(r.data['version']);
  if (!version) return badShape('npm registry (no version)');
  const out: NpmLatest = { version };
  const deprecated = r.data['deprecated'];
  if (typeof deprecated === 'string' && deprecated.trim() !== '') {
    out.deprecated = deprecated.trim();
  }
  const repository = r.data['repository'];
  const url =
    typeof repository === 'string'
      ? repository
      : isRecord(repository)
        ? asString(repository['url'])
        : undefined;
  const repo = url ? parseRepoUrl(url) : null;
  if (repo) out.repo = repo;
  return { ok: true, value: out };
}

/**
 * The `engines.node` of one release, from its manifest in the registry (`GET registry.npmjs.org/{name}/{version}`),
 * or null when it declares none. Used to say what the next major version needs.
 */
export async function getNpmEngines(
  http: Http,
  name: string,
  version: string,
): Promise<Fetched<string | null>> {
  const r = await http.request(
    `https://registry.npmjs.org/${encodePackageName(name)}/${encodeURIComponent(version)}`,
  );
  if (!r.ok) return fail(r);
  if (!isRecord(r.data)) return badShape('npm version manifest');
  const engines = r.data['engines'];
  const node = isRecord(engines) ? asString(engines['node']) : undefined;
  return { ok: true, value: node ?? null };
}
