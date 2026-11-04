/**
 * The source repository of a PyPI project, read from every field of its metadata that can hold one.
 *
 * Fields, best first:
 *   1. `project_urls` under an explicit source key (Source, Source Code, Code, Repository, GitHub, GitLab, ...)
 *   2. `project_urls` under a homepage key (Homepage, Home, Website, ...) and `home_page`
 *   3. `download_url`
 *   4. `project_urls` under any other key (Changelog, Issues, Bug Tracker, Documentation, ...) and `bugtrack_url`,
 *      when the link points into a repository
 *
 * Keys are compared without case or punctuation. The long description is never read. A link is a repository
 * only when it names an owner and a repository on GitHub, GitLab or Bitbucket: a link to an organisation page, a
 * documentation site or a sponsors page is not. A link into a repository (`/tree/main/pkg`, `/issues`, `.git`,
 * a trailing slash, `www.`) is that repository.
 */

import { isRecord, asString, type UnknownRecord } from '../util/guards.js';
import { parseRepoUrl, repoKey, repoUrl, type RepoRef } from './repo.js';

export type FieldTier = 'source' | 'homepage' | 'download' | 'other';

export interface RepoLink {
  repo: RepoRef;
  /** The PyPI field the link was read from, as written: `Source`, `home_page`, `download_url`, ... */
  field: string;
  tier: FieldTier;
  /** Other, different repositories the same record names: where from, and which. */
  others: Array<{ field: string; repo: RepoRef }>;
}

const SOURCE_KEY =
  /(?:^|\s)(?:source|sources|src|code|repo|repository|repositories|github|gitlab|bitbucket|git|vcs|scm|development|dev)(?:\s|$)/;
const NOT_SOURCE = /conduct|sponsor|funding|donat|licen[cs]e|security|discuss|chat|community/;
const HOME_KEY = /^(?:home|homepage|home page|website|web|web site|url|project|project page|site)$/;

/** `Source Code`, `source_code` and `SOURCE-CODE` are one key. */
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tierOfKey(key: string): FieldTier {
  const k = normalizeKey(key);
  if (NOT_SOURCE.test(k)) return 'other';
  if (HOME_KEY.test(k)) return 'homepage';
  if (SOURCE_KEY.test(k)) return 'source';
  return 'other';
}

const RANK: Record<FieldTier, number> = { source: 0, homepage: 1, download: 2, other: 3 };

/** The repository named by the metadata of one release (`info` of the PyPI JSON), or undefined. */
export function pickPypiRepo(info: UnknownRecord): RepoLink | undefined {
  const candidates: Array<{ field: string; tier: FieldTier; url: string; order: number }> = [];
  let order = 0;
  const urls = info['project_urls'];
  if (isRecord(urls)) {
    for (const [key, value] of Object.entries(urls)) {
      if (typeof value === 'string')
        candidates.push({ field: key, tier: tierOfKey(key), url: value, order: order++ });
    }
  }
  const add = (field: string, tier: FieldTier): void => {
    const value = asString(info[field]);
    if (value) candidates.push({ field, tier, url: value, order: order++ });
  };
  add('home_page', 'homepage');
  add('download_url', 'download');
  add('bugtrack_url', 'other');
  add('docs_url', 'other');
  candidates.sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.order - b.order);

  let chosen: RepoLink | undefined;
  for (const c of candidates) {
    const repo = parseRepoUrl(c.url);
    if (!repo) continue;
    if (!chosen) {
      chosen = { repo, field: c.field, tier: c.tier, others: [] };
    } else if (repoKey(repo) !== repoKey(chosen.repo)) {
      if (!chosen.others.some((o) => repoKey(o.repo) === repoKey(repo)))
        chosen.others.push({ field: c.field, repo });
    }
  }
  return chosen;
}

/**
 * A source key (Source, Repository, Code ...) that holds a web address Necromancer cannot read as a repository
 * (Codeberg, SourceHut, a self-hosted forge). The maintainer says where the source is; an older release's link
 * must not override that.
 */
export function sourceElsewhere(info: UnknownRecord): { field: string; url: string } | undefined {
  const urls = info['project_urls'];
  if (!isRecord(urls)) return undefined;
  for (const [key, value] of Object.entries(urls)) {
    if (typeof value !== 'string' || tierOfKey(key) !== 'source') continue;
    if (/^(?:https?|git\+https?|ssh):\/\//i.test(value.trim()) && parseRepoUrl(value) === null)
      return { field: key, url: value.trim().slice(0, 200) };
  }
  return undefined;
}

/** Package name and repository name compared loosely: `python-darglint` and `darglint`, `PyYAML` and `pyyaml`. */
export function nameMatchesRepo(packageName: string, repoName: string): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/^(?:python|py)(?=[a-z0-9]{3})/, '')
      .replace(/(?<=[a-z0-9]{3})(?:python|py)$/, '');
  const a = norm(packageName);
  const b = norm(repoName);
  if (a === '' || b === '') return false;
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

/** The sentence that goes into the evidence when the link did not come from the usual place. */
export function describeLink(
  link: RepoLink,
  from?: { kind: 'oldest-release'; version: string },
): string | undefined {
  const where = (field: string): string => `"${field.replace(/"/g, "'").slice(0, 40)}"`;
  const parts: string[] = [];
  if (from) {
    parts.push(
      `The latest release names no repository in its PyPI metadata. The oldest release (${from.version.slice(0, 40)}) names ${repoUrl(link.repo)} in ${where(link.field)}, and the name matches the package, so that repository is used`,
    );
  } else if (link.tier === 'download' || link.tier === 'other') {
    parts.push(
      `The source repository ${repoUrl(link.repo)} was found in the PyPI field ${where(link.field)}, not in a source or homepage link`,
    );
  }
  return parts.length > 0 ? `${parts.join('. ')}.` : undefined;
}
