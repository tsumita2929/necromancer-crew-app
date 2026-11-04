/**
 * Turns facts from the sources into Evidence lines. Every threshold lives here.
 */

import type { Evidence, SourceId } from './types.js';
import type { UpgradeChoice } from './versions/upgrade.js';
import { repoUrl, type RepoRef } from './sources/repo.js';
import { nativeAlternativeSentence } from './native-alternatives.js';
import { clip } from './util/guards.js';

export const DAY_MS = 86_400_000;

export const THRESHOLDS = {
  /** Latest release this old or older: weak signal. */
  staleDays: 730,
  /** Latest release this old or older: dead when supported by another weak signal. */
  longDays: 1826,
  /** A release newer than this skips the repository lookups: it cannot be dying. */
  freshDays: 365,
  /**
   * No commit to the default branch for this long (or, when commits were not read, no push at all
   * for this long, which implies it): weak signal. The census hand check used the same year.
   */
  repoInactiveDays: 365,
  /** A commit to the default branch newer than this is a sign of life. */
  activeDays: 365,
  /** Scorecard Maintained at or below this is low. */
  scorecardLow: 2,
} as const;

export function ageInDays(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return undefined;
  return Math.floor((now.getTime() - time) / DAY_MS);
}

function years(days: number): string {
  const y = days / 365.25;
  return y >= 10 ? `${Math.floor(y)} years` : `${y.toFixed(1)} years`;
}

export function isoDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined;
}

type Line = Omit<Evidence, 'date' | 'url'> & {
  date?: string | undefined;
  url?: string | undefined;
};

function line(base: Line): Evidence {
  const out: Evidence = { code: base.code, message: base.message, source: base.source };
  if (base.url) out.url = base.url;
  const date = isoDay(base.date);
  if (date) out.date = date;
  return out;
}

export function npmDeprecated(
  message: string,
  source: SourceId,
  name: string,
  date?: string,
): Evidence {
  return line({
    code: 'npm-deprecated',
    message: `Deprecated on npm: "${clip(message, 160)}"`,
    source,
    url: `https://www.npmjs.com/package/${name}`,
    date,
  });
}

/** The sentence that says where to upgrade to; same text for deprecated and yanked versions. */
export function upgradeSentence(
  choice: UpgradeChoice | undefined,
  /** `engines.node` of the target: a string, null when the release declares none, undefined when unknown. */
  engines?: string | null,
): string {
  if (!choice) return 'No newer stable release that is not deprecated or yanked is known.';
  const { target, tier, declaredRange } = choice;
  const v = target.version;
  switch (tier) {
    case 'range':
      return `Upgrade to ${v}: the newest release inside your declared range (${clip(declaredRange ?? '', 80)}) that is not deprecated, so the manifest does not need to change.`;
    case 'same-major': {
      const where = declaredRange
        ? `, but outside your declared range (${clip(declaredRange, 80)}), so the range has to change`
        : '';
      return `Upgrade to ${v} (same major version${where}).`;
    }
    case 'next-major': {
      const where = declaredRange
        ? `, outside your declared range (${clip(declaredRange, 80)})`
        : '';
      const need =
        engines === null
          ? ' It declares no engines.node.'
          : engines
            ? ` Its engines.node is "${clip(engines, 80)}".`
            : ' Its engines.node could not be read.';
      return `Upgrade to ${v}: no release in this major version is free of the deprecation, and this is the next major version that has one${where}.${need}`;
    }
    default:
      return `Use ${v} (${target.sameMajor ? 'same major version' : 'another major version'}). It is older than the version in use: no newer stable release is free of deprecation or yanking.`;
  }
}

export function versionDeprecated(
  message: string,
  version: string,
  source: SourceId,
  name: string,
  choice?: UpgradeChoice,
  engines?: string | null,
): Evidence {
  return line({
    code: 'version-deprecated',
    message: `The version in use (${version}) is deprecated: "${clip(message, 140)}" The package itself is not; this is an upgrade notice. ${upgradeSentence(choice, engines)}${nativeAlternativeSentence(name)}`,
    source,
    url: `https://www.npmjs.com/package/${name}/v/${version}`,
  });
}

