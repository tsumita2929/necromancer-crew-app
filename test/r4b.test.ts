import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '@necromancer/engine';
import type { Diagnosis, Engine, Evidence, Successor, Verdict } from '@necromancer/engine';
import { describe, expect, it } from 'vitest';
import { advisoryText, basisInfo, describeSuccessor, movedNote } from '../src/advice';
import { buildGraveyard } from '../src/graveyard';
import { runNightWatch } from '../src/nightwatch';
import type { WatchState } from '../src/state';
import { Store } from '../src/store';
import { createToolServer } from '../src/tools';
import { fakeManifests, project, reportFor, tmp } from './helpers';
import { hauntedApp } from './paths';
import { smallWorld, worldNow } from './small-world';
import { recordedAt, recordedFetch } from './recorded-fetch';

const hauntedSrc = path.join(hauntedApp, 'src');

interface Shape {
  verdict?: Verdict;
  notFound?: boolean;
  successors?: Successor[];
  advisories?: string[];
  aliases?: Record<string, string[]>;
  evidence?: Evidence[];
  basis?: 'hard' | 'heuristic';
}

/** The real scan and séance generator; the diagnosis is whatever the test says, so no network is needed. */
function engineShaped(shape: Shape): Engine {
  const real = createEngine({ fetch: recordedFetch(), now: () => recordedAt });
  return {
    ...real,
    diagnose: async (deps) =>
      deps.map(
        (dependency): Diagnosis => ({
          dependency,
          verdict: shape.verdict ?? 'dead',
          evidence: shape.evidence ?? [{ code: 'npm-deprecated', message: 'Deprecated (test).', source: 'npm' }],
          advisories: shape.advisories ?? [],
          ...(shape.aliases ? { advisoryAliases: shape.aliases } : {}),
          ...(shape.notFound ? { notFound: true } : {}),
          ...(shape.basis ? { basis: shape.basis } : {}),
          successors: shape.successors ?? [],
        }),
      ),
  };
}

const HIGH: Successor = { name: 'String.prototype.padStart', ecosystem: 'npm', kind: 'native', reason: 'built in', source: 'curated', confidence: 'high' };
const LOW: Successor = { name: 'padder-lite', ecosystem: 'npm', kind: 'package', reason: 'a plausible fit with another API', source: 'curated', confidence: 'low' };
const LOW2: Successor = { name: 'padder-two', ecosystem: 'npm', kind: 'package', reason: 'another plausible fit', source: 'curated', confidence: 'low' };

