/** Source repository URLs as package metadata writes them. */

export interface RepoRef {
  host: 'github.com' | 'gitlab.com' | 'bitbucket.org';
  owner: string;
  name: string;
}

const RESERVED_OWNERS = new Set([
  'orgs',
  'sponsors',
  'users',
  'apps',
  'marketplace',
  'topics',
  'features',
  'about',
  'settings',
  'login',
  'pricing',
  'enterprise',
  'collections',
  'events',
  'site',
  'search',
]);

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

function make(
  host: RepoRef['host'],
  owner: string | undefined,
  rawName: string | undefined,
): RepoRef | null {
  if (!owner || !rawName) return null;
  const name = rawName.replace(/\.git$/i, '');
  if (!SEGMENT.test(owner) || !SEGMENT.test(name) || name === '.' || name === '..') return null;
  if (host === 'github.com' && RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return { host, owner, name };
}

function hostOf(text: string): RepoRef['host'] {
  const t = text.toLowerCase();
  if (t.startsWith('gitlab')) return 'gitlab.com';
  if (t.startsWith('bitbucket')) return 'bitbucket.org';
  return 'github.com';
}

/** Parse the many spellings of a repository URL. Returns null for anything else. */
export function parseRepoUrl(input: string): RepoRef | null {
  const text = input.trim().replace(/#.*$/, '').replace(/\?.*$/, '');
  if (text === '' || text.length > 500) return null;
  let m = /^(github|gitlab|bitbucket):([^/\s]+)\/([^/\s]+)$/i.exec(text);
  if (m) return make(hostOf(m[1] ?? ''), m[2], m[3]);
  // git@github.com:owner/repo.git
  m = /^(?:ssh:\/\/)?git@(github\.com|gitlab\.com|bitbucket\.org)[:/]([^/\s]+)\/([^/\s]+)/i.exec(
    text,
  );
  if (m) return make(hostOf(m[1] ?? ''), m[2], m[3]);
  m =
    /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/\s]+@)?(?:www\.)?(github\.com|gitlab\.com|bitbucket\.org)\/([^/\s]+)\/([^/\s]+)/i.exec(
      text,
    );
  if (m) return make(hostOf(m[1] ?? ''), m[2], m[3]);
  m = /^(?:www\.)?(github\.com|gitlab\.com|bitbucket\.org)\/([^/\s]+)\/([^/\s]+)/i.exec(text);
  if (m) return make(hostOf(m[1] ?? ''), m[2], m[3]);
  // npm's shorthand "owner/repo" means GitHub
  m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text);
  if (m) return make('github.com', m[1], m[2]);
  return null;
}

export function repoKey(repo: RepoRef): string {
  return `${repo.host}/${repo.owner}/${repo.name}`.toLowerCase();
}

export function repoUrl(repo: RepoRef): string {
  return `https://${repo.host}/${repo.owner}/${repo.name}`;
}