export function releaseAge(
  latestVersion: string,
  date: string | undefined,
  now: Date,
  source: SourceId,
  url: string,
  /** How the date was chosen, when that is not obvious (PyPI: the newest file counts). */
  dating?: string,
): Evidence | undefined {
  const days = ageInDays(date, now);
  if (days === undefined) return undefined;
  const rule = dating ? ` ${dating}` : '';
  if (days >= THRESHOLDS.longDays) {
    return line({
      code: 'no-release-long',
      message: `The latest release (${latestVersion}) is ${years(days)} old.${rule}`,
      source,
      url,
      date,
    });
  }
  if (days >= THRESHOLDS.staleDays) {
    return line({
      code: 'no-release',
      message: `The latest release (${latestVersion}) is ${years(days)} old.${rule}`,
      source,
      url,
      date,
    });
  }
  return undefined;
}

export function lowMaintenance(
  score: number,
  scorecardDate: string | undefined,
): Evidence | undefined {
  if (score > THRESHOLDS.scorecardLow) return undefined;
  return line({
    code: 'low-maintenance',
    message: `OpenSSF Scorecard rates maintenance ${score} out of 10 (shown, not decisive: the score lags).`,
    source: 'scorecard',
    url: 'https://securityscorecards.dev/',
    date: scorecardDate,
  });
}

export function repoArchived(repoUrl: string, pushedAt: string | undefined): Evidence {
  return line({
    code: 'repo-archived',
    message: 'The source repository is archived: read-only, no more fixes.',
    source: 'github',
    url: repoUrl,
    date: pushedAt,
  });
}

/**
 * Which date an activity claim rests on. A commit date is the default branch's latest commit. A
 * push date is when anything (any branch or tag) was last pushed, so the default branch's last
 * commit is at least that old: it proves a quiet repository, never an active one.
 */
export type ActivityDate = { kind: 'commit' | 'push'; date: string };

export function repoInactive(
  repoUrl: string,
  activity: ActivityDate,
  now: Date,
): Evidence | undefined {
  const days = ageInDays(activity.date, now);
  if (days === undefined || days < THRESHOLDS.repoInactiveDays) return undefined;
  const message =
    activity.kind === 'commit'
      ? `No commit to the default branch for ${years(days)} (last commit ${isoDay(activity.date)}).`
      : `No push to the repository for ${years(days)} (last push ${isoDay(activity.date)}); the default branch's last commit is at least that old. Commit dates were not read.`;
  return line({
    code: 'repo-inactive',
    message,
    source: 'github',
    url: repoUrl,
    date: activity.date,
  });
}

/** A commit to the default branch in the last year: a sign of life. */
export function recentActivity(
  repoUrl: string,
  commitDate: string,
  now: Date,
): Evidence | undefined {
  const days = ageInDays(commitDate, now);
  if (days === undefined || days >= THRESHOLDS.activeDays) return undefined;
  const when =
    days < 60 ? `${Math.max(days, 0)} days ago` : `${Math.round(days / 30.4)} months ago`;
  return line({
    code: 'recent-activity',
    message: `The default branch had a commit ${when} (${isoDay(commitDate)}), so stale signals alone do not make this dying.`,
    source: 'github',
    url: repoUrl,
    date: commitDate,
  });
}

/**
 * The verdict rests on staleness and the repository was pushed to within the year, but the
 * default branch's last commit could not be read. The verdict is the one without commit data.
 */
export function activityUnchecked(
  repoUrl: string,
  pushedAt: string,
  now: Date,
  why: string,
): Evidence {
  const days = ageInDays(pushedAt, now) ?? 0;
  const when =
    days < 60 ? `${Math.max(days, 0)} days ago` : `${Math.round(days / 30.4)} months ago`;
  return line({
    code: 'activity-unchecked',
    message: `The repository was pushed to ${when} (${isoDay(pushedAt)}), but the last commit on the default branch was not read (${clip(why, 100)}); it may be active, in which case this verdict overstates.`,
    source: 'github',
    url: repoUrl,
    date: pushedAt,
  });
}

export function repoGone(repoUrl: string, reason: string): Evidence {
  return line({
    code: 'repo-gone',
    message: `The source repository is gone: ${reason}.`,
    source: 'github',
    url: repoUrl,
  });
}

export function noRepository(source: SourceId): Evidence {
  return line({
    code: 'no-repository',
    message: 'No source repository is linked, so nobody can review or fix the code in the open.',
    source,
  });
}

