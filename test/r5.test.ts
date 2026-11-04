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
    expect(gone).toMatchObject({ kind: 'not-found', verdict: 'not-found', engineVerdict: 'alive', notFound: true });
    // QA-37b: every other row says notFound: false, so a client can read the field on any row
    expect(rows.filter((t: any) => t.name !== 'gone-pkg').every((t: any) => t.notFound === false)).toBe(true);
    expect(rows.every((t: any) => typeof t.notFound === 'boolean')).toBe(true);
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
    expect(skill).toMatch(/The only edits you\s+may make to `seance\/<name>\/seance\.test\.mjs` are/);
    expect(skill).toMatch(/Never touch the generators, the comparisons/);
  });

  it('step 7: adopting a project-owned replacement edits R3.1 and records the departure in design.md', () => {
    expect(skill).toContain('R3.1');
    expect(skill).toContain('Departure from the generated spec');
  });

  it('step 8: the recorder copies the generators; nothing moves out of the séance', () => {
    expect(skill).toMatch(/\*\*copies\*\* the séance's generators/);
    expect(skill).toMatch(/between the last `import` line and the first\s+`describe\(` line/);
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

describe('QA-31 round two: gaps the fresh agent still found are closed in the text', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const skill = readFileSync(path.join(__dirname, '..', 'skills/resurrection/SKILL.md'), 'utf8');
  it('says how to save the spec JSON to files, what `successor` and `spec` are, and where the inventory goes', () => {
    expect(skill).toContain('/tmp/spec.json');
    expect(skill).toMatch(/`successor` is the successor's `name`/);
    expect(skill).toMatch(/`spec` \(the version in use\) is optional/);
    expect(skill).toContain('"Usage inventory"');
  });
  it('says what to do with variable arguments, every spec sentence naming the successor, and the commit order', () => {
    expect(skill).toMatch(/use the values the\s+project's own tests and call sites give it/);
    expect(skill).toMatch(/Search all three spec files for the successor's name/);
    expect(skill).toMatch(/A sensible order of commits/);
  });
  it('names the copied region of the recorder and the old-package alias line', () => {
        expect(skill).toContain('const leftPadOld = old;');
  });
});

describe('QA-36: the skill matches every bundle shape', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const skill = readFileSync(path.join(__dirname, '..', 'skills/resurrection/SKILL.md'), 'utf8');
  it('finds the replacement and the test by role, not by name', () => {
    expect(skill).toMatch(/Find the replacement and the test by `role`/);
    expect(skill).toMatch(/whose `role` is `replacement`/);
  });
  it('names all four JavaScript shapes and where each replacement lives', () => {
    expect(skill).toContain('curated, **raise**');
    expect(skill).toContain('`src/vendor/<name>.mjs`');
    expect(skill).toMatch(/there is \*\*no\*\* `replacement\.mjs`/);
    expect(skill).toContain('querystring');
    expect(skill).toContain('seance-guard.mjs');
    expect(skill).toContain('`READY` and `members`');
  });
  it('says where the generators are even without the comment', () => {
    expect(skill).toMatch(/the generators are the top-level definitions between the last `import` line and the first\s+`describe\(` line/);
    expect(skill).toMatch(/strangeNumbers/);
  });
  it('says how to treat an .mjs module in a CommonJS project, and a generic bundle', () => {
    expect(skill).toMatch(/do not `require` an `\.mjs` file/);
    expect(skill).toContain('const isOdd = mod.isOdd;');
    expect(skill).toMatch(/thin adapter over the project-owned module/);
    expect(skill).toMatch(/\(c\) a comment that names a file you renamed/);
  });
  it('step 8: tags for values JSON cannot hold, loops over ranges, a recorder from an installed copy, and the loader line for createRequire', () => {
    expect(skill).toContain('`bigint`, `Symbol`, functions');
    expect(skill).toMatch(/loops over a range/);
    expect(skill).toMatch(/record from the installed copy/);
    expect(skill).toContain('`createRequire` load');
  });
});

describe('QA-36 round two: gaps the second fresh agent still found are closed in the text', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const skill = readFileSync(path.join(__dirname, '..', 'skills/resurrection/SKILL.md'), 'utf8');
  it('known differences are always written; a check the séance does not make is made with a throwaway module', () => {
    expect(skill).toMatch(/Always write the "Known behavioural differences" section/);
    expect(skill).toMatch(/throwaway module that re-exports the old package/);
    expect(skill).toMatch(/example tests or an attribution/);
  });
  it('the recorder drops the lines step 7 added, uses the séance\'s own outcome, and never uses eval', () => {
    expect(skill).toMatch(/lines you added in step 7/);
    expect(skill).toMatch(/use the séance's own `outcome`/);
    expect(skill).toMatch(/Do not rebuild a function with `eval`/);
  });
  it('the séance README is fixed after the removal', () => {
    expect(skill).toMatch(/After step 9, fix the sentences of `seance\/<name>\/README\.md`/);
  });
});