async function connect(engine: Engine) {
  const server = createToolServer({ engine: { name: 'engine', engine }, store: new Store(tmp()) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
    return { isError: Boolean(r.isError), text, json: r.isError ? undefined : (JSON.parse(text) as any) };
  };
  return { call, client };
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { encoding: 'utf8' });

function repoOn(branch: string): string {
  const dir = project({
    'package.json': '{"name":"x","dependencies":{"left-pad":"^1.3.0"}}',
    'src/receipt.js': readFileSync(path.join(hauntedSrc, 'receipt.js'), 'utf8'),
  });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  if (branch !== 'main') git(dir, 'switch', '-q', '-c', branch);
  return dir;
}

const dep = { ecosystem: 'npm', name: 'left-pad' } as const;

describe('item 1: a package the registry does not know (notFound)', () => {
  const shape: Shape = { verdict: 'alive', notFound: true, evidence: [{ code: 'registry-not-found', message: 'Not found: npm has no package named "left-pad".', source: 'npm' }] };

  it('diagnose and successors say "not found" in words, never alive-and-fine', async () => {
    const { call } = await connect(engineShaped(shape));
    const d = await call('diagnose', { dependencies: [dep] });
    expect(d.json.summaries[0].notFound).toBe(true);
    expect(d.json.summaries[0].notFoundText).toMatch(/not found on the registry \(removed, private or misspelled\)/i);
    expect(d.json.summaries[0].basis.label).toMatch(/not the same as alive/);
    const s = await call('successors', dep);
    expect(s.json.notFound).toBe(true);
    expect(s.json.notFoundText).toMatch(/removed, private or misspelled/);
    expect(s.json.basis.label).not.toBe('No blocking signal.');
  });

  it('resurrection_spec, seance and seance_write all refuse it and tell the agent to tell the person; nothing is written', async () => {
    const { call } = await connect(engineShaped(shape));
    const dir = repoOn('resurrect/left-pad');
    for (const tool of ['resurrection_spec', 'seance', 'seance_write']) {
      const r = await call(tool, { ...dep, path: dir });
      expect(r.isError, tool).toBe(true);
      expect(r.text, tool).toMatch(/not found on the npm registry \(removed, private or misspelled\)/);
      expect(r.text, tool).toMatch(/Do not migrate it\. Tell the person/);
    }
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('a not-found package that a caller names a successor for is still refused', async () => {
    const { call } = await connect(engineShaped({ ...shape, successors: [HIGH] }));
    const r = await call('resurrection_spec', { ...dep, successor: HIGH.name });
    expect(r.isError).toBe(true);
  });

  it('basisInfo of a not-found diagnosis has no basis and is not "No blocking signal"', () => {
    const d = { dependency: { ecosystem: 'npm', name: 'x' }, verdict: 'alive', notFound: true, evidence: [], advisories: [], successors: [] } as unknown as Diagnosis;
    expect(basisInfo(d)).toMatchObject({ basis: null });
    expect(basisInfo(d).label).toMatch(/Not found/);
  });
});

describe('item 2: a low-confidence way out is a suggestion', () => {
  it('successors marks it isSuggestion and says to ask; a high one is not a suggestion', async () => {
    const { call } = await connect(engineShaped({ successors: [HIGH, LOW] }));
    const r = await call('successors', dep);
    expect(r.json.successors[0]).toMatchObject({ name: HIGH.name, isSuggestion: false });
    expect(r.json.successors[1]).toMatchObject({ name: LOW.name, isSuggestion: true });
    expect(r.json.successors[1].advice).toMatch(/Suggestion, low confidence/);
    expect(r.json.successors[1].advice).toMatch(/Ask the person/);
    expect(r.json.note).toBeUndefined();
  });

  it('resurrection_spec flags needsConfirmation when the chosen way out is low, and not when it is high', async () => {
    const low = await connect(engineShaped({ successors: [LOW] }));
    const a = await low.call('resurrection_spec', dep);
    expect(a.json.needsConfirmation).toBe(true);
    expect(a.json.notes.join(' ')).toMatch(/Ask the person/);
    expect(a.json.successor.isSuggestion).toBe(true);
    const high = await connect(engineShaped({ successors: [HIGH, LOW] }));
    const b = await high.call('resurrection_spec', dep);
    expect(b.json.needsConfirmation).toBe(false);
    expect(b.json.notes).toEqual([]);
    const c = await high.call('resurrection_spec', { ...dep, successor: LOW.name });
    expect(c.json.needsConfirmation).toBe(true);
  });

  it('a list where every way out is low: shown as suggestions, the first is the default, and the agent is told to ask', async () => {
    const { call } = await connect(engineShaped({ successors: [LOW, LOW2] }));
    const s = await call('successors', dep);
    expect(s.json.successors.every((x: any) => x.isSuggestion)).toBe(true);
    expect(s.json.note).toMatch(/Every way out is low confidence/);
    const spec = await call('resurrection_spec', dep);
    expect(spec.json.successor.name).toBe(LOW.name);
    expect(spec.json.needsConfirmation).toBe(true);
    expect(spec.json.notes.join(' ')).toMatch(/Every listed way out is low confidence/);
  });

  it('seance (preview) flags it; seance_write refuses it until acceptLowConfidence=true, and writes nothing meanwhile', async () => {
    const { call } = await connect(engineShaped({ successors: [LOW] }));
    const dir = repoOn('resurrect/left-pad');
    const preview = await call('seance', { ...dep, path: dir });
    expect(preview.isError).toBe(false);
    expect(preview.json.needsConfirmation).toBe(true);
    expect(preview.json.successor.isSuggestion).toBe(true);

    const refused = await call('seance_write', { ...dep, path: dir });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/low-confidence/);
    expect(refused.text).toMatch(/Ask the person/);
    expect(refused.text).toMatch(/acceptLowConfidence=true/);
    expect(git(dir, 'status', '--porcelain')).toBe('');

    const no = await call('seance_write', { ...dep, path: dir, acceptLowConfidence: false });
    expect(no.isError).toBe(true);

    const yes = await call('seance_write', { ...dep, path: dir, acceptLowConfidence: true });
    expect(yes.isError).toBe(false);
    expect(yes.json.wrote).toBe(true);
    expect(yes.json.written.length).toBeGreaterThan(0);
  });

  it('a high-confidence way out needs no acceptLowConfidence', async () => {
    const { call } = await connect(engineShaped({ successors: [HIGH] }));
    const r = await call('seance_write', { ...dep, path: repoOn('resurrect/left-pad') });
    expect(r.isError).toBe(false);
    expect(r.json.needsConfirmation).toBe(false);
  });

  it('describeSuccessor words each confidence', () => {
    expect(describeSuccessor({ ...HIGH }).advice).toMatch(/Built into the platform \(high confidence\)/);
    expect(describeSuccessor({ ...LOW }).isSuggestion).toBe(true);
    expect(describeSuccessor({ name: 'x', ecosystem: 'npm', kind: 'raise', reason: 'r', source: 'curated' }).advice).toMatch(/rebuild/);
  });
});

describe('item 3: merged advisories show one id per vulnerability with the other ids', () => {
  const shape: Shape = {
    advisories: ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff'],
    aliases: { 'GHSA-aaaa-bbbb-cccc': ['CVE-2020-0001', 'PYSEC-2020-1'] },
  };

  it('diagnose, successors, resurrection_spec and seance list each vulnerability once with its other ids', async () => {
    const { call } = await connect(engineShaped({ ...shape, successors: [HIGH] }));
    const expected = [
      { id: 'GHSA-aaaa-bbbb-cccc', also: ['CVE-2020-0001', 'PYSEC-2020-1'] },
      { id: 'GHSA-dddd-eeee-ffff', also: [] },
    ];
    expect((await call('diagnose', { dependencies: [dep] })).json.summaries[0].advisories).toEqual(expected);
    expect((await call('successors', dep)).json.advisories).toEqual(expected);
    expect((await call('resurrection_spec', dep)).json.advisories).toEqual(expected);
    expect((await call('seance', { ...dep, path: repoOn('main') })).json.advisories).toEqual(expected);
  });

  it('an alive package with advisories says it is maintained but the version in use is affected', () => {
    const d = { verdict: 'alive', advisories: ['A', 'B'], evidence: [], successors: [] } as unknown as Diagnosis;
    expect(basisInfo(d).label).toMatch(/maintained.*2 known vulnerabilities affect the version in use/);
    expect(basisInfo({ ...d, advisories: [] } as Diagnosis).label).toBe('No blocking signal.');
  });

  it('advisoryText reads "id (also ...)" and cuts a long list', () => {
    const d = { advisories: ['A', 'B', 'C', 'D'], advisoryAliases: { A: ['X', 'Y'] } } as unknown as Diagnosis;
    expect(advisoryText(d)).toBe('A (also X, Y); B; C; and 1 more');
  });
});

describe('item 4: repo-moved reads well', () => {
  const moved: Evidence = { code: 'repo-moved', message: 'The repository was renamed to new-org/codemirror; that is not an end of life.', source: 'github', url: 'https://github.com/new-org/codemirror' };

  it('tools carry the moved note with its url', async () => {
    const { call } = await connect(engineShaped({ verdict: 'alive', evidence: [moved] }));
    const d = await call('diagnose', { dependencies: [dep] });
    expect(d.json.summaries[0].moved).toEqual({ message: moved.message, url: moved.url });
    expect((await call('successors', dep)).json.moved.message).toMatch(/renamed to new-org\/codemirror/);
  });

  it('movedNote is absent without the evidence', () => {
    expect(movedNote({ evidence: [] } as unknown as Diagnosis)).toBeUndefined();
  });

  it('a maintained package with a moved repository is a notice on the graveyard: no verdict count, no raise button data', () => {
    const state = stateWith([{ ...diag('npm', 'codemirror', 'alive'), evidence: [moved] }]);
    const view = buildGraveyard(state).projects[0]!;
    expect(view.counts.alive).toBe(1);
    expect(view.counts.dead + view.counts.dying + view.counts.ghost + view.counts.zombie).toBe(0);
    expect(view.tombstones).toHaveLength(1);
    expect(view.tombstones[0]).toMatchObject({ kind: 'notice', name: 'codemirror' });
    expect(view.tombstones[0]!.moved).toMatch(/renamed/);
    expect(view.tombstones[0]!.epitaph).toMatch(/not an end of life/);
  });
});

describe('item 5: the preview never writes; the write tool keeps its guards', () => {
  it('seance is read-only, has no write argument and is auto-approved; seance_write is neither', async () => {
    const { client } = await connect(engineShaped({ successors: [HIGH] }));
    const { tools } = await client.listTools();
    const seance = tools.find((t) => t.name === 'seance')!;
    const write = tools.find((t) => t.name === 'seance_write')!;
    expect(seance.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys((seance.inputSchema as any).properties)).not.toContain('write');
    expect(write.annotations?.readOnlyHint).not.toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
    expect(manifest.mcpServers.necromancer.autoApprove).toContain('seance');
    expect(manifest.mcpServers.necromancer.autoApprove).not.toContain('seance_write');
  });

  it('a stray write:true on the preview changes nothing (it is not an argument)', async () => {
    const { call } = await connect(engineShaped({ successors: [HIGH] }));
    const dir = repoOn('resurrect/left-pad');
    const r = await call('seance', { ...dep, path: dir, write: true });
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(existsSync(path.join(dir, 'seance'))).toBe(false);
    if (!r.isError) expect(r.json.wrote).toBe(false);
  });

  it('the preview leaves git status clean on a branch, on main, and on a dirty tree (and does not touch the dirty file)', async () => {
    const { call } = await connect(engineShaped({ successors: [HIGH] }));
    for (const branch of ['resurrect/left-pad', 'main']) {
      const dir = repoOn(branch);
      const r = await call('seance', { ...dep, path: dir });
      expect(r.isError).toBe(false);
      expect(r.json.wrote).toBe(false);
      expect(r.json.files.length).toBeGreaterThan(0);
      expect(git(dir, 'status', '--porcelain')).toBe('');
    }
    const dirty = repoOn('main');
    writeFileSync(path.join(dirty, 'src', 'receipt.js'), '// edited\n' + readFileSync(path.join(dirty, 'src', 'receipt.js'), 'utf8'));
    writeFileSync(path.join(dirty, 'untracked.txt'), 'x');
    const before = git(dirty, 'status', '--porcelain');
    expect(before).not.toBe('');
    const r = await call('seance', { ...dep, path: dirty });
    expect(r.isError).toBe(false);
    expect(git(dirty, 'status', '--porcelain')).toBe(before);
    expect(readFileSync(path.join(dirty, 'src', 'receipt.js'), 'utf8').startsWith('// edited')).toBe(true);
  });

  it('seance_write is refused on main, with nothing written', async () => {
    const { call } = await connect(engineShaped({ successors: [HIGH] }));
    const dir = repoOn('main');
    const r = await call('seance_write', { ...dep, path: dir });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/branch "main"/);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('seance_write writes on resurrect/left-pad and a second call changes nothing', async () => {
    const { call } = await connect(engineShaped({ successors: [HIGH] }));
    const dir = repoOn('resurrect/left-pad');
    const first = await call('seance_write', { ...dep, path: dir });
    expect(first.json.wrote).toBe(true);
    expect(first.json.branch).toBe('resurrect/left-pad');
    const second = await call('seance_write', { ...dep, path: dir });
    expect(second.json.written).toEqual([]);
  });
});

// ---- the graveyard view model and Night Watch -------------------------------------------------------------

function diag(ecosystem: 'npm' | 'pypi', name: string, verdict: Verdict, extra: Partial<Diagnosis> = {}): Diagnosis {
  return {
    dependency: { ecosystem, name, spec: '', direct: true, scope: 'main', declaredIn: 'package.json' },
    verdict,
    evidence: [],
    advisories: [],
    successors: [],
    ...extra,
  };
}

function stateWith(diagnoses: Diagnosis[]): WatchState {
  const report = { ...reportFor({}), diagnoses };
  return { version: 1, projects: { p1: { id: 'p1', path: '/work/p1', addedAt: '2026-11-01T00:00:00Z', status: 'ok', snapshot: {}, report } } };
}

describe('graveyard view model: notFound', () => {
  it('a not-found package is counted apart, never as alive, and listed after the verdicts', () => {
    const state = stateWith([
      diag('npm', 'ghost-pkg', 'alive', { notFound: true }),
      diag('npm', 'old', 'dead'),
      diag('npm', 'fine', 'alive'),
    ]);
    const g = buildGraveyard(state);
    const p = g.projects[0]!;
    expect(p.notFound).toBe(1);
    expect(p.counts.alive).toBe(1);
    expect(p.counts.dead).toBe(1);
    expect(g.totals.alive).toBe(1);
    expect(g.notFound).toBe(1);
    expect(p.tombstones.map((t) => [t.name, t.kind])).toEqual([
      ['old', 'verdict'],
      ['ghost-pkg', 'not-found'],
    ]);
    expect(p.tombstones[1]!.epitaph).toMatch(/not found on the registry \(removed, private or misspelled\)/i);
  });

  it('a project where every dependency is not found: zero alive, all listed as not found', () => {
    const state = stateWith([diag('npm', 'a', 'alive', { notFound: true }), diag('pypi', 'b', 'alive', { notFound: true })]);
    const p = buildGraveyard(state).projects[0]!;
    expect(p.notFound).toBe(2);
    expect(Object.values(p.counts).reduce((x, y) => x + y, 0)).toBe(0);
    expect(p.tombstones.every((t) => t.kind === 'not-found')).toBe(true);
  });

  it('a low-confidence best way out is marked as a suggestion on the tombstone', () => {
    const state = stateWith([diag('npm', 'old', 'dead', { successors: [LOW] })]);
    const t = buildGraveyard(state).projects[0]!.tombstones[0]!;
    expect(t.suggestion).toBe(true);
    expect(t.successorAdvice).toMatch(/Suggestion, low confidence/);
    const high = buildGraveyard(stateWith([diag('npm', 'old', 'dead', { successors: [HIGH] })])).projects[0]!.tombstones[0]!;
    expect(high.suggestion).toBe(false);
  });

  it('merged advisories reach the tombstone with their other ids', () => {
    const state = stateWith([diag('pypi', 'django', 'zombie', { advisories: ['GHSA-1'], advisoryAliases: { 'GHSA-1': ['CVE-1', 'PYSEC-1'] } })]);
    expect(buildGraveyard(state).projects[0]!.tombstones[0]!.advisoryList).toEqual([{ id: 'GHSA-1', also: ['CVE-1', 'PYSEC-1'] }]);
  });

  it('an alive package with advisories is a notice, not a tombstone with a verdict', () => {
    const state = stateWith([diag('npm', 'ok', 'alive', { advisories: ['GHSA-9'] })]);
    const t = buildGraveyard(state).projects[0]!.tombstones[0]!;
    expect(t.kind).toBe('notice');
    expect(t.epitaph).toMatch(/Maintained, but 1 known vulnerability affects/);
  });
});

describe('Night Watch: notFound', () => {
  function engineOf(...answers: Array<Diagnosis[]>): Engine {
    const queue = [...answers];
    return {
      parseManifest: () => ({ dependencies: [], problems: [] }),
      diagnose: async () => [],
      resurrectionSpec: () => ({ 'requirements.md': '', 'design.md': '', 'tasks.md': '' }),
      async autopsy() {
        const next = queue.shift();
        if (!next) throw new Error('no more answers');
        return { ...reportFor({}), diagnoses: next };
      },
    };
  }
  const run = (store: Store, engine: Engine) => runNightWatch({ store, engine, engineName: 'stub', readManifests: fakeManifests, now: () => new Date('2026-11-03T03:00:00Z') });

  it('a package that was found and is now not found gives one notification, then silence; it is never counted as alive', async () => {
    const store = new Store(tmp());
    const engine = engineOf(
      [diag('npm', 'a', 'dead'), diag('npm', 'b', 'alive')],
      [diag('npm', 'a', 'dead'), diag('npm', 'b', 'alive', { notFound: true })],
      [diag('npm', 'a', 'dead'), diag('npm', 'b', 'alive', { notFound: true })],
    );
    const { project: p } = await store.addProject(project());
    await run(store, engine);
    const second = await run(store, engine);
    expect(second.notifications.map((n) => n.kind)).toEqual(['not-found']);
    expect(second.notifications[0]!.title).toBe('b is not found on the registry');
    expect(second.notifications[0]!.body).toMatch(/removed, private or misspelled/);
    expect(second.projects[0]!.notFound).toBe(1);
    const third = await run(store, engine);
    expect(third.notifications).toEqual([]);
    expect((await store.load()).projects[p.id]!.notFound).toEqual(['npm:b']);
  });

  it('a package that is not found at the baseline gives no notification, and keeps no invented verdict', async () => {
    const store = new Store(tmp());
    const engine = engineOf([diag('npm', 'b', 'alive', { notFound: true })], [diag('npm', 'b', 'alive', { notFound: true })]);
    await store.addProject(project());
    expect((await run(store, engine)).notifications).toEqual([]);
    expect((await run(store, engine)).notifications).toEqual([]);
  });

  it('a project where every dependency is not found does not crash and notifies once when they vanish', async () => {
    const store = new Store(tmp());
    const gone = [diag('npm', 'a', 'alive', { notFound: true }), diag('pypi', 'b', 'alive', { notFound: true })];
    const engine = engineOf([diag('npm', 'a', 'alive'), diag('pypi', 'b', 'alive')], gone);
    await store.addProject(project());
    await run(store, engine);
    const r = await run(store, engine);
    expect(r.notifications).toHaveLength(2);
    expect(r.notifications.every((n) => n.kind === 'not-found')).toBe(true);
  });

  it('a package that was dead and is now not found keeps its stored verdict (no false recovery, no false alarm later)', async () => {
    const store = new Store(tmp());
    const engine = engineOf([diag('npm', 'a', 'dead')], [diag('npm', 'a', 'alive', { notFound: true })], [diag('npm', 'a', 'dead')]);
    const { project: p } = await store.addProject(project());
    await run(store, engine);
    await run(store, engine);
    expect((await store.load()).projects[p.id]!.snapshot).toEqual({ 'npm:a': 'dead' });
    expect((await run(store, engine)).notifications).toEqual([]);
  });
});

describe('the real engine through the tools, on a made-up registry (no network)', () => {
  const engine = () => createEngine({ fetch: smallWorld, now: () => worldNow }, { sleep: async () => {} });

  it('an unknown package is notFound; a moved repository carries repo-moved; two records of one vulnerability are one entry', async () => {
    const { call } = await connect(engine());
    const r = await call('diagnose', {
      dependencies: [
        { ecosystem: 'npm', name: 'no-such-pkg-zz', spec: '1.0.0' },
        { ecosystem: 'npm', name: 'moved-lib', spec: '1.0.0' },
        { ecosystem: 'npm', name: 'merge-lib', spec: '1.0.0' },
      ],
    });
    const [gone, moved, merged] = r.json.summaries;
    expect(gone.notFound).toBe(true);
    expect(gone.verdict).toBe('not-found');
    expect(gone.engineVerdict).toBe('alive');
    expect(moved.moved.message).toMatch(/moved|renamed/);
    expect(moved.verdict).not.toBe('dead');
    expect(merged.advisories).toHaveLength(1);
    expect(merged.advisories[0].also.sort()).toEqual(expect.arrayContaining(['CVE-2020-0001']));
  });

  it('the page view model of that scan counts the unknown package apart and keeps the moved one a notice', async () => {
    const eng = engine();
    const report = await eng.autopsy({
      subject: 'local:/work/x',
      files: [{ kind: 'package.json', path: 'package.json', content: JSON.stringify({ dependencies: { 'no-such-pkg-zz': '1.0.0', 'moved-lib': '1.0.0' } }) }],
    });
    const state: WatchState = { version: 1, projects: { p: { id: 'p', path: '/work/x', addedAt: '2026-11-01T00:00:00Z', status: 'ok', snapshot: {}, report } } };
    const p = buildGraveyard(state).projects[0]!;
    expect(p.notFound).toBe(1);
    expect(p.tombstones.find((t) => t.name === 'no-such-pkg-zz')?.kind).toBe('not-found');
    expect(p.tombstones.find((t) => t.name === 'moved-lib')?.moved).toBeTruthy();
    expect(p.counts.alive).toBe(1);
  });

  it('a project of unknown packages only: autopsy through the tool still answers', async () => {
    const { call } = await connect(engine());
    const dir = project({ 'package.json': '{"dependencies":{"no-such-a":"1.0.0","no-such-b":"1.0.0"}}' });
    const r = await call('autopsy', { path: dir });
    expect(r.isError).toBe(false);
    expect(r.json.report.diagnoses.every((d: any) => d.notFound === true)).toBe(true);
  });
});
