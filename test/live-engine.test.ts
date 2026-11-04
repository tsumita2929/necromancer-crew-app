import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '@necromancer/engine';
import type { Engine, ManifestFile } from '@necromancer/engine';
import { describe, expect, it } from 'vitest';
import { selectEngine } from '../src/engine-port';
import { readManifests } from '../src/manifests';
import { blockHosts } from '../src/real-engine';
import { runNightWatch } from '../src/nightwatch';
import { Store } from '../src/store';
import { createStubEngine } from '../src/stub-engine';
import { createToolServer } from '../src/tools';
import { project, tmp } from './helpers';
import { hauntedApp } from './paths';
import { recordedAt, recordedFetch } from './recorded-fetch';

const haunted = hauntedApp;

/**
 * The haunted app's manifest and lockfile, with the lockfile cut down to the three direct
 * packages. The real lockfile also lists request's ~50 transitive packages; the recorded
 * replay covers only the direct ones, and the live checks (crew-live.md) cover the rest.
 */
function directOnlyLock(): string {
  const lock = JSON.parse(readFileSync(path.join(haunted, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, unknown>;
  };
  const keep = new Set(['', 'node_modules/left-pad', 'node_modules/moment', 'node_modules/request']);
  lock.packages = Object.fromEntries(Object.entries(lock.packages).filter(([k]) => keep.has(k)));
  return JSON.stringify(lock);
}

function hauntedFiles(): ManifestFile[] {
  return [
    { kind: 'package.json', path: 'package.json', content: readFileSync(path.join(haunted, 'package.json'), 'utf8') },
    { kind: 'package-lock.json', path: 'package-lock.json', content: directOnlyLock() },
  ];
}

function realEngine(fetch = recordedFetch()): { engine: Engine; fetch: ReturnType<typeof recordedFetch> } {
  return { engine: createEngine({ fetch, now: () => recordedAt }, { sleep: async () => {} }), fetch };
}

describe('R1 the real engine on the haunted app (recorded responses, no network)', () => {
  it('R1.6 verdicts equal the engine\'s own recorded verdicts for the same packages and versions', async () => {
    const { engine, fetch } = realEngine();
    const report = await engine.autopsy({ subject: 'demo:haunted-app', files: hauntedFiles() });
    expect(fetch.missing).toEqual([]);
    const verdict = (n: string) => report.diagnoses.find((d) => d.dependency.name === n)?.verdict;
    // packages/engine/test/fixtures.test.ts: left-pad "dead", request "zombie" (advisory), moment "not flagged".
    expect(verdict('left-pad')).toBe('dead');
    expect(verdict('request')).toBe('zombie');
    expect(verdict('moment')).toBe('alive');
    const request = report.diagnoses.find((d) => d.dependency.name === 'request')!;
    expect(request.dependency).toMatchObject({ spec: '^2.88.2', resolved: '2.88.2', direct: true });
    expect(request.advisories.length).toBeGreaterThan(0);
    expect(report.unavailable).toEqual([]);
  });

  it('R1.1/R1.2 the MCP tools answer from the engine and say so', async () => {
    const { engine } = realEngine();
    const server = createToolServer({ engine: { name: 'engine', engine }, store: new Store(tmp()) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name, arguments: args })).content as Array<{ text: string }>)[0]!.text);

    const autopsy = await call('autopsy', { files: hauntedFiles() });
    expect(autopsy.engine).toBe('engine');
    expect(autopsy.report.summary).toMatchObject({ dead: 1, zombie: 1, alive: 1 });

    const succ = await call('successors', { ecosystem: 'npm', name: 'left-pad' });
    expect(succ.engine).toBe('engine');
    expect(succ.successors[0]).toMatchObject({ name: 'String.prototype.padStart', kind: 'native' });

    const spec = await call('resurrection_spec', { ecosystem: 'npm', name: 'left-pad' });
    expect(spec.engine).toBe('engine');
    expect(Object.keys(spec.spec)).toEqual(['requirements.md', 'design.md', 'tasks.md']);
    expect(spec.spec['requirements.md']).toContain('left-pad');

    const diag = await call('diagnose', { dependencies: [{ ecosystem: 'npm', name: 'request', spec: '2.88.2' }] });
    expect(diag.engine).toBe('engine');
    expect(diag.diagnoses[0].verdict).toBe('zombie');
  });
});

