import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '@necromancer/engine';
import type { Diagnosis, Engine, Verdict } from '@necromancer/engine';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { clientDiagnosis, clientReport, createToolServer } from '../src/tools';
import { project, tmp } from './helpers';
import { recordedAt, recordedFetch } from './recorded-fetch';

/** The invariant of QA-28: a client that reads only `verdict` never sees "alive" for a package the registry does not know. */
function engineWith(make: (name: string) => Partial<Diagnosis>): Engine {
  const real = createEngine({ fetch: recordedFetch(), now: () => recordedAt });
  const one = (dependency: Diagnosis['dependency']): Diagnosis => ({
    dependency,
    verdict: 'alive',
    evidence: [],
    advisories: [],
    successors: [],
    ...make(dependency.name),
  });
  return {
    ...real,
    diagnose: async (deps) => deps.map(one),
    autopsy: async (input) => {
      const deps = ['gone-pkg', 'old-pkg', 'fine-pkg'].map((name) => one({ ecosystem: 'npm', name, spec: '1.0.0', direct: true, scope: 'main', declaredIn: 'package.json' }));
      const summary = { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 } as Record<Verdict, number>;
      for (const d of deps) summary[d.verdict] += 1;
      return { subject: input.subject, scannedAt: '2026-11-03T00:00:00Z', manifests: [], diagnoses: deps, problems: [], unavailable: [], summary };
    },
  };
}
const shape = (name: string): Partial<Diagnosis> =>
  name === 'gone-pkg' ? { notFound: true, evidence: [{ code: 'registry-not-found', message: 'Not found', source: 'npm' }] } : name === 'old-pkg' ? { verdict: 'dead' } : {};

async function connect(engine: Engine) {
  const store = new Store(tmp());
  const server = createToolServer({ engine: { name: 'engine', engine }, store });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
    return { isError: Boolean(r.isError), text, json: r.isError ? undefined : (JSON.parse(text) as any) };
  };
  return { call, store };
}

const dep = (name: string) => ({ ecosystem: 'npm', name, spec: '1.0.0' });

