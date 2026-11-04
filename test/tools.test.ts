import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createStubEngine } from '../src/stub-engine';
import { Store } from '../src/store';
import { createToolServer } from '../src/tools';
import { project, tmp } from './helpers';

async function connect(note?: string) {
  const store = new Store(tmp());
  const server = createToolServer({
    engine: { name: 'stub', engine: createStubEngine({ now: () => new Date('2026-11-03T00:00:00Z') }), note },
    store,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
    return { isError: Boolean(r.isError), text, json: r.isError ? undefined : (JSON.parse(text) as any) };
  };
  return { client, call, store };
}

describe('MCP tools (R5)', () => {
  it('R5.1 lists the ten tools, each with a description and an input schema', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['autopsy', 'diagnose', 'graveyard', 'nightwatch_run', 'resurrection_spec', 'seance', 'successors', 'watch_add', 'watch_list', 'watch_remove'],
    );
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('R5.2/R5.3 diagnose answers through the engine interface and says the stub answered', async () => {
    const { call } = await connect();
    const r = await call('diagnose', {
      dependencies: [{ ecosystem: 'npm', name: 'request' }, { ecosystem: 'npm', name: 'express' }, { ecosystem: 'npm', name: 'never-heard-of-it' }],
    });
    expect(r.json.engine).toBe('stub');
    expect(r.json.diagnoses.map((d: any) => d.verdict)).toEqual(['zombie', 'alive', 'alive']);
    expect(r.json.diagnoses[0].advisories).toEqual(['GHSA-p8p7-x288-28g6']);
  });

  it('R5.2 successors lists ways out, best first', async () => {
    const { call } = await connect();
    const r = await call('successors', { ecosystem: 'npm', name: 'request' });
    expect(r.json.successors.map((s: any) => s.name)).toEqual(['fetch', 'got']);
  });

  it('R5.2 pypi names are normalised before lookup', async () => {
    const { call } = await connect();
    const r = await call('successors', { ecosystem: 'pypi', name: 'NOSE' });
    expect(r.json.verdict).toBe('dead');
  });

  it('R5.2 resurrection_spec returns the three Kiro spec files', async () => {
    const { call } = await connect();
    const r = await call('resurrection_spec', { ecosystem: 'npm', name: 'left-pad' });
    expect(Object.keys(r.json.spec)).toEqual(['requirements.md', 'design.md', 'tasks.md']);
    expect(r.json.spec['requirements.md']).toContain('left-pad');
    expect(r.json.successor.name).toBe('String.prototype.padStart');
  });

  it('R5.5 resurrection_spec refuses a successor the diagnosis does not list, and names the valid ones', async () => {
    const { call } = await connect();
    const r = await call('resurrection_spec', { ecosystem: 'npm', name: 'request', successor: 'axios' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Valid successors: fetch, got.');
  });

  it('live R5.1 a dead dependency with no successor gets a raise spec; naming "raise" or the package works too', async () => {
    const stub = createStubEngine();
    const noSuccessor = {
      ...stub,
      diagnose: async (deps: Parameters<typeof stub.diagnose>[0]) =>
        (await stub.diagnose(deps)).map((d) => ({ ...d, verdict: 'dead' as const, successors: [] })),
    };
    const server = createToolServer({ engine: { name: 'stub', engine: noSuccessor }, store: new Store(tmp()) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    for (const successor of [undefined, 'raise', 'array-flatten']) {
      const r = await client.callTool({
        name: 'resurrection_spec',
        arguments: { ecosystem: 'npm', name: 'array-flatten', ...(successor ? { successor } : {}) },
      });
      expect(r.isError, String(successor)).toBeFalsy();
      const body = JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
      expect(body.successor).toMatchObject({ name: 'array-flatten', kind: 'raise' });
      expect(Object.keys(body.spec)).toEqual(['requirements.md', 'design.md', 'tasks.md']);
    }
    const bad = await client.callTool({
      name: 'resurrection_spec',
      arguments: { ecosystem: 'npm', name: 'array-flatten', successor: 'lodash' },
    });
    expect(bad.isError).toBe(true);
  });

  it('R5.5 resurrection_spec refuses an alive dependency', async () => {
    const { call } = await connect();
    const r = await call('resurrection_spec', { ecosystem: 'npm', name: 'express' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/alive/);
  });

  it('R5.4 invalid input is a tool error, not a crash', async () => {
    const { call, client } = await connect();
    for (const [name, args] of [
      ['diagnose', { dependencies: [] }],
      ['diagnose', { dependencies: [{ ecosystem: 'cargo', name: 'x' }] }],
      ['successors', { ecosystem: 'npm' }],
      ['autopsy', {}],
      ['autopsy', { path: '/tmp', files: [] }],
      ['watch_add', { path: '/no/such/dir/necromancer' }],
    ] as const) {
      const r = await call(name, args as Record<string, unknown>);
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    // the server is still alive afterwards
    expect((await call('watch_list')).isError).toBe(false);
    await client.close();
  });

  it('R5.4 autopsy of a directory with no manifest is a tool error', async () => {
    const { call } = await connect();
    const r = await call('autopsy', { path: project({ 'README.md': 'x' }) });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No manifest/);
  });

  it('R5.2 autopsy reads a local directory and returns a report with a summary', async () => {
    const { call } = await connect();
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { 'left-pad': '1', moment: '2' }, devDependencies: { express: '4' } }),
      'requirements.txt': 'nose==1.3.7\nrequests>=2\n# comment\n',
    });
    const r = await call('autopsy', { path: dir });
    expect(r.json.report.summary).toEqual({ alive: 2, dying: 1, dead: 2, ghost: 0, zombie: 0 });
    expect(r.json.report.subject).toBe(`local:${dir}`);
  });

  it('R5.2 autopsy of supplied files reports unreadable parts as problems, without throwing', async () => {
    const { call } = await connect();
    const r = await call('autopsy', {
      files: [
        { kind: 'package.json', path: 'package.json', content: '{ broken' },
        { kind: 'pyproject.toml', path: 'pyproject.toml', content: '[project]' },
      ],
    });
    expect(r.json.report.problems).toHaveLength(2);
    expect(r.json.report.diagnoses).toEqual([]);
  });

  it('R5.3 reports why the real engine was not used', async () => {
    const { call } = await connect('Real engine unavailable, using the stub: test');
    const r = await call('successors', { ecosystem: 'npm', name: 'moment' });
    expect(r.json.note).toMatch(/Real engine unavailable/);
  });

  it('R3 watch_add, watch_list, watch_remove, graveyard and nightwatch_run work together', async () => {
    const { call } = await connect();
    const dir = project({ 'package.json': JSON.stringify({ dependencies: { 'left-pad': '1', moment: '2', express: '4' } }) });
    const added = await call('watch_add', { path: dir });
    expect(added.json.added).toBe(true);
    expect((await call('watch_add', { path: dir })).json.added).toBe(false);
    expect((await call('watch_list')).json.projects).toHaveLength(1);

    const run = await call('nightwatch_run');
    expect(run.json.projects[0].status).toBe('baseline');
    expect(run.json.notifications).toEqual([]);

    const yard = await call('graveyard');
    expect(yard.json.totals).toEqual({ alive: 1, dying: 1, dead: 1, ghost: 0, zombie: 0 });
    expect(yard.json.projects[0].tombstones.map((t: any) => t.name)).toEqual(['left-pad', 'moment']);
    expect(yard.json.projects[0].tombstones[0].successor.name).toBe('String.prototype.padStart');

    expect((await call('watch_remove', { id: added.json.id })).json.removed).toBe(true);
    const gone = await call('watch_remove', { id: added.json.id });
    expect(gone.isError).toBe(false);
    expect(gone.json.removed).toBe(false);
  });
});
