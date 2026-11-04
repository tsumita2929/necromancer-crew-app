import type { Diagnosis, SeanceVersions, Successor } from '@necromancer/engine';

/** What the engine says for a package that its registry does not know. Never to be read as "alive". */
export const NOT_FOUND_TEXT = 'Not found on the registry (removed, private or misspelled). It was not checked; this is not the same as alive.';

export const BASIS_HARD = 'Hard signal: a fact from a source (deprecated, archived, advisory, yanked, gone).';
export const BASIS_HEURISTIC = 'Heuristic: a guess from staleness (an old release or a quiet repository), not a hard signal.';

/** Whether a verdict rests on a hard signal or on the abandoned heuristic, in words. A not-found package has no verdict to rest on. */
export function basisInfo(d: Diagnosis): { basis: 'hard' | 'heuristic' | null; label: string } {
  if (d.notFound) return { basis: null, label: NOT_FOUND_TEXT };
  if (d.verdict === 'alive') {
    const n = d.advisories.length;
    const up = upgradeNotice(d);
    const parts: string[] = [];
    if (up) parts.push(`The package is maintained (no blocking signal), but the version in use is ${up.kind}. ${up.text} This is an upgrade, not a resurrection.`);
    if (n > 0) {
      parts.push(
        `${up ? 'Also, ' : 'The package is maintained (no blocking signal), but '}${n} known ${n === 1 ? 'vulnerability affects' : 'vulnerabilities affect'} the version in use.${up ? '' : ' Upgrade it; this is not a resurrection.'}`,
      );
    }
    return { basis: null, label: parts.length > 0 ? parts.join(' ') : 'No blocking signal.' };
  }
  if (d.basis === 'heuristic') return { basis: 'heuristic', label: BASIS_HEURISTIC };
  if (d.basis === 'hard') return { basis: 'hard', label: BASIS_HARD };
  return { basis: null, label: 'The engine did not say whether this rests on a hard signal or a heuristic.' };
}

export const LOW_CONFIDENCE_TEXT =
  'Suggestion, low confidence: a plausible fit with a different API or scope, not a drop-in. Ask the person before using it.';

export function isLowConfidence(s: Pick<Successor, 'confidence'> | undefined): boolean {
  return s?.confidence === 'low';
}

/** A way out as the tools and the page show it: a low-confidence one reads as a suggestion. */
export function describeSuccessor<S extends Successor>(s: S): S & { isSuggestion: boolean; advice: string } {
  const low = isLowConfidence(s);
  return {
    ...s,
    isSuggestion: low,
    advice: low
      ? LOW_CONFIDENCE_TEXT
      : s.kind === 'raise'
        ? 'No maintained replacement is known: rebuild the small utility as code the project owns.'
        : `${s.kind === 'native' ? 'Built into the platform' : 'A maintained package'}${s.confidence ? ` (${s.confidence} confidence)` : ''}.`,
  };
}

/** One entry per vulnerability: the id the engine kept, and the other ids that name the same vulnerability. */
export function advisoryList(d: Diagnosis): Array<{ id: string; also: string[] }> {
  return d.advisories.map((id) => ({ id, also: d.advisoryAliases?.[id] ?? [] }));
}

/** "GHSA-x (also CVE-y, PYSEC-z)" for each vulnerability. */
export function advisoryText(d: Diagnosis, max = 3): string {
  const list = advisoryList(d);
  const shown = list.slice(0, max).map((a) => (a.also.length > 0 ? `${a.id} (also ${a.also.slice(0, 4).join(', ')}${a.also.length > 4 ? ', ...' : ''})` : a.id));
  return shown.join('; ') + (list.length > max ? `; and ${list.length - max} more` : '');
}

/** The repository-moved evidence, when the engine found one: not an end of life. */
export function movedNote(d: Diagnosis): { message: string; url?: string } | undefined {
  const e = d.evidence.find((x) => x.code === 'repo-moved');
  return e ? { message: e.message, ...(e.url ? { url: e.url } : {}) } : undefined;
}

/**
 * A deprecated (npm) or yanked (PyPI) version of a living package: an upgrade notice on an alive verdict,
 * never "dying" and never a reason to migrate. `text` is the engine's own sentence for where to go.
 */
export interface UpgradeNotice {
  kind: 'deprecated' | 'yanked';
  /** The version to move to, when the engine found one. */
  version?: string;
  sameMajor?: boolean;
  /** True when the target is older than the version in use. */
  older?: boolean;
  /** "Upgrade to 10.14.0 (another major version)." and the like. */
  text: string;
}

export function upgradeNotice(d: Diagnosis): UpgradeNotice | undefined {
  if (d.notFound || d.verdict !== 'alive') return undefined;
  const e = d.evidence.find((x) => x.code === 'version-deprecated' || x.code === 'version-yanked');
  if (!e) return undefined;
  const kind = e.code === 'version-yanked' ? 'yanked' : 'deprecated';
  const to = d.upgradeTo;
  if (!to) return { kind, text: 'No newer stable release that is not deprecated or yanked is known.' };
  const how = to.sameMajor ? 'same major version' : 'another major version';
  return {
    kind,
    version: to.version,
    sameMajor: to.sameMajor,
    ...(to.older ? { older: true } : {}),
    text: to.older
      ? `Use ${to.version} (${how}). It is older than the version in use: no newer stable release is free of deprecation or yanking.`
      : `Upgrade to ${to.version} (${how}).`,
  };
}

/** What the séance bundle says about the versions of the old package it was run against. */
export function versionsNote(v: SeanceVersions | undefined) {
  if (!v) return undefined;
  return {
    package: v.package,
    inUse: v.inUse ?? null,
    inUseFrom: v.inUseFrom,
    testedAgainst: v.testedAgainst,
    ...(v.doesNotFit && v.doesNotFit.length > 0 ? { doesNotFit: v.doesNotFit } : {}),
    covered: v.covered ?? null,
    ...(v.successor ? { successor: v.successor } : {}),
    ...(v.testedOn ? { testedOn: v.testedOn } : {}),
    note: v.note,
    /** True unless the version in use is known to be covered: say it to the person. */
    tellThePerson: v.covered !== true,
  };
}
