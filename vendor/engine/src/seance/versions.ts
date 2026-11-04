/**
 * Which version of the old package a séance fits (round 4b).
 *
 * A curated recipe was run for real against a list of versions of the old package (see
 * `tested-versions.ts`, written by `scripts/run-seance-versions.mjs`). This module compares the version in
 * use, as far as the diagnosis knows it, with that list, and writes the plain sentence that goes into
 * the bundle, the README and the spec.
 *
 * The version in use is the lockfile version when there is one. Without a lockfile it is the declared
 * range, and the range is covered only if the recipe was run against at least one version in it, it does
 * not fit none of them, and no published version in the range was left untested.
 */

import type { DependencyRef, SeanceVersions } from '../types.js';
import { maxSatisfyingPep, parseSpecifierSet } from '../versions/pep440.js';
import { npmRange } from '../versions/resolve.js';
import { maxSatisfying, parseRange } from '../versions/semver.js';
import { TESTED_VERSIONS, type TestedVersions } from './tested-versions.js';

export interface VersionInUse {
  /** The lockfile version, or the declared range; absent when the manifest says nothing. */
  text?: string;
  from: 'lockfile' | 'range' | 'unknown';
  /** Major version of the lockfile version or of the lowest version a range allows. */
  major?: number;
}

const NOTHING = /^(?:|\*|x|latest|next)$/i;

/** The first version-like number in a spec ("^3.0.0" gives 3; "==0.10.2" gives 0). */
function leadingMajor(spec: string): number | undefined {
  const m = /(\d{1,9})(?:\.|\b)/.exec(spec);
  return m ? Number(m[1]) : undefined;
}

export function versionInUse(
  dep: Pick<DependencyRef, 'ecosystem' | 'spec' | 'resolved'>,
): VersionInUse {
  if (typeof dep?.resolved === 'string' && dep.resolved.trim() !== '') {
    const major = leadingMajor(dep.resolved);
    return {
      text: dep.resolved.trim(),
      from: 'lockfile',
      ...(major === undefined ? {} : { major }),
    };
  }
  const spec = typeof dep?.spec === 'string' ? dep.spec.trim() : '';
  const range = dep?.ecosystem === 'npm' ? npmRange(spec) : spec;
  if (NOTHING.test(range)) return { from: 'unknown' };
  const major = leadingMajor(range);
  return { text: range, from: 'range', ...(major === undefined ? {} : { major }) };
}

function inRange(ecosystem: 'npm' | 'pypi', range: string, version: string): boolean {
  if (ecosystem === 'npm')
    return parseRange(range) !== null && maxSatisfying([version], range) === version;
  return parseSpecifierSet(range) !== null && maxSatisfyingPep([version], range) === version;
}

function list(versions: readonly string[], max = 6): string {
  if (versions.length <= max) return versions.join(', ');
  return `${versions.slice(0, 2).join(', ')} … ${versions.slice(-2).join(', ')} (${versions.length} versions)`;
}

function exactIn(version: string, versions: readonly string[]): boolean {
  return versions.includes(version.replace(/^[v=]+/, ''));
}

