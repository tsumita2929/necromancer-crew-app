import type { Diagnosis, Successor, Verdict } from '@necromancer/engine';
import type { WatchState, WatchedProject } from './state';
import { depKey, rank } from './verdict';

export interface Tombstone {
  key: string;
  name: string;
  ecosystem: string;
  spec: string;
  verdict: Verdict;
  /** First evidence message, or a fallback so the line is never empty. */
  epitaph: string;
  advisories: string[];
  successor?: Successor;
}

export interface GraveyardProject {
  id: string;
  path: string;
  status: WatchedProject['status'];
  message?: string;
  lastScanAt?: string;
  baselineOnly: boolean;
  counts: Record<Verdict, number>;
  /** Non-alive dependencies, worst first, then by name. */
  tombstones: Tombstone[];
  unavailable: string[];
}

export interface Graveyard {
  projects: GraveyardProject[];
  totals: Record<Verdict, number>;
}

export function emptyCounts(): Record<Verdict, number> {
  return { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 };
}

function tombstone(d: Diagnosis): Tombstone {
  const first = d.evidence[0];
  return {
    key: depKey(d.dependency),
    name: d.dependency.name,
    ecosystem: d.dependency.ecosystem,
    spec: d.dependency.spec,
    verdict: d.verdict,
    epitaph: first ? first.message : `Marked ${d.verdict} with no recorded evidence.`,
    advisories: d.advisories,
    successor: d.successors[0],
  };
}

/** Pure view-model for the page and the `graveyard` tool. */
export function buildGraveyard(state: WatchState): Graveyard {
  const totals = emptyCounts();
  const projects: GraveyardProject[] = Object.values(state.projects)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((p) => {
      const counts = emptyCounts();
      const worst = new Map<string, Diagnosis>();
      for (const d of p.report?.diagnoses ?? []) {
        const k = depKey(d.dependency);
        const seen = worst.get(k);
        if (!seen || rank(d.verdict) > rank(seen.verdict)) worst.set(k, d);
      }
      for (const d of worst.values()) {
        counts[d.verdict] += 1;
        totals[d.verdict] += 1;
      }
      const tombstones = [...worst.values()]
        .filter((d) => d.verdict !== 'alive')
        .map(tombstone)
        .sort((a, b) => rank(b.verdict) - rank(a.verdict) || a.name.localeCompare(b.name));
      return {
        id: p.id,
        path: p.path,
        status: p.status,
        message: p.message,
        lastScanAt: p.lastScanAt,
        baselineOnly: p.snapshot === undefined,
        counts,
        tombstones,
        unavailable: (p.report?.unavailable ?? []).map((u) => u.source),
      };
    });
  return { projects, totals };
}