export function pypiInactive(name: string): Evidence {
  return line({
    code: 'pypi-inactive',
    message: 'The project is marked "Development Status :: 7 - Inactive" on PyPI.',
    source: 'pypi',
    url: `https://pypi.org/project/${name}/`,
  });
}

export function pypiYanked(name: string, version: string, reason?: string): Evidence {
  return line({
    code: 'pypi-yanked',
    message: `The latest release (${version}) is yanked on PyPI${reason ? `: "${clip(reason, 120)}"` : ''}.`,
    source: 'pypi',
    url: `https://pypi.org/project/${name}/${version}/`,
  });
}

export function versionYanked(
  name: string,
  version: string,
  reason?: string,
  choice?: UpgradeChoice,
): Evidence {
  return line({
    code: 'version-yanked',
    message: `The version in use (${version}) is yanked on PyPI${reason ? `: "${clip(reason, 120)}"` : ''}. The project itself is not; this is an upgrade notice. ${upgradeSentence(choice)}`,
    source: 'pypi',
    url: `https://pypi.org/project/${name}/${version}/`,
  });
}

/**
 * The repository is not where the package metadata says. `renamed`: GitHub forwards the old address and
 * the lookup followed it. `readme`: the archived copy's README says the project moved, so "archived" is
 * not an end of life. Never a sign of death. `to` comes from a README or from GitHub: it is clipped and
 * only shown as text.
 */
export function repoMoved(repoUrl: string, to: string, how: 'renamed' | 'readme'): Evidence {
  const where = clip(to, 120);
  return line({
    code: 'repo-moved',
    message:
      how === 'renamed'
        ? `The repository was renamed or moved to ${where}; GitHub forwards the old address, so the lookup followed it.`
        : `The GitHub copy is archived because the project moved to ${where} (its README says so). That is not an end of life; activity at the new address is not read.`,
    source: 'github',
    url: repoUrl,
  });
}

/**
 * The repository was renamed to another package's name. GitHub forwards the old address, so the lookup
 * followed it, but what happens there is that package's life, not this one's.
 */
export function repoHoldsOtherPackage(
  oldUrl: string,
  newSlug: string,
  otherPackage: string,
  thisPackage: string,
): Evidence {
  return line({
    code: 'repo-moved',
    message: `The repository was renamed to ${clip(newSlug, 120)}, which now holds a different package, ${clip(otherPackage, 80)}. Its commits, archive state and Scorecard are ${clip(otherPackage, 80)}'s, not ${clip(thisPackage, 80)}'s, so they are not counted for it; ${clip(otherPackage, 80)} is its way out.`,
    source: 'github',
    url: oldUrl,
  });
}

/** Where the repository link came from, when that is not the usual place or the record names two repositories. */
export function repoLinkNote(message: string, repo: RepoRef): Evidence {
  return line({
    code: 'repo-link',
    message: clip(message, 400),
    source: 'pypi',
    url: repoUrl(repo),
  });
}

/** The README says, in the maintainers' words, that the project itself is deprecated or no longer maintained. */
export function readmeUnmaintained(sentence: string, url: string): Evidence {
  return line({
    code: 'readme-unmaintained',
    message: `The README of the repository says: "${clip(sentence, 160)}"`,
    source: 'readme',
    url,
  });
}

export function registryNotFound(source: SourceId, name: string): Evidence {
  return line({
    code: 'registry-not-found',
    message: `Not found: ${source === 'pypi' ? 'PyPI' : source === 'npm' ? 'the npm registry' : 'deps.dev'} has no package named "${clip(name, 80)}". It may be removed, private or misspelled; Necromancer cannot tell which.`,
    source,
  });
}

export function advisoryEvidence(ids: readonly string[], version: string): Evidence {
  const shown = ids.slice(0, 3).join(', ');
  const more = ids.length > 3 ? ` and ${ids.length - 3} more` : '';
  const first = ids[0] ?? '';
  return line({
    code: 'osv-advisory',
    message: `${ids.length} known ${ids.length === 1 ? 'advisory affects' : 'advisories affect'} version ${version}: ${shown}${more}.`,
    source: 'osv',
    url: `https://osv.dev/vulnerability/${encodeURIComponent(first)}`,
  });
}

export function unchecked(source: SourceId, reasons: string[]): Evidence {
  return line({
    code: 'unchecked',
    message: `Could not be checked: ${clip(reasons.join('; '), 200)}.`,
    source,
  });
}
