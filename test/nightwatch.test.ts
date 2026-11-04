import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readManifests } from '../src/manifests';
import { runNightWatch } from '../src/nightwatch';
import { createStubEngine } from '../src/stub-engine';
import { Store } from '../src/store';
import type { Engine } from '@necromancer/engine';
import { fakeManifests, project, scriptedEngine, tmp } from './helpers';

function setup(engine: Engine) {
  const store = new Store(tmp());
  const run = () =>
    runNightWatch({ store, engine, engineName: 'stub', readManifests: fakeManifests, now: () => new Date('2026-11-03T03:00:00Z') });
  return { store, run };
}

describe('Night Watch nearby inputs (R4)', () => {
  it('R4.11 no watched projects: empty result, no notification', async () => {
    const { run } = setup(scriptedEngine());
    const r = await run();
    expect(r.projects).toEqual([]);
    expect(r.notifications).toEqual([]);
  });

  it('R4.9 a path that no longer exists: skipped, snapshot kept, one notification, then silence', async () => {
    const dir = project();
    const engine = scriptedEngine({ snapshot: { 'npm:a': 'alive' } });
    const { store, run } = setup(engine);
    const { project: p } = await store.addProject(dir);
    await run(); // baseline
    await fs.rm(dir, { recursive: true });

    const second = await run();
    expect(second.projects[0]?.status).toBe('missing');
    expect(second.notifications).toHaveLength(1);
    expect(second.notifications[0]?.kind).toBe('project-missing');
    expect((await store.load()).projects[p.id]?.snapshot).toEqual({ 'npm:a': 'alive' });

    const third = await run();
    expect(third.projects[0]?.status).toBe('missing');
    expect(third.notifications).toEqual([]);
  });

  it('R4.8 a source is unavailable: the partial scan does not lower a stored verdict, and lists the source', async () => {
    const engine = scriptedEngine(
      { snapshot: { 'npm:a': 'dead' } },
      { snapshot: { 'npm:a': 'alive' }, unavailable: ['npm'] }, // outage looks like recovery
      { snapshot: { 'npm:a': 'dead' } }, // source is back
    );
    const { store, run } = setup(engine);
    const { project: p } = await store.addProject(project());
    await run();
    const partial = await run();
    expect(partial.notifications).toEqual([]);
    expect(partial.projects[0]?.unavailable).toEqual(['npm']);
    expect((await store.load()).projects[p.id]?.snapshot).toEqual({ 'npm:a': 'dead' });
    const back = await run();
    expect(back.notifications).toEqual([]); // dead stays dead: no false alarm
  });

  it('R4.8 a partial scan that shows something worse still notifies', async () => {
    const engine = scriptedEngine(
      { snapshot: { 'npm:a': 'alive' } },
      { snapshot: { 'npm:a': 'dead' }, unavailable: ['osv'] },
    );
    const { store, run } = setup(engine);
    await store.addProject(project());
    await run();
    const r = await run();
    expect(r.notifications).toHaveLength(1);
  });

  it('R4.2 two scans with no change: no notification', async () => {
    const same = { 'npm:a': 'dying', 'npm:b': 'dead', 'pypi:c': 'alive' } as const;
    const { store, run } = setup(scriptedEngine({ snapshot: { ...same } }, { snapshot: { ...same } }, { snapshot: { ...same } }));
    await store.addProject(project());
    const first = await run();
    expect(first.projects[0]?.status).toBe('baseline');
    expect(first.notifications).toEqual([]);
    expect((await run()).notifications).toEqual([]);
    expect((await run()).notifications).toEqual([]);
  });

  it('R4.3 one dependency getting worse: exactly one notification, naming project, dependency and verdicts', async () => {
    const { store, run } = setup(
      scriptedEngine(
        { snapshot: { 'npm:a': 'alive', 'npm:b': 'dying', 'npm:c': 'dead' } },
        { snapshot: { 'npm:a': 'alive', 'npm:b': 'dead', 'npm:c': 'dead' } },
        { snapshot: { 'npm:a': 'alive', 'npm:b': 'dead', 'npm:c': 'dead' } },
      ),
    );
    const { project: p } = await store.addProject(project());
    await run();
    const r = await run();
    expect(r.notifications).toHaveLength(1);
    const n = r.notifications[0]!;
    expect(n.kind).toBe('worse');
    expect(n.title).toBe('b went from dying to dead');
    expect(n.body).toContain(p.path);
    expect(n.body).toContain('b is dead (test evidence).');
    // R4.7: the same state next run is silent.
    expect((await run()).notifications).toEqual([]);
  });

  it('R4.3 improving then worsening notifies again', async () => {
    const { store, run } = setup(
      scriptedEngine(
        { snapshot: { 'npm:a': 'dead' } },
        { snapshot: { 'npm:a': 'alive' } },
        { snapshot: { 'npm:a': 'dead' } },
      ),
    );
    await store.addProject(project());
    await run();
    expect((await run()).notifications).toEqual([]);
    expect((await run()).notifications).toHaveLength(1);
  });

  it('R4.6 a new dependency that arrives dead notifies; one that arrives alive does not', async () => {
    const { store, run } = setup(
      scriptedEngine(
        { snapshot: { 'npm:a': 'alive' } },
        { snapshot: { 'npm:a': 'alive', 'npm:new-dead': 'dead', 'npm:new-ok': 'alive' } },
      ),
    );
    await store.addProject(project());
    await run();
    const r = await run();
    expect(r.notifications.map((n) => n.title)).toEqual(['new-dead went from alive to dead']);
  });

  it('R4.10 one failing project does not stop the others', async () => {
    const engine = scriptedEngine(new Error('boom'), { snapshot: { 'npm:a': 'alive' } });
    const { store, run } = setup(engine);
    await store.addProject(project());
    await store.addProject(project());
    const r = await run();
    expect(r.projects.map((x) => x.status).sort()).toEqual(['baseline', 'error']);
    expect(r.projects.find((x) => x.status === 'error')?.message).toBe('boom');
  });

  it('R4.10 a project with no manifest is an error row, not a crash', async () => {
    const store = new Store(tmp());
    await store.addProject(project({ 'README.md': 'hi' }));
    const r = await runNightWatch({ store, engine: scriptedEngine(), engineName: 'stub', readManifests });
    expect(r.projects[0]?.status).toBe('error');
    expect(r.projects[0]?.message).toMatch(/No package\.json/);
  });

  it('R3.6 reports a recovered state file as a warning', async () => {
    const dir = tmp();
    await fs.writeFile(`${dir}/watch.json`, 'garbage');
    const store = new Store(dir);
    const r = await runNightWatch({ store, engine: scriptedEngine(), engineName: 'stub', readManifests: fakeManifests });
    expect(r.warnings[0]).toMatch(/unreadable/);
  });
});

