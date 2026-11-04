import type { Http } from '../net/http.js';
import { asArray, asBoolean, asNumber, asString, isRecord } from '../util/guards.js';
import { encodePackageName } from '../util/names.js';
import { parseRepoUrl, type RepoRef } from './repo.js';
import { badShape, fail, type Fetched } from './result.js';

const BASE = 'https://api.deps.dev/v3';

export interface DepsDevVersion {
  version: string;
  date?: string;
  isDefault: boolean;
  deprecated?: string;
}

export interface DepsDevPackage {
  versions: DepsDevVersion[];
  defaultVersion?: string;
}

/** All versions of an npm package, with publish dates and deprecation. */
export async function getNpmPackage(http: Http, name: string): Promise<Fetched<DepsDevPackage>> {
  const r = await http.request(`${BASE}/systems/npm/packages/${encodePackageName(name)}`);
  if (!r.ok) return fail(r);
  if (!isRecord(r.data) || !Array.isArray(r.data['versions'])) return badShape('deps.dev package');
  const versions: DepsDevVersion[] = [];
  for (const raw of asArray(r.data['versions'])) {
    if (!isRecord(raw) || !isRecord(raw['versionKey'])) continue;
    const version = asString(raw['versionKey']['version']);
    if (!version) continue;
    const deprecated =
      asBoolean(raw['isDeprecated']) === true
        ? asString(raw['deprecatedReason']) || 'deprecated'
        : undefined;
    const entry: DepsDevVersion = { version, isDefault: asBoolean(raw['isDefault']) === true };
    const date = asString(raw['publishedAt']);
    if (date) entry.date = date;
    if (deprecated) entry.deprecated = deprecated;
    versions.push(entry);
  }
  const defaultVersion = versions.find((v) => v.isDefault)?.version;
  return { ok: true, value: defaultVersion ? { versions, defaultVersion } : { versions } };
}

/** The source repository deps.dev links to a version. */
export async function getVersionRepo(
  http: Http,
  name: string,
  version: string,
): Promise<Fetched<RepoRef | null>> {
  const r = await http.request(
    `${BASE}/systems/npm/packages/${encodePackageName(name)}/versions/${encodeURIComponent(version)}`,
  );
  if (!r.ok) return fail(r);
  if (!isRecord(r.data)) return badShape('deps.dev version');
  for (const project of asArray(r.data['relatedProjects'])) {
    if (!isRecord(project) || !isRecord(project['projectKey'])) continue;
    if (project['relationType'] !== 'SOURCE_REPO') continue;
    const id = asString(project['projectKey']['id']);
    const repo = id ? parseRepoUrl(id) : null;
    if (repo) return { ok: true, value: repo };
  }
  for (const link of asArray(r.data['links'])) {
    if (!isRecord(link) || link['label'] !== 'SOURCE_REPO') continue;
    const repo = parseRepoUrl(asString(link['url']) ?? '');
    if (repo) return { ok: true, value: repo };
  }
  return { ok: true, value: null };
}

export interface ProjectInfo {
  stars?: number;
  /** OpenSSF Scorecard "Maintained" check, 0 to 10; absent when not computed. */
  maintained?: number;
  scorecardDate?: string;
  /** Overall Scorecard score, 0 to 10. */
  overall?: number;
}

/** Project data including the OpenSSF Scorecard. A 404 means deps.dev does not track it. */
export async function getProject(http: Http, repo: RepoRef): Promise<Fetched<ProjectInfo | null>> {
  const id = `${repo.host}/${repo.owner}/${repo.name}`;
  const r = await http.request(`${BASE}/projects/${encodeURIComponent(id)}`);
  if (!r.ok) {
    if (r.kind === 'not-found') return { ok: true, value: null };
    return fail(r);
  }
  if (!isRecord(r.data)) return badShape('deps.dev project');
  const info: ProjectInfo = {};
  const stars = asNumber(r.data['starsCount']);
  if (stars !== undefined) info.stars = stars;
  const card = r.data['scorecard'];
  if (isRecord(card)) {
    const date = asString(card['date']);
    if (date) info.scorecardDate = date;
    const overall = asNumber(card['overallScore']);
    if (overall !== undefined) info.overall = overall;
    for (const check of asArray(card['checks'])) {
      if (isRecord(check) && check['name'] === 'Maintained') {
        const score = asNumber(check['score']);
        if (score !== undefined && score >= 0) info.maintained = score; // -1 means not applicable
      }
    }
  }
  return { ok: true, value: info };
}
