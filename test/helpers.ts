import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AutopsyReport, Diagnosis, Engine, SourceId, Verdict } from '@necromancer/engine';
import type { ReadManifests } from '../src/manifests';
import type { Snapshot } from '../src/state';
import { VERDICT_ORDER } from '../src/verdict';

export function tmp(prefix = 'necro-test-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function project(files: Record<string, string> = { 'package.json': '{}' }): string {
  const dir = tmp('necro-proj-');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

export function diagnosisFor(key: string, verdict: Verdict): Diagnosis {
  const i = key.indexOf(':');
  const ecosystem = key.slice(0, i) as 'npm' | 'pypi';
  const name = key.slice(i + 1);
  return {
    dependency: { ecosystem, name, spec: '', direct: true, scope: 'main', declaredIn: 'package.json' },
    verdict,
    evidence:
      verdict === 'alive'
        ? []
        : [{ code: 'test', message: `${name} is ${verdict} (test evidence).`, source: 'npm' as SourceId }],
    advisories: verdict === 'zombie' ? ['GHSA-test-0000-0000'] : [],
    successors: [],
  };
}

export function reportFor(snapshot: Snapshot, unavailable: SourceId[] = []): AutopsyReport {
  const diagnoses = Object.entries(snapshot).map(([k, v]) => diagnosisFor(k, v));
  const summary = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const d of diagnoses) summary[d.verdict] += 1;
  return {
    subject: 'test',
    scannedAt: '2026-11-03T00:00:00.000Z',
    manifests: [{ kind: 'package.json', path: 'package.json' }],
    diagnoses,
    problems: [],
    unavailable: unavailable.map((source) => ({ source, reason: 'test outage' })),
    summary,
  };
}

/** An engine whose next autopsy answers come from a queue. */
export function scriptedEngine(
  ...answers: Array<{ snapshot: Snapshot; unavailable?: SourceId[] } | Error>
): Engine {
  const queue = [...answers];
  return {
    parseManifest: () => ({ dependencies: [], problems: [] }),
    diagnose: async () => [],
    resurrectionSpec: () => ({ 'requirements.md': '', 'design.md': '', 'tasks.md': '' }),
    async autopsy() {
      const next = queue.shift();
      if (next === undefined) throw new Error('scriptedEngine: no more answers');
      if (next instanceof Error) throw next;
      return reportFor(next.snapshot, next.unavailable);
    },
  };
}

export const fakeManifests = async (): Promise<ReadManifests> => ({
  files: [{ kind: 'package.json', path: 'package.json', content: '{}' }],
  problems: [],
});