describe('Night Watch end to end with real files and the stub engine', () => {
  it('R4.1 reads manifests from disk, baselines, then notifies when a dead dependency is added', async () => {
    const dir = project({ 'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } }) });
    const store = new Store(tmp());
    await store.addProject(dir);
    const deps = { store, engine: createStubEngine(), engineName: 'stub' as const, readManifests };

    const first = await runNightWatch(deps);
    expect(first.projects[0]?.status).toBe('baseline');
    expect(first.notifications).toEqual([]);

    await fs.writeFile(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { express: '^4.0.0', request: '^2.88.0', 'left-pad': '1.3.0' } }),
    );
    const second = await runNightWatch(deps);
    expect(second.notifications.map((n) => n.title).sort()).toEqual([
      'left-pad went from alive to dead',
      'request went from alive to zombie',
    ]);
    expect((await runNightWatch(deps)).notifications).toEqual([]);
  });
});

describe('readManifests', () => {
  it.skipIf(process.platform === 'win32')('R5.6 reads only the four manifest kinds and does not follow symbolic links', async () => {
    const outside = project({ 'package.json': '{"dependencies":{"secret":"1"}}' });
    const dir = project({
      'package.json': '{}',
      'apps/api/requirements.txt': 'requests==2.0\n',
      'notes.txt': 'ignore me',
      'node_modules/x/package.json': '{}',
    });
    await fs.symlink(outside, `${dir}/linked`);
    const { files } = await readManifests(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['apps/api/requirements.txt', 'package.json']);
  });
});