describe('QA-28: a package the registry does not know never reads "alive" in a tool answer', () => {
  it('diagnose: verdict is "not-found" in the summaries and in the full records; the engine value is kept apart', async () => {
    const { call } = await connect(engineWith(shape));
    const r = await call('diagnose', { dependencies: [dep('gone-pkg'), dep('fine-pkg'), dep('old-pkg')] });
    const [gone, fine, old] = r.json.summaries;
    expect(gone).toMatchObject({ name: 'gone-pkg', verdict: 'not-found', engineVerdict: 'alive', notFound: true });
    expect(fine.verdict).toBe('alive');
    expect(fine.engineVerdict).toBeUndefined();
    expect(old.verdict).toBe('dead');
    expect(r.json.diagnoses.map((d: any) => d.verdict)).toEqual(['not-found', 'alive', 'dead']);
    expect(r.json.diagnoses[0].engineVerdict).toBe('alive');
  });

  it('successors: verdict "not-found"', async () => {
    const { call } = await connect(engineWith(shape));
    const r = await call('successors', { ecosystem: 'npm', name: 'gone-pkg' });
    expect(r.json).toMatchObject({ verdict: 'not-found', engineVerdict: 'alive', notFound: true, successors: [] });
  });

  it('autopsy: each record says "not-found", and the summary does not count it as alive', async () => {
    const { call } = await connect(engineWith(shape));
    const dir = project({ 'package.json': '{"dependencies":{"gone-pkg":"1.0.0"}}' });
    const r = await call('autopsy', { path: dir });
    expect(r.json.report.diagnoses.map((d: any) => [d.dependency.name, d.verdict])).toEqual([['gone-pkg', 'not-found'], ['old-pkg', 'dead'], ['fine-pkg', 'alive']]);
    expect(r.json.report.summary).toEqual({ alive: 1, dying: 0, dead: 1, ghost: 0, zombie: 0, notFound: 1 });
    const up = await call('autopsy', { files: [{ kind: 'package.json', path: 'package.json', content: '{}' }] });
    expect(up.json.report.summary.notFound).toBe(1);
    expect(up.json.report.summary.alive).toBe(1);
  });

  it('a plain client that reads only "verdict" never finds "alive" next to notFound, in any answer', async () => {
    const { call } = await connect(engineWith(shape));
    const dir = project({ 'package.json': '{"dependencies":{"gone-pkg":"1.0.0"}}' });
    const answers = [
      await call('diagnose', { dependencies: [dep('gone-pkg')] }),
      await call('successors', { ecosystem: 'npm', name: 'gone-pkg' }),
      await call('autopsy', { path: dir }),
    ];
    const walk = (v: unknown, hits: any[] = []): any[] => {
      if (Array.isArray(v)) v.forEach((x) => walk(x, hits));
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o.notFound === true) hits.push(o);
        Object.values(o).forEach((x) => walk(x, hits));
      }
      return hits;
    };
    let seen = 0;
    for (const a of answers) {
      for (const o of walk(a.json)) {
        if ('verdict' in o) {
          seen += 1;
          expect(o.verdict).toBe('not-found');
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  it('graveyard: a not-found row reads "not-found" and is not in any verdict count', async () => {
    const { call, store } = await connect(engineWith(shape));
    const dir = project({ 'package.json': '{"dependencies":{"gone-pkg":"1.0.0"}}' });
    await store.addProject(dir);
    await call('nightwatch_run', {});
    const g = (await call('graveyard', {})).json;
    const rows = g.projects[0].tombstones;
    const gone = rows.find((t: any) => t.name === 'gone-pkg');
    expect(gone).toMatchObject({ kind: 'not-found', verdict: 'not-found', engineVerdict: 'alive' });
    expect(g.projects[0].counts.alive).toBe(1);
    expect(g.notFound).toBe(1);
  });

  it('migration tools still refuse it, and say it was not found', async () => {
    const { call } = await connect(engineWith(shape));
    for (const tool of ['resurrection_spec', 'seance', 'seance_write']) {
      const r = await call(tool, { ecosystem: 'npm', name: 'gone-pkg', path: project({ 'package.json': '{}' }) });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/not found on the npm registry/);
    }
  });

  it('clientDiagnosis and clientReport leave found packages alone', () => {
    const d = { dependency: { ecosystem: 'npm', name: 'a' }, verdict: 'dying', evidence: [], advisories: [], successors: [] } as unknown as Diagnosis;
    expect(clientDiagnosis(d)).toBe(d);
    expect(clientReport({ diagnoses: [d], summary: { alive: 0, dying: 1, dead: 0, ghost: 0, zombie: 0 } } as any).summary).toEqual({ alive: 0, dying: 1, dead: 0, ghost: 0, zombie: 0, notFound: 0 });
  });

  it('the tool descriptions and the agent text use "not-found"', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(__dirname, '..');
    const skill = readFileSync(path.join(root, 'skills/resurrection/SKILL.md'), 'utf8');
    const prompt: string = JSON.parse(readFileSync(path.join(root, 'agents/necromancer.json'), 'utf8')).prompt;
    for (const t of [skill, prompt]) {
      expect(t).toContain('"not-found"');
      expect(t).toContain('engineVerdict');
    }
  });
});

describe('QA-31: the resurrection skill closes the open steps', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const skill = readFileSync(path.join(__dirname, '..', 'skills/resurrection/SKILL.md'), 'utf8');

  it('step 5: resurrection_spec returns text and writes nothing; the agent writes the three files', () => {
    expect(skill).toMatch(/\*\*returns text and writes no file\*\*/);
    expect(skill).toMatch(/keyed `requirements\.md`, `design\.md`, `tasks\.md`/);
  });

  it('step 7: a CommonJS default import gives a function; the import line becomes two lines; the stale replacement.mjs goes', () => {
    expect(skill).toContain('import mod from');
    expect(skill).toContain('const leftPad = mod.leftPad;');
    expect(skill).toMatch(/\*\*function\*\*, not an object/);
    expect(skill).toMatch(/delete the stale `seance\/<name>\/replacement\.mjs`/);
  });

  it('step 7: the only edits allowed in the séance are the import lines and the describe line', () => {
    expect(skill).toMatch(/The only edits you may make to `seance\/<name>\/seance\.test\.mjs` are/);
    expect(skill).toMatch(/Never touch the generators, the comparisons/);
  });

  it('step 7: adopting a project-owned replacement edits R3.1 and records the departure in design.md', () => {
    expect(skill).toContain('R3.1');
    expect(skill).toContain('Departure from the generated spec');
  });

  it('step 8: the recorder copies the generators; nothing moves out of the séance', () => {
    expect(skill).toMatch(/\*\*copies\*\* the séance's generators/);
    expect(skill).toMatch(/Do not move the generators out/);
    expect(skill).not.toMatch(/using the séance's own generators/);
    expect(skill).toContain('describe.skipIf(!old)');
  });

  it('names the replacement file, the unattended meaning, the failure sides, and the one script to add', () => {
    expect(skill).toContain('seance/<name>/replacement.mjs');
    expect(skill).toContain('Needs a person');
    expect(skill).toMatch(/A is the replacement's \(new\) outcome and B is the old package's/);
    expect(skill).toMatch(/this is the only script you add/);
    expect(skill).toMatch(/do not change `engines`/);
  });

  it('points to mcp-call --list and gives argument examples', () => {
    expect(skill).toContain('node scripts/mcp-call.mjs --list');
    expect(skill).toContain('{"dependencies":[{"ecosystem":"npm","name":"left-pad","spec":"1.3.0"}]}');
  });

  it('the codec in the skill round-trips the awkward values', async () => {
    const block = /`seance\/<name>\/codec\.mjs`:\n\n```js\n([\s\S]*?)```/.exec(skill);
    expect(block).not.toBeNull();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'skill-codec-'));
    const file = path.join(dir, 'codec.mjs');
    writeFileSync(file, block![1]!);
    const { encode, decode } = await import(file);
    const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
    const values: unknown[] = [undefined, NaN, -0, Infinity, -Infinity, 'x', null, [1, undefined, NaN], sparse, { a: undefined, b: [Infinity] }];
    for (const v of values) {
      const round = decode(JSON.parse(JSON.stringify(encode(v))));
      expect(Object.is(JSON.stringify(encode(round)), JSON.stringify(encode(v)))).toBe(true);
    }
    expect(Object.is(decode(JSON.parse(JSON.stringify(encode(-0)))), -0)).toBe(true);
    expect(1 in decode(JSON.parse(JSON.stringify(encode(sparse))))).toBe(false);
  });
});
