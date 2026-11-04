import type { Http } from '../net/http.js';
import { asArray, asBoolean, asString, isRecord } from '../util/guards.js';
import { pickPypiRepo, sourceElsewhere, type RepoLink } from './pypi-repo.js';
import type { RepoRef } from './repo.js';
import { badShape, fail, type Fetched } from './result.js';

export interface PypiRelease {
  version: string;
  /** Upload time of the release's newest file: late wheels count as part of the release. */
  date?: string;
  /** Upload time of its first file. */
  firstDate?: string;
  /** True when it has files and all of them are yanked. */
  yanked: boolean;
  yankedReason?: string;
}

export interface PypiProject {
  latest: string;
  inactive: boolean;
  /** The project's newest release is yanked (PyPI reports this on `info`). */
  latestYanked: boolean;
  yankedReason?: string;
  releases: PypiRelease[];
  repo?: RepoRef;
  /** Where in the metadata the repository was found, and what else the record names. */
  repoLink?: RepoLink;
  /** A source link to a host the engine does not read: the older-release fallback must not override it. */
  sourceElsewhere?: { field: string; url: string };
}

const INACTIVE = 'Development Status :: 7 - Inactive';
/** `GET pypi.org/pypi/{name}/json`, reduced to the fields the engine reads. */
export async function getPypiProject(http: Http, name: string): Promise<Fetched<PypiProject>> {
  const r = await http.request(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!r.ok) return fail(r);
  if (!isRecord(r.data) || !isRecord(r.data['info'])) return badShape('PyPI project');
  const info = r.data['info'];
  const latest = asString(info['version']);
  if (!latest) return badShape('PyPI project (no version)');
  const releases: PypiRelease[] = [];
  const raw = r.data['releases'];
  if (isRecord(raw)) {
    for (const [version, files] of Object.entries(raw)) {
      const list = asArray(files).filter(isRecord);
      if (list.length === 0) continue;
      let date: string | undefined;
      let firstDate: string | undefined;
      let allYanked = true;
      let reason: string | undefined;
      for (const file of list) {
        const when = asString(file['upload_time_iso_8601']) ?? asString(file['upload_time']);
        if (when && (!date || when > date)) date = when;
        if (when && (!firstDate || when < firstDate)) firstDate = when;
        if (asBoolean(file['yanked']) !== true) allYanked = false;
        else reason = reason ?? asString(file['yanked_reason']);
      }
      const release: PypiRelease = { version, yanked: allYanked };
      if (date) release.date = date;
      if (firstDate) release.firstDate = firstDate;
      if (allYanked && reason) release.yankedReason = reason;
      releases.push(release);
    }
  }
  const classifiers = asArray(info['classifiers']).filter(
    (c): c is string => typeof c === 'string',
  );
  const project: PypiProject = {
    latest,
    inactive: classifiers.includes(INACTIVE),
    latestYanked: asBoolean(info['yanked']) === true,
    releases,
  };
  const reason = asString(info['yanked_reason']);
  if (project.latestYanked && reason) project.yankedReason = reason;
  const elsewhere = sourceElsewhere(info);
  if (elsewhere) project.sourceElsewhere = elsewhere;
  const link = pickPypiRepo(info);
  if (link) {
    project.repo = link.repo;
    project.repoLink = link;
  }
  return { ok: true, value: project };
}

/**
 * The repository named by the metadata of one release (`GET pypi.org/pypi/{name}/{version}/json`). Used when the
 * latest release names none: a project may have dropped the link when it changed its build tool (darglint).
 */
export async function getPypiReleaseRepo(
  http: Http,
  name: string,
  version: string,
): Promise<Fetched<RepoLink | null>> {
  const r = await http.request(
    `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`,
  );
  if (!r.ok) return fail(r);
  if (!isRecord(r.data) || !isRecord(r.data['info'])) return badShape('PyPI release');
  return { ok: true, value: pickPypiRepo(r.data['info']) ?? null };
}
