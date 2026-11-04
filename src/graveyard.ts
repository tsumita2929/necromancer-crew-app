import type { Diagnosis, Successor, Verdict } from '@necromancer/engine';
import { advisoryList, describeSuccessor, isLowConfidence, movedNote, NOT_FOUND_TEXT, upgradeNotice, type UpgradeNotice } from './advice';
import type { WatchState, WatchedProject } from './state';
import { depKey, rank } from './verdict';

export interface Tombstone {
  key: string;
  name: string;
  ecosystem: string;
  spec: string;
  verdict: Verdict;
  /**
   * - verdict:   a non-alive dependency;
   * - not-found: the registry does not know the package (never counted as alive);
   * - notice:    a maintained package with something to know (advisories, a moved repository, or a
   *             deprecated or yanked version in use: an upgrade notice, never a death).
   */
  kind: 'verdict' | 'not-found' | 'notice';
  /** True for a package the registry does not know (the same fact as `kind: 'not-found'`, for a client that reads fields). */
  notFound: boolean;
  /** First evidence message, or a fallback so the line is never empty. */
  epitaph: string;
  /** One id per vulnerability (the engine merges records that name the same one). */
  advisories: string[];
  /** The same, with the other ids of each vulnerability. */
  advisoryList: Array<{ id: string; also: string[] }>;
  successor?: Successor;
  /** True when the best way out is a low-confidence suggestion. */
  suggestion?: boolean;
  /** Words for the way out, e.g. "Suggestion, low confidence: ...". */
  successorAdvice?: string;
  /** The repository moved: not an end of life. */
  moved?: string;
  /** The version in use is deprecated or yanked; the package is alive. Say where to upgrade to. */
  upgrade?: UpgradeNotice;
  /** A fact from a source, or a guess from staleness. Absent when the engine did not say. */
  basis?: 'hard' | 'heuristic';
}

export interface GraveyardProject {
  id: string;
  path: string;
  status: WatchedProject['status'];
  message?: string;
  lastScanAt?: string;
  baselineOnly: boolean;
  /** Verdict counts. A package the registry does not know is NOT counted as alive; see `notFound`. */
  counts: Record<Verdict, number>;
  /** Packages the registry does not know (removed, private or misspelled). */
  notFound: number;
  /** Non-alive dependencies worst first, then the not-found ones, then notices. */
  tombstones: Tombstone[];
  /** How many of the tombstones rest on the abandoned heuristic rather than a hard signal. */
  heuristicCount: number;
  unavailable: string[];
}

export interface Graveyard {
  projects: GraveyardProject[];
  totals: Record<Verdict, number>;
  /** Packages the registry does not know, over all projects. */
  notFound: number;
}

export function emptyCounts(): Record<Verdict, number> {
  return { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 };
}

function tombstone(d: Diagnosis, kind: Tombstone['kind']): Tombstone {
  const first = d.evidence[0];
  const best = d.successors[0];
  const moved = movedNote(d);
  const list = advisoryList(d);
  const upgrade = upgradeNotice(d);
  const epitaph =
    kind === 'not-found'
      ? NOT_FOUND_TEXT
      : kind === 'notice'
        ? [
            list.length > 0 ? `Maintained, but ${list.length} known ${list.length === 1 ? 'vulnerability affects' : 'vulnerabilities affect'} the version in use.` : '',
            moved ? 'The repository moved; that is not an end of life.' : '',
            upgrade ? `The package is maintained, but the version in use is ${upgrade.kind}. ${upgrade.text}` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : first
          ? first.message
          : `Marked ${d.verdict} with no recorded evidence.`;
  return {
    key: depKey(d.dependency),
    name: d.dependency.name,
    ecosystem: d.dependency.ecosystem,
    spec: d.dependency.spec,
    verdict: d.verdict,
    kind,
    notFound: kind === 'not-found',
    epitaph,
    advisories: d.advisories,
    advisoryList: list,
    ...(best ? { successor: best, suggestion: isLowConfidence(best), successorAdvice: describeSuccessor(best).advice } : {}),
    ...(moved ? { moved: moved.message } : {}),
    ...(upgrade && kind === 'notice' ? { upgrade } : {}),
    ...(d.basis && kind === 'verdict' ? { basis: d.basis } : {}),
  };
}

/** Pure view-model for the page and the `graveyard` tool. */
export function buildGraveyard(state: WatchState): Graveyard {
  const totals = emptyCounts();
  let totalNotFound = 0;
  const projects: GraveyardProject[] = Object.values(state.projects)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((p) => {
      const counts = emptyCounts();
      const worst = new Map<string, Diagnosis>();
      for (const d of p.report?.diagnoses ?? []) {
        const k = depKey(d.dependency);
        const seen = worst.get(k);
        if (!seen || rank(d.verdict) > rank(seen.verdict) || (d.notFound && !seen.notFound && rank(d.verdict) === rank(seen.verdict))) {
          worst.set(k, d);
        }
      }
      let notFound = 0;
      for (const d of worst.values()) {
        if (d.notFound) {
          notFound += 1;
          totalNotFound += 1;
          continue; // never counted as alive
        }
        counts[d.verdict] += 1;
        totals[d.verdict] += 1;
      }
      const all = [...worst.values()];
      const byName = (a: Tombstone, b: Tombstone) => a.name.localeCompare(b.name);
      const verdicts = all
        .filter((d) => !d.notFound && d.verdict !== 'alive')
        .map((d) => tombstone(d, 'verdict'))
        .sort((a, b) => rank(b.verdict) - rank(a.verdict) || byName(a, b));
      const notFounds = all.filter((d) => d.notFound).map((d) => tombstone(d, 'not-found')).sort(byName);
      const notices = all
        .filter((d) => !d.notFound && d.verdict === 'alive' && (d.advisories.length > 0 || movedNote(d) || upgradeNotice(d)))
        .map((d) => tombstone(d, 'notice'))
        .sort(byName);
      const tombstones = [...verdicts, ...notFounds, ...notices];
      return {
        id: p.id,
        path: p.path,
        status: p.status,
        message: p.message,
        lastScanAt: p.lastScanAt,
        baselineOnly: p.snapshot === undefined,
        counts,
        notFound,
        tombstones,
        heuristicCount: verdicts.filter((t) => t.basis === 'heuristic').length,
        unavailable: (p.report?.unavailable ?? []).map((u) => u.source),
      };
    });
  return { projects, totals, notFound: totalNotFound };
}
