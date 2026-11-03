import type { DependencyRef, Verdict } from '@necromancer/engine';

/**
 * Verdict order, healthiest first. This is a copy of `VERDICTS` from the shared
 * contract so that the UI bundle and the pure Night Watch core need no runtime
 * import of the engine. `test/contract.test.ts` fails if the two ever differ.
 */
export const VERDICT_ORDER: readonly Verdict[] = ['alive', 'dying', 'dead', 'ghost', 'zombie'];

export function rank(verdict: Verdict): number {
  return VERDICT_ORDER.indexOf(verdict);
}

export function worse(a: Verdict, b: Verdict): Verdict {
  return rank(a) >= rank(b) ? a : b;
}

/** Stable key for one dependency across scans: "npm:left-pad". */
export function depKey(dep: Pick<DependencyRef, 'ecosystem' | 'name'>): string {
  return `${dep.ecosystem}:${dep.name}`;
}

/** Symbol and word for a verdict, so colour is never the only carrier (R2.3). */
export const VERDICT_MARK: Record<Verdict, { symbol: string; label: string }> = {
  alive: { symbol: '✓', label: 'Alive' },
  dying: { symbol: '◐', label: 'Dying' },
  dead: { symbol: '✝', label: 'Dead' },
  ghost: { symbol: '◌', label: 'Ghost' },
  zombie: { symbol: '☣', label: 'Zombie' },
};
