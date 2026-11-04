import type { Diagnosis, Successor } from '@necromancer/engine';

/** What the engine says for a package that its registry does not know. Never to be read as "alive". */
export const NOT_FOUND_TEXT = 'Not found on the registry (removed, private or misspelled). It was not checked; this is not the same as alive.';

export const BASIS_HARD = 'Hard signal: a fact from a source (deprecated, archived, advisory, yanked, gone).';
export const BASIS_HEURISTIC = 'Heuristic: a guess from staleness (an old release or a quiet repository), not a hard signal.';

/** Whether a verdict rests on a hard signal or on the abandoned heuristic, in words. A not-found package has no verdict to rest on. */
export function basisInfo(d: Diagnosis): { basis: 'hard' | 'heuristic' | null; label: string } {
  if (d.notFound) return { basis: null, label: NOT_FOUND_TEXT };
  if (d.verdict === 'alive') {
    const n = d.advisories.length;
    return {
      basis: null,
      label:
        n > 0
          ? `The package is maintained (no blocking signal), but ${n} known ${n === 1 ? 'vulnerability affects' : 'vulnerabilities affect'} the version in use. Upgrade it; this is not a resurrection.`
          : 'No blocking signal.',
    };
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
