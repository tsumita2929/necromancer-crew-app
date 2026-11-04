import type { Http } from '../net/http.js';
import { asBoolean, asString, isRecord } from '../util/guards.js';
import type { RepoRef } from './repo.js';
import { badShape, fail, type Fetched } from './result.js';

/** The newest commit of the default branch: `GET /repos/{owner}/{repo}/commits?per_page=1`. */
export async function getLatestCommit(
  http: Http,
  repo: RepoRef,
): Promise<Fetched<{ date: string } | null>> {
  const r = await http.request(
    `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits?per_page=1`,
    { headers: { accept: 'application/vnd.github+json' } },
  );
  if (!r.ok) {
    // 404 and 409 (an empty repository) both mean there is no commit to read.
    if (r.kind === 'not-found' || r.status === 409) return { ok: true, value: null };
    return fail(r);
  }
  if (!Array.isArray(r.data)) return badShape('GitHub commits');
  const first: unknown = r.data[0];
  if (!isRecord(first)) return { ok: true, value: null };
  const commit = first['commit'];
  const person = isRecord(commit) ? (commit['committer'] ?? commit['author']) : undefined;
  const date = isRecord(person) ? asString(person['date']) : undefined;
  if (!date || !Number.isFinite(Date.parse(date))) return badShape('GitHub commit date');
  return { ok: true, value: { date } };
}

export type GithubRepo =
  | {
      state: 'ok';
      archived: boolean;
      pushedAt?: string;
      /** Set when the repository answers under another name ("owner/name"): it was renamed or transferred. */
      renamedTo?: string;
      /** True when the repository is a fork of another. */
      fork?: boolean;
    }
  | { state: 'gone'; reason: string };

const MAX_HOPS = 3;
const REDIRECTS = new Set([301, 302, 307, 308]);

/**
 * `GET api.github.com/repos/{owner}/{repo}`. 404 and 451 mean the repository is gone. A repository that
 * was renamed or moved answers 301 with the address of its new place. A browser or Node `fetch` follows
 * that without being asked; a fetch that does not is followed here, up to three hops (a repository renamed
 * more than once can leave a chain). The current name is reported in `renamedTo`; the old address is never
 * read as gone.
 */
export async function getGithubRepo(http: Http, repo: RepoRef): Promise<Fetched<GithubRepo>> {
  let url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const r = await http.request(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) {
      if (REDIRECTS.has(r.status)) {
        const next = isRecord(r.data) ? asString(r.data['url']) : undefined;
        if (
          next &&
          next !== url &&
          /^https:\/\/api\.github\.com\/(?:repos|repositories)\//.test(next)
        ) {
          url = next;
          continue;
        }
        return fail(r);
      }
      if (r.kind === 'not-found') {
        return { ok: true, value: { state: 'gone', reason: 'GitHub answers 404 (not found)' } };
      }
      if (r.kind === 'gone') {
        return {
          ok: true,
          value: { state: 'gone', reason: 'GitHub answers 451 (unavailable for legal reasons)' },
        };
      }
      return fail(r);
    }
    if (!isRecord(r.data) || typeof r.data['archived'] !== 'boolean') {
      return badShape('GitHub repository');
    }
    const out: GithubRepo = { state: 'ok', archived: asBoolean(r.data['archived']) === true };
    const pushed = asString(r.data['pushed_at']);
    if (pushed) out.pushedAt = pushed;
    if (asBoolean(r.data['fork']) === true) out.fork = true;
    const current = asString(r.data['full_name']);
    if (current && current.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()) {
      out.renamedTo = current;
    }
    return { ok: true, value: out };
  }
  return fail({ ok: false, status: 0, kind: 'unavailable', reason: 'too many redirects' });
}
