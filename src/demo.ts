import type { AutopsyReport, DependencyRef } from '@necromancer/engine';
import { fixtureDiagnosis } from './fixtures';
import type { WatchState, WatchedProject } from './state';
import { depKey } from './verdict';

/**
 * A demo graveyard built from the stub fixtures, so the page shows its layout
 * before anything is watched. The page always labels it as a demo (R2.4, R2.5).
 */
function dep(ecosystem: 'npm' | 'pypi', name: string, spec: string, file: string): DependencyRef {
  return { ecosystem, name, spec, direct: true, scope: 'main', declaredIn: file };
}

function demoProject(id: string, path: string, deps: DependencyRef[]): WatchedProject {
  const diagnoses = deps.map(fixtureDiagnosis);
  const summary = { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 };
  for (const d of diagnoses) summary[d.verdict] += 1;
  const report: AutopsyReport = {
    subject: `demo:${path}`,
    scannedAt: '2026-11-03T03:00:00.000Z',
    manifests: [],
    diagnoses,
    problems: [],
    unavailable: [],
    summary,
  };
  return {
    id,
    path,
    addedAt: '2026-11-01T00:00:00.000Z',
    lastScanAt: report.scannedAt,
    status: 'ok',
    snapshot: Object.fromEntries(diagnoses.map((d) => [depKey(d.dependency), d.verdict])),
    report,
  };
}

export function demoState(): WatchState {
  const a = demoProject('demo-web-shop', '~/demo/web-shop', [
    dep('npm', 'express', '^4.19.0', 'package.json'),
    dep('npm', 'request', '^2.88.2', 'package.json'),
    dep('npm', 'left-pad', '1.3.0', 'package.json'),
    dep('npm', 'moment', '^2.30.1', 'package.json'),
  ]);
  const b = demoProject('demo-data-jobs', '~/demo/data-jobs', [
    dep('pypi', 'requests', '>=2.31', 'requirements.txt'),
    dep('pypi', 'nose', '==1.3.7', 'requirements.txt'),
    dep('npm', 'fixture-ghost-lib', '^0.4.0', 'package.json'),
  ]);
  return { version: 1, projects: { [a.id]: a, [b.id]: b } };
}
