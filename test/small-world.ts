import type { FetchLike } from '@necromancer/engine';

/**
 * A tiny made-up registry for end-to-end tests of the real engine through the tools:
 * - moved-lib:  archived on GitHub, its README says the project moved   -> evidence repo-moved
 * - merge-lib:  old release with two records that name one vulnerability -> advisoryAliases
 * - anything else: 404 everywhere                                        -> notFound
 * No network is touched.
 */
export const worldNow = new Date('2026-11-03T00:00:00Z');
const daysAgo = (n: number) => new Date(worldNow.getTime() - n * 86_400_000).toISOString();

interface Pkg {
  version: string;
  date: string;
  repo: string;
  archived?: boolean;
  readme?: string;
  vulns?: Array<{ id: string; aliases?: string[] }>;
}

const PKGS: Record<string, Pkg> = {
  'moved-lib': {
    version: '1.0.0',
    date: daysAgo(500),
    repo: 'https://github.com/org/moved-lib',
    archived: true,
    readme: '# moved-lib\n\n**This repository has moved to https://code.example.org/org/moved-lib**\n',
  },
  'merge-lib': {
    version: '1.0.0',
    date: daysAgo(30),
    repo: 'https://github.com/org/merge-lib',
    vulns: [
      { id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2020-0001'] },
      { id: 'PYSEC-2020-1', aliases: ['CVE-2020-0001', 'GHSA-aaaa-bbbb-cccc'] },
    ],
  },
};

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

export const smallWorld: FetchLike = async (url, init) => {
  let m = /^https:\/\/registry\.npmjs\.org\/(.+)\/latest$/.exec(url);
  if (m) {
    const p = PKGS[decodeURIComponent(m[1] ?? '')];
    return p ? reply(200, { name: m[1], version: p.version, repository: { type: 'git', url: p.repo } }) : reply(404, {});
  }
  m = /^https:\/\/api\.deps\.dev\/v3\/systems\/npm\/packages\/([^/]+)$/.exec(url);
  if (m) {
    const p = PKGS[decodeURIComponent(m[1] ?? '')];
    if (!p) return reply(404, {});
    return reply(200, {
      versions: [{ versionKey: { system: 'NPM', name: m[1], version: p.version }, publishedAt: p.date, isDefault: true, isDeprecated: false, deprecatedReason: '' }],
    });
  }
  m = /^https:\/\/api\.deps\.dev\/v3\/systems\/npm\/packages\/([^/]+)\/versions\/.+$/.exec(url);
  if (m) {
    const p = PKGS[decodeURIComponent(m[1] ?? '')];
    return p ? reply(200, { links: [{ label: 'SOURCE_REPO', url: p.repo }] }) : reply(404, {});
  }
  if (url.startsWith('https://api.deps.dev/v3/projects/')) {
    const p = Object.values(PKGS).find((x) => url.endsWith(encodeURIComponent(x.repo.replace('https://', '')).replace(/%2F/g, '%2F')));
    // Only the moved package has a poor maintenance score, which is what makes the engine look at GitHub.
    return p?.archived
      ? reply(200, { starsCount: 1, scorecard: { date: '2026-10-01T00:00:00Z', checks: [{ name: 'Maintained', score: 1 }] } })
      : reply(404, {});
  }
  m = /^https:\/\/raw\.githubusercontent\.com\/(.+)\/HEAD\/README\.md$/.exec(url);
  if (m) {
    const p = Object.values(PKGS).find((x) => x.repo.endsWith(decodeURIComponent(m![1] ?? '')));
    return p?.readme ? reply(200, p.readme) : reply(404, 'Not Found');
  }
  if (url.startsWith('https://raw.githubusercontent.com/es-tooling/')) return reply(200, { mappings: {}, replacements: {} });
  m = /^https:\/\/api\.github\.com\/repos\/(.+)\/commits\?per_page=1$/.exec(url);
  if (m) return reply(200, [{ commit: { committer: { date: daysAgo(90) }, author: { date: daysAgo(90) } } }]);
  m = /^https:\/\/api\.github\.com\/repos\/(.+)$/.exec(url);
  if (m) {
    const p = Object.values(PKGS).find((x) => x.repo.endsWith(decodeURIComponent(m![1] ?? '')));
    return p ? reply(200, { archived: p.archived ?? false, pushed_at: daysAgo(90) }) : reply(404, {});
  }
  if (url === 'https://api.osv.dev/v1/query') {
    const q = JSON.parse(init?.body ?? '{}') as { package: { name: string } };
    return reply(200, { vulns: PKGS[q.package.name]?.vulns ?? [] });
  }
  if (url === 'https://api.osv.dev/v1/querybatch') {
    const queries = (JSON.parse(init?.body ?? '{}') as { queries: Array<{ package: { name: string } }> }).queries;
    return reply(200, {
      results: queries.map((q) => {
        const v = PKGS[q.package.name]?.vulns ?? [];
        return v.length ? { vulns: v.map(({ id }) => ({ id })) } : {};
      }),
    });
  }
  return reply(404, {});
};