describe('R1.1/R1.3 engine selection', () => {
  it('R1.1 the real engine is the default', () => {
    const port = selectEngine({}, () => createStubEngine());
    expect(port.name).toBe('engine');
    expect(port.note).toBeUndefined();
  });

  it('R1.1 NECROMANCER_ENGINE=stub selects the stub', () => {
    const port = selectEngine({ NECROMANCER_ENGINE: 'stub' }, () => {
      throw new Error('must not be called');
    });
    expect(port.name).toBe('stub');
  });

  it('R1.3 an engine load failure falls back to the stub and names the cause', async () => {
    const port = selectEngine({}, () => {
      throw new Error('cannot load engine bundle');
    });
    expect(port.name).toBe('stub');
    expect(port.note).toBe('Real engine unavailable, using the stub: cannot load engine bundle');
    const server = createToolServer({ engine: port, store: new Store(tmp()) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: 'successors', arguments: { ecosystem: 'npm', name: 'left-pad' } });
    const body = JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
    expect(body.engine).toBe('stub');
    expect(body.note).toMatch(/cannot load engine bundle/);
  });

  it('NECROMANCER_BLOCK_HOSTS keeps a host out of reach without any network call, and lets the others through', async () => {
    const seen: string[] = [];
    const inner = (async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    }) as Parameters<typeof blockHosts>[0];
    const guarded = blockHosts(inner, 'API.github.com, ,example.org');
    const blocked = await guarded('https://api.github.com/repos/a/b');
    expect(blocked.status).toBe(403);
    expect(blocked.ok).toBe(false);
    expect((await guarded('https://example.org/x')).status).toBe(403);
    expect((await guarded('https://registry.npmjs.org/left-pad/latest')).status).toBe(200);
    expect(seen).toEqual(['https://registry.npmjs.org/left-pad/latest']);
    expect(blockHosts(inner, undefined)).toBe(inner);
  });

  it('R1.1 the default factory really builds the bundled engine', () => {
    const port = selectEngine({});
    expect(port.name).toBe('engine');
    expect(typeof port.engine.autopsy).toBe('function');
  });
});

describe('R4 Night Watch on the real engine', () => {
  it('R4.2 the nightwatch_run tool takes a fresh engine per run, so cached answers cannot hide a change', async () => {
    const dir = project({
      'package.json': readFileSync(path.join(haunted, 'package.json'), 'utf8'),
      'package-lock.json': directOnlyLock(),
    });
    let worse = false;
    const fetch = recordedFetch((url, rec) =>
      worse && url === 'https://registry.npmjs.org/moment/latest'
        ? { status: rec.status, body: { ...(rec.body as object), deprecated: 'Moment is deprecated.' } }
        : rec,
    );
    const create = () => realEngine(fetch).engine;
    const server = createToolServer({ engine: { name: 'engine', engine: create(), create }, store: new Store(tmp()) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(((await client.callTool({ name, arguments: args })).content as Array<{ text: string }>)[0]!.text);

    await call('watch_add', { path: dir });
    const first = await call('nightwatch_run');
    expect(first.engine).toBe('engine');
    expect(first.notifications).toEqual([]);
    worse = true;
    const second = await call('nightwatch_run');
    expect(second.notifications).toHaveLength(1);
    expect(second.notifications[0].title).toMatch(/^moment went from alive to /);
  });

  it('R4.1/R4.2 a baseline scan is silent; after one dependency gets worse, exactly one notification; then silence', async () => {
    const dir = project({
      'package.json': readFileSync(path.join(haunted, 'package.json'), 'utf8'),
      'package-lock.json': directOnlyLock(),
    });
    const store = new Store(tmp());
    await store.addProject(dir);

    let worse = false;
    const fetch = recordedFetch((url, rec) =>
      worse && url === 'https://registry.npmjs.org/moment/latest'
        ? { status: rec.status, body: { ...(rec.body as object), deprecated: 'Moment is deprecated. Use another library.' } }
        : rec,
    );
    // A fresh engine per run, as the nightwatch_run tool does (the engine caches answers per instance).
    const go = () =>
      runNightWatch({ store, engine: realEngine(fetch).engine, engineName: 'engine', readManifests, now: () => recordedAt });

    const baseline = await go();
    expect(baseline.engine).toBe('engine');
    expect(baseline.projects[0]?.status).toBe('baseline');
    expect(baseline.notifications).toEqual([]);
    expect((await go()).notifications).toEqual([]);

    worse = true;
    const after = await go();
    expect(fetch.missing).toEqual([]);
    expect(after.notifications).toHaveLength(1);
    expect(after.notifications[0]).toMatchObject({ kind: 'worse' });
    expect(after.notifications[0]?.title).toMatch(/^moment went from alive to (dead|ghost|zombie)$/);

    expect((await go()).notifications).toEqual([]);
  });
});
