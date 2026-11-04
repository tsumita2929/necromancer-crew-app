/**
 * Where to upgrade to when the version in use is deprecated (npm) or yanked (PyPI).
 *
 * Candidates are releases that are newer than the one in use, stable (not a pre-release), and neither
 * deprecated nor yanked. The choice, in this order (round 5):
 *
 *   1. range:      the newest candidate inside the range the project declares, when the manifest declares one
 *                  (`^9.0.0`): the project can take it without touching the manifest.
 *   2. same major: the newest candidate in the major version of the one in use, outside the declared range
 *                  (or when no range is declared): the smaller step, but the manifest must change.
 *   3. next major: the newest release of the lowest major above the one in use that has a candidate. The
 *                  caller adds the `engines.node` of that release when it is known.
 *   4. older:      no candidate is newer (every newer release is deprecated, yanked or a pre-release, or the
 *                  version in use was published above the real latest, as codemirror 6.65.7 was above 6.0.2):
 *                  the newest release that qualifies, same major first, marked `older`.
 *
 * Pure and total: unparseable versions are skipped, and no candidate gives `undefined`.
 */

import type { UpgradeTarget } from '../types.js';
import { comparePep, isStablePep, maxSatisfyingPep, parsePepVersion } from './pep440.js';
import { compareVersions, isStable, maxSatisfying, parseRange, parseVersion } from './semver.js';
import { npmRange } from './resolve.js';

export interface ReleaseState {
  version: string;
  /** npm: the deprecation message of this release. */
  deprecated?: string | undefined;
  /** PyPI: every file of this release is yanked. */
  yanked?: boolean | undefined;
}

export type UpgradeTier = 'range' | 'same-major' | 'next-major' | 'older';

export interface UpgradeChoice {
  target: UpgradeTarget;
  tier: UpgradeTier;
  /** The declared range, when it was a real constraint (not `*`, `latest` or nothing). */
  declaredRange?: string;
  /** True when the target is inside the declared range. */
  inRange: boolean;
}

interface Parsed {
  version: string;
  /** Orders versions of one ecosystem: negative, zero or positive. */
  compare(other: Parsed): number;
  major: number;
  stable: boolean;
}

function parseOne(ecosystem: 'npm' | 'pypi', version: string): Parsed | undefined {
  if (ecosystem === 'npm') {
    const v = parseVersion(version);
    if (!v) return undefined;
    return {
      version,
      major: v.major,
      stable: isStable(v),
      compare: (o) => compareVersions(v, parseVersion(o.version) ?? v),
    };
  }
  const v = parsePepVersion(version);
  if (!v) return undefined;
  return {
    version,
    // An epoch change is a different numbering, so it counts as another major.
    major: v.epoch * 1_000_000_000 + (v.release[0] ?? 0),
    stable: isStablePep(v),
    compare: (o) => comparePep(v, parsePepVersion(o.version) ?? v),
  };
}

const NOTHING = /^(?:|\*|x|latest|next|>=\s*0(?:\.0(?:\.0)?)?)$/i;

/** The declared range as a constraint, or undefined when the manifest says nothing useful. */
function constraint(ecosystem: 'npm' | 'pypi', spec: string | undefined): string | undefined {
  if (typeof spec !== 'string') return undefined;
  const range = ecosystem === 'npm' ? npmRange(spec) : spec.trim();
  if (NOTHING.test(range.trim())) return undefined;
  if (ecosystem === 'npm' && parseRange(range) === null) return undefined;
  return range;
}

function inside(ecosystem: 'npm' | 'pypi', range: string, version: string): boolean {
  return ecosystem === 'npm'
    ? maxSatisfying([version], range) === version
    : maxSatisfyingPep([version], range) === version;
}

export function upgradeChoice(
  ecosystem: 'npm' | 'pypi',
  releases: readonly ReleaseState[],
  inUse: string,
  spec?: string,
): UpgradeChoice | undefined {
  const current = parseOne(ecosystem, inUse);
  if (!current) return undefined;
  const fine: Parsed[] = [];
  for (const release of releases) {
    if (release.deprecated || release.yanked) continue;
    const candidate = parseOne(ecosystem, release.version);
    if (candidate?.stable && candidate.compare(current) !== 0) fine.push(candidate);
  }
  const newest = (list: Parsed[]): Parsed | undefined =>
    list.reduce<Parsed | undefined>((a, b) => (!a || b.compare(a) > 0 ? b : a), undefined);
  const range = constraint(ecosystem, spec);
  const declared = range === undefined ? {} : { declaredRange: range };
  const newer = fine.filter((c) => c.compare(current) > 0);

  if (newer.length > 0) {
    if (range !== undefined) {
      const best = newest(newer.filter((c) => inside(ecosystem, range, c.version)));
      if (best)
        return {
          target: { version: best.version, sameMajor: best.major === current.major },
          tier: 'range',
          ...declared,
          inRange: true,
        };
    }
    const same = newest(newer.filter((c) => c.major === current.major));
    if (same)
      return {
        target: { version: same.version, sameMajor: true },
        tier: 'same-major',
        ...declared,
        inRange: range !== undefined && inside(ecosystem, range, same.version),
      };
    const lowest = Math.min(...newer.map((c) => c.major));
    const next = newest(newer.filter((c) => c.major === lowest));
    if (next)
      return {
        target: { version: next.version, sameMajor: false },
        tier: 'next-major',
        ...declared,
        inRange: range !== undefined && inside(ecosystem, range, next.version),
      };
  }
  const sameOlder = newest(fine.filter((c) => c.major === current.major));
  const best = sameOlder ?? newest(fine);
  if (!best) return undefined;
  return {
    target: { version: best.version, sameMajor: best === sameOlder, older: true },
    tier: 'older',
    ...declared,
    inRange: range !== undefined && inside(ecosystem, range, best.version),
  };
}

/** The target alone, for callers that do not need the reason. */
export function upgradeTarget(
  ecosystem: 'npm' | 'pypi',
  releases: readonly ReleaseState[],
  inUse: string,
  spec?: string,
): UpgradeTarget | undefined {
  return upgradeChoice(ecosystem, releases, inUse, spec)?.target;
}
