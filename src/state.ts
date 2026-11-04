import type { AutopsyReport, Verdict } from '@necromancer/engine';

/** One verdict per dependency, keyed "ecosystem:name". */
export type Snapshot = Record<string, Verdict>;

export type ProjectStatus = 'ok' | 'missing' | 'error';

export interface WatchedProject {
  /** sha1(resolved path).slice(0, 12) */
  id: string;
  /** Absolute path of the watched directory. */
  path: string;
  addedAt: string;
  lastScanAt?: string;
  status: ProjectStatus;
  /** Why the last run could not scan it, when status is not "ok". */
  message?: string;
  /** Verdicts stored by the last scan. Absent until the first scan (baseline). */
  snapshot?: Snapshot;
  /** Dependencies ("npm:name") the registry did not know at the last scan. */
  notFound?: string[];
  /** The last report, rendered by the Graveyard page. */
  report?: AutopsyReport;
}

export interface WatchState {
  version: 1;
  projects: Record<string, WatchedProject>;
}
