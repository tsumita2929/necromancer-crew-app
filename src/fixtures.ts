import type { Diagnosis, DependencyRef, Evidence, Successor, Verdict } from '@necromancer/engine';

/**
 * Fixture findings behind the stub engine. They are typed against the shared
 * contract, so the real engine drops in without a change to any caller.
 * The data is illustrative: it is NOT a claim about the live state of a package.
 */
export interface Fixture {
  verdict: Verdict;
  evidence: Evidence[];
  advisories: string[];
  successors: Successor[];
  latest?: { version: string; date?: string };
}

const key = (ecosystem: string, name: string) => `${ecosystem}:${name}`;

export const FIXTURES: Record<string, Fixture> = {
  [key('npm', 'left-pad')]: {
    verdict: 'dead',
    evidence: [
      {
        code: 'npm-deprecated',
        message: 'Deprecated by its maintainer: use String.prototype.padStart.',
        source: 'npm',
        url: 'https://www.npmjs.com/package/left-pad',
        date: '2018-04-01',
      },
      {
        code: 'no-release',
        message: 'No release since 2018.',
        source: 'npm',
        date: '2018-04-01',
      },
    ],
    advisories: [],
    successors: [
      {
        name: 'String.prototype.padStart',
        ecosystem: 'npm',
        kind: 'native',
        reason: 'Built into every supported JavaScript runtime.',
        source: 'module-replacements',
      },
    ],
    latest: { version: '1.3.0', date: '2018-04-01' },
  },
  [key('npm', 'request')]: {
    verdict: 'zombie',
    evidence: [
      {
        code: 'npm-deprecated',
        message: 'Deprecated: request has been fully deprecated and will receive no more fixes.',
        source: 'npm',
        date: '2020-02-11',
      },
      {
        code: 'osv-advisory',
        message: 'A known advisory affects the version in use and will not be patched.',
        source: 'osv',
        url: 'https://osv.dev/vulnerability/GHSA-p8p7-x288-28g6',
      },
    ],
    advisories: ['GHSA-p8p7-x288-28g6'],
    successors: [
      {
        name: 'fetch',
        ecosystem: 'npm',
        kind: 'native',
        reason: 'Global fetch ships with Node 18 and later.',
        source: 'module-replacements',
      },
      {
        name: 'got',
        ecosystem: 'npm',
        kind: 'package',
        reason: 'Maintained HTTP client with a similar feature set.',
        source: 'curated',
      },
    ],
    latest: { version: '2.88.2', date: '2020-03-14' },
  },
  [key('npm', 'moment')]: {
    verdict: 'dying',
    evidence: [
      {
        code: 'maintenance-mode',
        message: 'The project is in maintenance mode and accepts no new features.',
        source: 'github',
      },
    ],
    advisories: [],
    successors: [
      {
        name: 'date-fns',
        ecosystem: 'npm',
        kind: 'package',
        reason: 'Maintained, tree-shakeable date utilities.',
        source: 'module-replacements',
      },
    ],
    latest: { version: '2.30.1', date: '2023-12-27' },
  },
  [key('npm', 'fixture-ghost-lib')]: {
    verdict: 'ghost',
    evidence: [
      {
        code: 'repo-gone',
        message: 'The source repository no longer exists.',
        source: 'github',
      },
      {
        code: 'no-release',
        message: 'No release for more than five years.',
        source: 'npm',
      },
    ],
    advisories: [],
    successors: [
      {
        name: 'fixture-ghost-lib',
        ecosystem: 'npm',
        kind: 'raise',
        reason: 'No successor exists; rebuild the small utility as code the project owns.',
        source: 'curated',
      },
    ],
  },
  [key('pypi', 'nose')]: {
    verdict: 'dead',
    evidence: [
      {
        code: 'project-inactive',
        message: 'The project is no longer maintained and fails on current Python versions.',
        source: 'pypi',
      },
    ],
    advisories: [],
    successors: [
      {
        name: 'pytest',
        ecosystem: 'pypi',
        kind: 'package',
        reason: 'The maintained test runner that nose pointed its users to.',
        source: 'curated',
      },
    ],
    latest: { version: '1.3.7', date: '2015-06-02' },
  },
};

/** Lookup by dependency; names the fixtures do not know are alive, with no evidence. */
export function fixtureDiagnosis(dep: DependencyRef): Diagnosis {
  const f = FIXTURES[key(dep.ecosystem, dep.name)];
  if (!f) {
    return { dependency: dep, verdict: 'alive', evidence: [], advisories: [], successors: [] };
  }
  return {
    dependency: dep,
    verdict: f.verdict,
    evidence: f.evidence.map((e) => ({ ...e })),
    advisories: [...f.advisories],
    successors: f.successors.map((s) => ({ ...s })),
    ...(f.latest ? { latest: { ...f.latest } } : {}),
  };
}
