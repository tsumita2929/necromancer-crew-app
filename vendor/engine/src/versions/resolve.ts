import type { DependencyRef } from '../types.js';
import { maxSatisfyingPep, parseSpecifier, parseSpecifierSet } from './pep440.js';
import { maxSatisfying, parseRange } from './semver.js';

export type HowResolved = 'lockfile' | 'range' | 'latest';

export interface Resolved {
  version: string;
  how: HowResolved;
}

/** Spec text without an `npm:name@` alias prefix. */
export function npmRange(spec: string): string {
  const trimmed = spec.trim();
  if (!/^npm:/i.test(trimmed)) return trimmed;
  const target = trimmed.slice(4);
  const at = target.lastIndexOf('@');
  return at > 0 ? target.slice(at + 1) : '';
}

/**
 * The version in use (R2.13): the lockfile version, else the highest version that
 * satisfies the declared range, else the latest when the spec is not a range at all.
 * Returns undefined when nothing is known, or when a valid range matches no known version.
 */
export function resolveVersionInUse(
  dep: Pick<DependencyRef, 'ecosystem' | 'spec' | 'resolved'>,
  available: readonly string[],
  latest: string | undefined,
): Resolved | undefined {
  if (dep.resolved) return { version: dep.resolved, how: 'lockfile' };
  const spec = dep.ecosystem === 'npm' ? npmRange(dep.spec) : dep.spec.trim();
  if (dep.ecosystem === 'npm') {
    if (/^(?:|\*|x|latest)$/i.test(spec))
      return latest ? { version: latest, how: 'latest' } : undefined;
    const best = maxSatisfying(available, spec);
    if (best) return { version: best, how: 'range' };
    // A single known latest may satisfy the range even when no list is available.
    if (latest && maxSatisfying([latest], spec)) return { version: latest, how: 'range' };
    // A valid range that no known version satisfies is unresolved: guessing the latest would
    // check advisories for a version the project cannot install. A dist-tag such as "next"
    // is not a range, so it means the latest.
    if (parseRange(spec)) return undefined;
    return latest ? { version: latest, how: 'latest' } : undefined;
  }
  if (spec === '' || spec === '*') return latest ? { version: latest, how: 'latest' } : undefined;
  const best = maxSatisfyingPep(available, spec);
  if (best) return { version: best, how: 'range' };
  const clauses = parseSpecifier(spec);
  const pin =
    clauses && clauses.length === 1 && clauses[0]
      ? /^={2,3}\s*([^*\s]+)$/.exec(clauses[0].text.trim())
      : null;
  if (pin?.[1]) return { version: pin[1], how: 'range' };
  if (parseSpecifierSet(spec)) return undefined; // valid, but nothing known satisfies it
  return latest ? { version: latest, how: 'latest' } : undefined;
}
