/**
 * The verdict rules. Pure: evidence in, verdict, basis and ordered evidence out.
 *
 * Two kinds of evidence move a verdict.
 *
 * Evidence of death only ever moves it later in VERDICTS: each rule tests whether a code is
 * present, and adding a code can turn a test from false to true, never the other way
 * (requirement R2.2, checked by `test/properties/verdict.property.test.ts`).
 *
 * A deprecated or yanked version in use (`version-deprecated`, `version-yanked`) is evidence about the
 * version, not the package. It is shown and moves nothing (requirement R2.11, amended in round 4b). A
 * package whose latest release is deprecated or yanked is a different fact (`npm-deprecated`,
 * `pypi-yanked`), and that one ends its life.
 *
 * Evidence of life (`recent-activity`: a commit to the default branch in the last year) can only
 * move a verdict earlier, and only the verdicts that rest on staleness. It never lifts a verdict
 * that rests on a hard signal, and it does nothing when an advisory affects the version in use
 * (requirements R2.16 and R2.17 of the tuning spec).
 */

import type { Evidence, Verdict } from './types.js';

/**
 * - gone:        the source repository is gone (ghost).
 * - strong:      a fact from a source that ends a package's life: deprecated, archived, inactive,
 *                yanked, or the README saying the project is no longer maintained (dead, `basis` hard).
 * - derived:     the abandoned guess (dead, `basis` heuristic): a very old release and nothing that
 *                shows care. Not a hard signal: never describe it as an end of life that is certain.
 * - notice:      a fact about the version in use: it is deprecated (npm) or yanked (PyPI). An upgrade
 *                notice. Shown, never changes the verdict: signals about the package decide whether it
 *                is alive, signals about the version in use (this, an advisory) do not.
 * - conditional: counts as death only together with a supporting signal (see `decide`).
 * - weak:        a stale signal (dying).
 * - support:     shown, and counts only as support for `no-release-long`; never causes dying alone.
 *                A Scorecard score belongs here: it lags and does not decide a verdict by itself.
 * - advisory:    a known advisory; turns dead into zombie, never causes death.
 * - life:        a sign of life; lifts staleness-only verdicts back to alive.
 * - info:        shown, never changes the verdict. A package the registry does not know
 *                (`registry-not-found`) is here: nothing was examined, so nothing is claimed.
 */
export type EvidenceClass =
  | 'gone'
  | 'strong'
  | 'derived'
  | 'notice'
  | 'conditional'
  | 'weak'
  | 'support'
  | 'advisory'
  | 'life'
  | 'info';

export const EVIDENCE_CLASS: Readonly<Record<string, EvidenceClass>> = {
  'repo-gone': 'gone',
  'npm-deprecated': 'strong',
  'repo-archived': 'strong',
  'readme-unmaintained': 'strong',
  'pypi-inactive': 'strong',
  'pypi-yanked': 'strong',
  abandoned: 'derived',
  'registry-not-found': 'info',
  'version-deprecated': 'notice',
  'version-yanked': 'notice',
  'no-release-long': 'conditional',
  'no-release': 'weak',
  'repo-inactive': 'weak',
  'low-maintenance': 'support',
  'no-repository': 'support',
  'osv-advisory': 'advisory',
  'recent-activity': 'life',
  'activity-unchecked': 'info',
  'repo-moved': 'info',
  'repo-link': 'info',
  unchecked: 'info',
};

const RANK: Record<EvidenceClass, number> = {
  gone: 0,
  strong: 1,
  derived: 2,
  notice: 3,
  conditional: 4,
  weak: 5,
  support: 6,
  advisory: 7,
  life: 8,
  info: 9,
};

/** Signals that, next to a very old latest release, count as abandonment. */
export const CORROBORATION = ['low-maintenance', 'repo-inactive', 'no-repository'] as const;

/** On what a non-alive verdict rests (see `Diagnosis.basis`). */
export type Basis = 'hard' | 'heuristic';

export function classOf(code: string): EvidenceClass {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_CLASS, code)
    ? (EVIDENCE_CLASS[code] as EvidenceClass)
    : 'info';
}

export interface Decision {
  verdict: Verdict;
  /** Absent for alive. */
  basis?: Basis;
  /** Deduplicated by code, most important first, with derived lines added. */
  evidence: Evidence[];
}

export function decide(
  input: readonly Evidence[] | null | undefined,
  advisories: readonly string[] | null | undefined,
): Decision {
  input = Array.isArray(input) ? input : [];
  advisories = Array.isArray(advisories) ? advisories : [];
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  for (const line of input) {
    if (seen.has(line.code)) continue;
    seen.add(line.code);
    evidence.push(line);
  }
  const has = (code: string): boolean => seen.has(code);
  const hasAdvisory = advisories.length > 0 || has('osv-advisory');
  // Life lifts staleness-only verdicts. An advisory against the version in use takes precedence.
  const lifted = has('recent-activity') && !hasAdvisory;

  const support = CORROBORATION.filter(has);
  const long = evidence.find((e) => e.code === 'no-release-long');
  if (long && support.length > 0 && !has('abandoned') && !lifted) {
    seen.add('abandoned');
    evidence.push({
      code: 'abandoned',
      message: `Abandoned (a heuristic, not a hard signal): ${lowerFirst(long.message)} and nothing shows it is still looked after (${support.map(describe).join(', ')}).`,
      source: long.source,
      ...(long.date ? { date: long.date } : {}),
    });
  }

  const classes = new Set(evidence.map((e) => classOf(e.code)));
  const hard = classes.has('strong') || classes.has('gone');
  const deadClass = hard || classes.has('derived');
  // Derived abandonment from an input that carried `abandoned` itself is dropped when life lifts it.
  const dead = deadClass && !(lifted && !hard && classes.has('derived'));

  let verdict: Verdict;
  let basis: Basis | undefined;
  if (dead && hasAdvisory) {
    // The basis follows the evidence of the death, not the advisory: a zombie whose death rests on the
    // abandoned rule is heuristic; the advisory stays in the evidence as the hard fact (round 5).
    verdict = 'zombie';
    basis = hard ? 'hard' : 'heuristic';
  } else if (classes.has('gone')) {
    verdict = 'ghost';
    basis = 'hard';
  } else if (dead) {
    verdict = 'dead';
    basis = hard ? 'hard' : 'heuristic';
  } else if (!lifted && (classes.has('weak') || classes.has('conditional'))) {
    verdict = 'dying';
    basis = 'heuristic';
  } else {
    verdict = 'alive';
  }

  // When life is what keeps a package alive, it is the first line: it answers "why not dying?".
  const rank = (code: string): number =>
    verdict === 'alive' && lifted && classOf(code) === 'life' ? -1 : RANK[classOf(code)];
  const ordered = evidence
    .map((line, index) => ({ line, index }))
    .sort((a, b) => rank(a.line.code) - rank(b.line.code) || a.index - b.index)
    .map((x) => x.line);
  return basis ? { verdict, basis, evidence: ordered } : { verdict, evidence: ordered };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, '');
}

function describe(code: string): string {
  switch (code) {
    case 'low-maintenance':
      return 'low OpenSSF Maintained score';
    case 'repo-inactive':
      return 'no commits for a year';
    default:
      return 'no source repository';
  }
}