/** What the bundle says about versions, for a curated recipe. */
export function oldVersionsFor(
  recipeId: string,
  dep: Pick<DependencyRef, 'ecosystem' | 'name' | 'spec' | 'resolved'>,
  data: TestedVersions | undefined = TESTED_VERSIONS[recipeId],
): SeanceVersions {
  const use = versionInUse(dep);
  const name = data?.package ?? dep?.name ?? 'the old package';
  if (!data) {
    return {
      package: name,
      testedAgainst: [],
      inUseFrom: use.from,
      ...(use.text ? { inUse: use.text } : {}),
      note: `This séance was not run against any version of ${name}.`,
    };
  }
  const tested = data.pass;
  const bad = data.fail;
  const base = {
    package: name,
    testedAgainst: [...tested],
    ...(bad.length > 0 ? { doesNotFit: bad.map((b) => ({ ...b })) } : {}),
    inUseFrom: use.from,
    ...(use.text ? { inUse: use.text } : {}),
    ...(data.successor
      ? { successor: { package: data.successor.package, testedAgainst: [...data.successor.pass] } }
      : {}),
    testedOn: data.checkedOn,
  };
  const ran = `It was run for real against ${name} ${list(tested)} on ${data.checkedOn}: the real replacement passed and every deliberately wrong one failed.`;
  const later = ' Releases made after that date were not run.';
  const succ = data.successor
    ? ` The successor ${data.successor.package} was run at ${list(data.successor.pass)}.`
    : '';

  if (use.from === 'unknown' || use.text === undefined) {
    return {
      ...base,
      note: `${ran}${succ} The manifest names no version of ${name}, so the version that gets installed decides: if it is not in that list, treat a failure with care.${later}`,
    };
  }

  if (use.from === 'lockfile') {
    const v = use.text;
    const failed = bad.find((b) => b.version === v);
    if (failed) {
      return {
        ...base,
        covered: false,
        note: `${name} ${v} (from the lockfile) was run against this séance and does not fit it: ${failed.why} ${ran}${succ}`,
      };
    }
    if (exactIn(v, tested)) {
      return {
        ...base,
        covered: true,
        note: `${ran} The version in use, ${name} ${v} (from the lockfile), is one of them.${succ}${later}`,
      };
    }
    return {
      ...base,
      covered: false,
      note: `${name} ${v} (from the lockfile) is outside the versions this séance was run against. ${ran}${succ} On ${v} the séance may fail, or pass, for reasons that are not the replacement's: read it before you trust it.`,
    };
  }

  // A declared range, no lockfile.
  const range = use.text;
  const inside = tested.filter((v) => inRange(dep.ecosystem, range, v));
  const badInside = bad.filter((b) => inRange(dep.ecosystem, range, b.version));
  const untestedInside = data.untested.filter((v) => inRange(dep.ecosystem, range, v));
  if (badInside.length > 0) {
    return {
      ...base,
      covered: false,
      note: `The range ${range} (no lockfile) includes ${badInside.map((b) => `${name} ${b.version}`).join(', ')}, which this séance was run against and does not fit: ${badInside[0]?.why} ${ran}${succ}`,
    };
  }
  if (inside.length === 0 || untestedInside.length > 0) {
    return {
      ...base,
      covered: false,
      note: `The range ${range} (no lockfile) allows versions this séance was not run against${untestedInside.length > 0 ? ` (${list(untestedInside)})` : ''}. ${ran}${succ} The version that gets installed decides: pin it, or read the séance before you trust it.`,
    };
  }
  return {
    ...base,
    covered: true,
    note: `${ran} The range ${range} (no lockfile) allows ${list(inside)}, all of them among those; the version that gets installed is one of them.${succ}${later}`,
  };
}

/** What the bundle says about versions, for the generic template. */
export function genericVersions(
  dep: Pick<DependencyRef, 'ecosystem' | 'name' | 'spec' | 'resolved'> | undefined,
): SeanceVersions {
  const use = dep ? versionInUse(dep) : ({ from: 'unknown' } as VersionInUse);
  const name = dep?.name ?? 'the old package';
  return {
    package: name,
    testedAgainst: [],
    inUseFrom: use.from,
    ...(use.text ? { inUse: use.text } : {}),
    note: `The generic template was not run against any version of ${name}${use.text ? `, including the one in use (${use.text})` : ''}: its generators are guesses until you check them.`,
  };
}

/** The dependency of a recipe context, with defaults, whatever the context holds. */
export function depOfContext(
  ctx:
    | {
        diagnosis?: { dependency?: Partial<DependencyRef> } | undefined;
      }
    | undefined,
): Pick<DependencyRef, 'ecosystem' | 'name' | 'spec' | 'resolved'> {
  const dep = ctx?.diagnosis?.dependency;
  return {
    ecosystem: dep?.ecosystem === 'pypi' ? 'pypi' : 'npm',
    name: typeof dep?.name === 'string' ? dep.name : 'the old package',
    spec: typeof dep?.spec === 'string' ? dep.spec : '',
    ...(typeof dep?.resolved === 'string' ? { resolved: dep.resolved } : {}),
  };
}

/** The family of a version for recipes that differ by major version. */
export function majorInUse(
  dep: Pick<DependencyRef, 'ecosystem' | 'spec' | 'resolved'>,
): number | undefined {
  return versionInUse(dep).major;
}
