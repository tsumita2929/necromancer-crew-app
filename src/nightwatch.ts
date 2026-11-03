import { promises as fs } from 'node:fs';
import type { AutopsyReport, Diagnosis, Engine, SourceId, Verdict } from '@necromancer/engine';
import type { ReadManifests } from './manifests';
import type { Snapshot, WatchedProject } from './state';
import type { Store } from './store';
import { depKey, rank, worse } from './verdict';

export interface Worsened {
  key: string;
  from: Verdict;
  to: Verdict;
}

/**
 * R4.2–R4.6: which dependencies got worse. Pure.
 * A missing `prev` is a first scan (baseline): nothing is worse.
 * A dependency absent from `prev` is compared with "alive".
 */
export function detectWorse(prev: Snapshot | undefined, cur: Snapshot): Worsened[] {
  if (prev === undefined) return [];
  const out: Worsened[] = [];
  for (const [key, to] of Object.entries(cur)) {
    const from = prev[key] ?? 'alive';
    if (rank(to) > rank(from)) out.push({ key, from, to });
  }
  return out;
}

/**
 * R4.8: the snapshot to store after a scan. The dependency set is always the
 * current one. When a source was unavailable, a verdict never goes down, because
 * missing evidence is not recovery. Pure.
 */
export function mergeSnapshot(prev: Snapshot | undefined, cur: Snapshot, partial: boolean): Snapshot {
  if (!partial || prev === undefined) return { ...cur };
  const out: Snapshot = {};
  for (const [key, to] of Object.entries(cur)) out[key] = worse(prev[key] ?? 'alive', to);
  return out;
}

/** One verdict per dependency: the worst across manifests. */
export function snapshotOf(report: AutopsyReport): Snapshot {
  const out: Snapshot = {};
  for (const d of report.diagnoses) {
    const key = depKey(d.dependency);
    out[key] = out[key] === undefined ? d.verdict : worse(out[key], d.verdict);
  }
  return out;
}

export interface Notification {
  kind: 'worse' | 'project-missing';
  projectId: string;
  title: string;
  body: string;
}

export interface ProjectResult {
  id: string;
  path: string;
  status: 'scanned' | 'baseline' | 'missing' | 'error';
  worsened: number;
  unavailable: SourceId[];
  message?: string;
}

export interface NightWatchResult {
  engine: 'stub' | 'engine';
  ranAt: string;
  projects: ProjectResult[];
  notifications: Notification[];
  /** Things the caller should mention, such as a recovered state file. */
  warnings: string[];
}

export interface NightWatchDeps {
  store: Store;
  engine: Engine;
  engineName: 'stub' | 'engine';
  readManifests: (dir: string) => Promise<ReadManifests>;
  now?: () => Date;
}

function worseNotification(p: WatchedProject, w: Worsened, d: Diagnosis | undefined): Notification {
  const name = w.key.slice(w.key.indexOf(':') + 1);
  const why = d?.evidence[0]?.message ?? 'No evidence line was recorded.';
  const successor = d?.successors[0];
  const way = successor ? ` Way out: ${successor.name} (${successor.kind}).` : '';
  return {
    kind: 'worse',
    projectId: p.id,
    title: `${name} went from ${w.from} to ${w.to}`,
    body: `${p.path}: ${why}${way} Ask the Necromancer agent to raise it.`,
  };
}

/** R4: re-scan every watched project and report what got worse. */
export async function runNightWatch(deps: NightWatchDeps): Promise<NightWatchResult> {
  const now = deps.now ?? (() => new Date());
  const result: NightWatchResult = {
    engine: deps.engineName,
    ranAt: now().toISOString(),
    projects: [],
    notifications: [],
    warnings: [],
  };

  const state = await deps.store.load();
  if (deps.store.recovered) result.warnings.push(deps.store.recovered);

  for (const watched of Object.values(state.projects)) {
    try {
      const row = await scanOne(watched, deps, now, result.notifications);
      result.projects.push(row);
    } catch (err) {
      const message = (err as Error).message;
      await deps.store.update((s) => {
        const p = s.projects[watched.id];
        if (p) {
          p.status = 'error';
          p.message = message;
        }
      });
      result.projects.push({
        id: watched.id,
        path: watched.path,
        status: 'error',
        worsened: 0,
        unavailable: [],
        message,
      });
    }
  }
  return result;
}

async function scanOne(
  watched: WatchedProject,
  deps: NightWatchDeps,
  now: () => Date,
  notifications: Notification[],
): Promise<ProjectResult> {
  const base = { id: watched.id, path: watched.path };

  const isDir = await fs
    .stat(watched.path)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!isDir) {
    // R4.9: keep the snapshot, tell the owner once when it first goes missing.
    const first = watched.status !== 'missing';
    await deps.store.update((s) => {
      const p = s.projects[watched.id];
      if (p) {
        p.status = 'missing';
        p.message = 'The project directory no longer exists.';
      }
    });
    if (first) {
      notifications.push({
        kind: 'project-missing',
        projectId: watched.id,
        title: 'A watched project is missing',
        body: `${watched.path} no longer exists. Night Watch keeps its last snapshot and will not repeat this notice. Remove it with watch_remove or restore the directory.`,
      });
    }
    return { ...base, status: 'missing', worsened: 0, unavailable: [], message: 'The project directory no longer exists.' };
  }

  const { files, problems } = await deps.readManifests(watched.path);
  if (files.length === 0) {
    throw new Error(
      problems.length > 0 ? problems.join(' ') : 'No package.json, package-lock.json, requirements.txt or pyproject.toml found.',
    );
  }
  const report = await deps.engine.autopsy({ subject: `local:${watched.path}`, files });
  const cur = snapshotOf(report);
  const partial = report.unavailable.length > 0;
  const worsened = detectWorse(watched.snapshot, cur);

  const byKey = new Map<string, Diagnosis>();
  for (const d of report.diagnoses) {
    const k = depKey(d.dependency);
    const seen = byKey.get(k);
    if (!seen || rank(d.verdict) > rank(seen.verdict)) byKey.set(k, d);
  }
  for (const w of worsened) notifications.push(worseNotification(watched, w, byKey.get(w.key)));

  const baseline = watched.snapshot === undefined;
  const next = mergeSnapshot(watched.snapshot, cur, partial);
  await deps.store.update((s) => {
    const p = s.projects[watched.id];
    if (!p) return;
    p.status = 'ok';
    delete p.message;
    p.lastScanAt = now().toISOString();
    p.snapshot = next;
    p.report = report;
  });

  return {
    ...base,
    status: baseline ? 'baseline' : 'scanned',
    worsened: worsened.length,
    unavailable: report.unavailable.map((u) => u.source),
  };
}
