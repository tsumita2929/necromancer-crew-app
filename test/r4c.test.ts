import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '@necromancer/engine';
import type { Diagnosis, Engine, Evidence, SeanceVersions, Successor, UpgradeTarget, Verdict } from '@necromancer/engine';
import { describe, expect, it } from 'vitest';
import { basisInfo, upgradeNotice, versionsNote } from '../src/advice';
import { buildGraveyard } from '../src/graveyard';
import { runNightWatch } from '../src/nightwatch';
import type { WatchState } from '../src/state';
import { Store } from '../src/store';
import { createToolServer } from '../src/tools';
import { fakeManifests, project, reportFor, tmp } from './helpers';
import { hauntedApp } from './paths';
import { recordedAt, recordedFetch } from './recorded-fetch';

const hauntedSrc = path.join(hauntedApp, 'src');

const deprecated = (v = '8.57.1'): Evidence => ({ code: 'version-deprecated', message: `The version in use (${v}) is deprecated: "x" The package itself is not; this is an upgrade notice.`, source: 'npm' });
const yanked = (v = '2.0.0'): Evidence => ({ code: 'version-yanked', message: `The version in use (${v}) is yanked on PyPI.`, source: 'pypi' });

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

const up = (version: string, extra: Partial<UpgradeTarget> = {}): UpgradeTarget => ({ version, sameMajor: true, ...extra });

describe('upgradeNotice: a deprecated or yanked version of a living package', () => {
  it('reads "Upgrade to <version>" with the major in words', () => {
    expect(upgradeNotice(diag('npm', 'a', 'alive', { evidence: [deprecated()], upgradeTo: up('8.57.2') }))).toMatchObject({
      kind: 'deprecated',
      version: '8.57.2',
      sameMajor: true,
      text: 'Upgrade to 8.57.2 (same major version).',
    });
    const other = upgradeNotice(diag('npm', 'a', 'alive', { evidence: [deprecated()], upgradeTo: up('10.14.0', { sameMajor: false }) }))!;
    expect(other.text).toBe('Upgrade to 10.14.0 (another major version).');
    expect(other.older).toBeUndefined();
  });

  it('an older target says it is older and why', () => {
    const n = upgradeNotice(diag('npm', 'codemirror', 'alive', { evidence: [deprecated('6.0.3')], upgradeTo: up('6.0.2', { older: true }) }))!;
    expect(n.older).toBe(true);
    expect(n.text).toMatch(/^Use 6\.0\.2 \(same major version\)\. It is older than the version in use/);
    expect(n.text).not.toMatch(/^Upgrade/);
  });

  it('no target: says none is known, without inventing a version', () => {
    const n = upgradeNotice(diag('npm', 'a', 'alive', { evidence: [deprecated()] }))!;
    expect(n.version).toBeUndefined();
    expect(n.text).toMatch(/No newer stable release that is not deprecated or yanked is known/);
  });

  it('a yanked PyPI version is named yanked', () => {
    expect(upgradeNotice(diag('pypi', 'p', 'alive', { evidence: [yanked()], upgradeTo: up('2.0.1') }))!.kind).toBe('yanked');
  });

  it('is absent without the evidence, for a non-alive verdict and for a package the registry does not know', () => {
    expect(upgradeNotice(diag('npm', 'a', 'alive'))).toBeUndefined();
    expect(upgradeNotice(diag('npm', 'a', 'dead', { evidence: [deprecated()], upgradeTo: up('2.0.0') }))).toBeUndefined();
    expect(upgradeNotice(diag('npm', 'a', 'alive', { evidence: [deprecated()], notFound: true }))).toBeUndefined();
  });

  it('basisInfo of an alive notice says upgrade, not resurrection; with an advisory it says both', () => {
    const d = diag('npm', 'glob', 'alive', { evidence: [deprecated()], upgradeTo: up('14.0.3', { sameMajor: false }), advisories: ['GHSA-1'] });
    const label = basisInfo(d).label;
    expect(label).toMatch(/version in use is deprecated\. Upgrade to 14\.0\.3 \(another major version\)\. This is an upgrade, not a resurrection\./);
    expect(label).toMatch(/Also, 1 known vulnerability affects the version in use/);
    expect(basisInfo(diag('npm', 'a', 'alive', { evidence: [deprecated()], upgradeTo: up('1.0.1') })).label).not.toMatch(/Also/);
  });
});

// ---- tools -----------------------------------------------------------------------------------------------

interface Shape {
  verdict?: Verdict;
  upgradeTo?: UpgradeTarget;
  evidence?: Evidence[];
  advisories?: string[];
  successors?: Successor[];
}

function engineShaped(shape: Shape): Engine {
  const real = createEngine({ fetch: recordedFetch(), now: () => recordedAt });
  return {
    ...real,
    diagnose: async (deps) =>
      deps.map(
        (dependency): Diagnosis => ({
          dependency,
          verdict: shape.verdict ?? 'alive',
          evidence: shape.evidence ?? [deprecated()],
          advisories: shape.advisories ?? [],
          ...(shape.upgradeTo ? { upgradeTo: shape.upgradeTo } : {}),
          successors: shape.successors ?? [],
        }),
      ),
  };
}

async function connect(engine: Engine) {
  const server = createToolServer({ engine: { name: 'engine', engine }, store: new Store(tmp()) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
    return { isError: Boolean(r.isError), text, json: r.isError ? undefined : (JSON.parse(text) as any) };
  };
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { encoding: 'utf8' });

function repoOn(branch: string, files?: Record<string, string>): string {
  const dir = project(
    files ?? {
      'package.json': '{"name":"x","dependencies":{"left-pad":"^1.3.0"}}',
      'src/receipt.js': readFileSync(path.join(hauntedSrc, 'receipt.js'), 'utf8'),
    },
  );
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  if (branch !== 'main') git(dir, 'switch', '-q', '-c', branch);
  return dir;
}

const eslint = { ecosystem: 'npm', name: 'eslint', spec: '8.57.1' } as const;

describe('item 1: tool answers', () => {
  it('diagnose: alive with an "upgrade" entry in words, never dying, nothing to migrate', async () => {
    const call = await connect(engineShaped({ upgradeTo: up('10.14.0', { sameMajor: false }) }));
    const r = await call('diagnose', { dependencies: [eslint] });
    const s = r.json.summaries[0];
    expect(s.verdict).toBe('alive');
    expect(s.upgrade).toMatchObject({ kind: 'deprecated', version: '10.14.0', sameMajor: false, text: 'Upgrade to 10.14.0 (another major version).' });
    expect(s.nothingToMigrate).toMatch(/do not migrate or raise/);
    expect(s.basis.label).toMatch(/Upgrade to 10\.14\.0/);
    expect(r.json.diagnoses[0].upgradeTo).toEqual({ version: '10.14.0', sameMajor: false });
  });

  it('diagnose: an older target and a missing target', async () => {
    const older = await connect(engineShaped({ upgradeTo: up('6.0.2', { older: true }) }));
    expect((await older('diagnose', { dependencies: [eslint] })).json.summaries[0].upgrade.text).toMatch(/^Use 6\.0\.2 .*older than the version in use/);
    const none = await connect(engineShaped({}));
    const s = (await none('diagnose', { dependencies: [eslint] })).json.summaries[0];
    expect(s.upgrade.version).toBeUndefined();
    expect(s.upgrade.text).toMatch(/No newer stable release/);
  });

  it('diagnose: no notice on a plain alive package', async () => {
    const call = await connect(engineShaped({ evidence: [] }));
    const s = (await call('diagnose', { dependencies: [eslint] })).json.summaries[0];
    expect(s.upgrade).toBeUndefined();
    expect(s.basis.label).toBe('No blocking signal.');
  });

  it('diagnose: an upgrade notice together with an advisory shows both, once each', async () => {
    const call = await connect(engineShaped({ upgradeTo: up('14.0.3', { sameMajor: false }), advisories: ['GHSA-aaaa-bbbb-cccc'] }));
    const s = (await call('diagnose', { dependencies: [{ ecosystem: 'npm', name: 'glob', spec: '11.0.3' }] })).json.summaries[0];
    expect(s.verdict).toBe('alive');
    expect(s.upgrade.version).toBe('14.0.3');
    expect(s.advisories).toEqual([{ id: 'GHSA-aaaa-bbbb-cccc', also: [] }]);
    expect(s.basis.label).toMatch(/Upgrade to 14\.0\.3.*Also, 1 known vulnerability/s);
  });

  it('successors: alive, the upgrade, and no ways out to offer', async () => {
    const call = await connect(engineShaped({ upgradeTo: up('8.57.2') }));
    const r = await call('successors', eslint); // the version in use is the "spec"
    expect((await call('successors', { ecosystem: 'npm', name: 'eslint' })).json.verdict).toBe('alive');
    expect(r.json.verdict).toBe('alive');
    expect(r.json.upgrade.text).toBe('Upgrade to 8.57.2 (same major version).');
    expect(r.json.nothingToMigrate).toBeDefined();
    expect(r.json.successors).toEqual([]);
  });

  it('resurrection_spec, seance and seance_write refuse it: upgrade, do not migrate; nothing is written', async () => {
    const call = await connect(engineShaped({ upgradeTo: up('10.14.0', { sameMajor: false }) }));
    const dir = repoOn('resurrect/eslint', { 'package.json': '{"dependencies":{"eslint":"8.57.1"}}' });
    for (const tool of ['resurrection_spec', 'seance', 'seance_write']) {
      const r = await call(tool, { ecosystem: 'npm', name: 'eslint', path: dir });
      expect(r.isError, tool).toBe(true);
      expect(r.text, tool).toMatch(/eslint is alive: the package is maintained and only the version in use is deprecated\. Upgrade to 10\.14\.0 \(another major version\)\./);
      expect(r.text, tool).toMatch(/nothing to migrate; tell the person to upgrade, and do not raise it/);
    }
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('a plain alive package keeps the old refusal', async () => {
    const call = await connect(engineShaped({ evidence: [] }));
    const r = await call('resurrection_spec', { ecosystem: 'npm', name: 'x' });
    expect(r.text).toMatch(/is alive; there is nothing to resurrect/);
  });
});

// ---- the graveyard and the page ---------------------------------------------------------------------------

function stateWith(diagnoses: Diagnosis[]): WatchState {
  const report = { ...reportFor({}), diagnoses };
  return { version: 1, projects: { p1: { id: 'p1', path: '/work/p1', addedAt: '2026-11-01T00:00:00Z', status: 'ok', snapshot: {}, report } } };
}

describe('item 1: the graveyard view model', () => {
  it('an upgrade notice is a notice row on an alive package: counted alive, not dying, nothing to raise', () => {
    const p = buildGraveyard(
      stateWith([
        diag('npm', 'eslint', 'alive', { evidence: [deprecated()], upgradeTo: up('10.14.0', { sameMajor: false }) }),
        diag('npm', 'old', 'dead'),
      ]),
    ).projects[0]!;
    expect(p.counts).toMatchObject({ alive: 1, dead: 1, dying: 0 });
    const t = p.tombstones.find((x) => x.name === 'eslint')!;
    expect(t.kind).toBe('notice');
    expect(t.verdict).toBe('alive');
    expect(t.upgrade).toMatchObject({ version: '10.14.0', sameMajor: false });
    expect(t.epitaph).toMatch(/maintained, but the version in use is deprecated\. Upgrade to 10\.14\.0 \(another major version\)\./);
    expect(p.tombstones.map((x) => x.kind)).toEqual(['verdict', 'notice']);
  });

  it('with an advisory too, one row carries both', () => {
    const t = buildGraveyard(stateWith([diag('npm', 'glob', 'alive', { evidence: [deprecated()], upgradeTo: up('14.0.3', { sameMajor: false }), advisories: ['GHSA-1'] })])).projects[0]!.tombstones;
    expect(t).toHaveLength(1);
    expect(t[0]!.advisoryList).toEqual([{ id: 'GHSA-1', also: [] }]);
    expect(t[0]!.upgrade?.version).toBe('14.0.3');
    expect(t[0]!.epitaph).toMatch(/1 known vulnerability affects/);
    expect(t[0]!.epitaph).toMatch(/Upgrade to 14\.0\.3/);
  });

  it('an older target and a yanked PyPI version', () => {
    const rows = buildGraveyard(
      stateWith([
        diag('npm', 'codemirror', 'alive', { evidence: [deprecated('6.0.3')], upgradeTo: up('6.0.2', { older: true }) }),
        diag('pypi', 'p', 'alive', { evidence: [yanked()], upgradeTo: up('2.0.1') }),
      ]),
    ).projects[0]!.tombstones;
    expect(rows.find((r) => r.name === 'codemirror')!.upgrade?.older).toBe(true);
    expect(rows.find((r) => r.name === 'p')!.upgrade?.kind).toBe('yanked');
  });

  it('a deprecated latest release (dead) is a verdict row, not a notice', () => {
    const t = buildGraveyard(stateWith([diag('npm', 'a', 'dead', { evidence: [{ code: 'npm-deprecated', message: 'Deprecated', source: 'npm' }] })])).projects[0]!.tombstones[0]!;
    expect(t.kind).toBe('verdict');
    expect(t.upgrade).toBeUndefined();
  });
});

// ---- Night Watch ------------------------------------------------------------------------------------------

describe('item 1: Night Watch', () => {
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
  const run = (store: Store, engine: Engine, unavailable = false) =>
    runNightWatch({
      store,
      engine: unavailable
        ? { ...engine, autopsy: async (i) => ({ ...(await engine.autopsy(i)), unavailable: [{ source: 'npm', reason: 'down' }] }) }
        : engine,
      engineName: 'stub',
      readManifests: fakeManifests,
      now: () => new Date('2026-11-03T03:00:00Z'),
    });
  const clean = () => [diag('npm', 'eslint', 'alive')];
  const noticed = (v = '10.14.0') => [diag('npm', 'eslint', 'alive', { evidence: [deprecated()], upgradeTo: up(v, { sameMajor: false }) })];

  it('a version that becomes deprecated gives one upgrade notification, not a "worse" one; then silence', async () => {
    const store = new Store(tmp());
    const engine = engineOf(clean(), noticed(), noticed('10.15.0'), noticed());
    const { project: p } = await store.addProject(project());
    expect((await run(store, engine)).notifications).toEqual([]);
    const second = await run(store, engine);
    expect(second.notifications.map((n) => n.kind)).toEqual(['upgrade']);
    expect(second.notifications[0]!.title).toBe('eslint: the version in use is deprecated, upgrade to 10.14.0');
    expect(second.notifications[0]!.body).toMatch(/still maintained; only the version in use is deprecated\. Upgrade to 10\.14\.0 \(another major version\)\. This is an upgrade, not a migration: do not raise it\./);
    expect(second.projects[0]!.worsened).toBe(0);
    expect(second.projects[0]!.upgrades).toBe(1);
    // the target moved, the notice is the same one: silent
    expect((await run(store, engine)).notifications).toEqual([]);
    expect((await run(store, engine)).notifications).toEqual([]);
    const saved = (await store.load()).projects[p.id]!;
    expect(saved.upgrades).toEqual(['npm:eslint']);
    expect(saved.snapshot).toEqual({ 'npm:eslint': 'alive' });
  });

  it('a notice already present at the baseline gives no notification', async () => {
    const store = new Store(tmp());
    const engine = engineOf(noticed(), noticed());
    await store.addProject(project());
    expect((await run(store, engine)).notifications).toEqual([]);
    expect((await run(store, engine)).notifications).toEqual([]);
  });

  it('a state file from before the notice existed only records it on the first run', async () => {
    const store = new Store(tmp());
    const engine = engineOf(noticed(), noticed());
    const { project: p } = await store.addProject(project());
    await store.update((s) => {
      s.projects[p.id]!.snapshot = { 'npm:eslint': 'alive' };
    });
    expect((await run(store, engine)).notifications).toEqual([]);
    expect((await store.load()).projects[p.id]!.upgrades).toEqual(['npm:eslint']);
  });

  it('a source outage does not make the notice disappear and come back as a new one', async () => {
    const store = new Store(tmp());
    const engine = engineOf(clean(), noticed(), clean(), noticed());
    const { project: p } = await store.addProject(project());
    await run(store, engine);
    expect((await run(store, engine)).notifications).toHaveLength(1);
    expect((await run(store, engine, true)).notifications).toEqual([]);
    expect((await store.load()).projects[p.id]!.upgrades).toEqual(['npm:eslint']);
    expect((await run(store, engine)).notifications).toEqual([]);
  });

  it('a notice that clears and comes back is announced again', async () => {
    const store = new Store(tmp());
    const engine = engineOf(clean(), noticed(), clean(), noticed());
    await store.addProject(project());
    await run(store, engine);
    await run(store, engine);
    expect((await run(store, engine)).notifications).toEqual([]);
    expect((await run(store, engine)).notifications.map((n) => n.kind)).toEqual(['upgrade']);
  });
});

// ---- item 2: the séance's tested-versions note --------------------------------------------------------------

const PADSTART: Successor = { name: 'String.prototype.padStart', ecosystem: 'npm', kind: 'native', reason: 'built in', source: 'curated', confidence: 'high' };
const lp = { ecosystem: 'npm', name: 'left-pad' } as const;

describe('item 2: the séance says which versions it was run against', () => {
  const dead = (): Engine => engineShaped({ verdict: 'dead', evidence: [{ code: 'npm-deprecated', message: 'Deprecated (test).', source: 'npm' }], successors: [PADSTART] });

  it('a version the recipe was run against: covered, nothing to tell', async () => {
    const call = await connect(dead());
    const r = await call('seance', { ...lp, path: repoOn('main'), spec: '1.3.0' });
    expect(r.json.versions).toMatchObject({ package: 'left-pad', inUse: '1.3.0', covered: true, tellThePerson: false });
    expect(r.json.versions.testedAgainst).toContain('1.3.0');
    expect(r.json.versionNotTested).toBe(false);
    expect(r.json.notes.join(' ')).not.toMatch(/Tell the person the version in use was not tested/);
  });

  it('a version the recipe was not run against: the answer and the notes say so', async () => {
    const call = await connect(dead());
    const r = await call('seance', { ...lp, path: repoOn('main'), spec: '0.0.9' });
    expect(r.json.versions.covered).toBe(false);
    expect(r.json.versions.tellThePerson).toBe(true);
    expect(r.json.versionNotTested).toBe(true);
    expect(r.json.versions.note).toMatch(/outside the versions this séance was run against|not run against/i);
    expect(r.json.notes.join(' ')).toMatch(/Tell the person the version in use was not tested/);
  });

  it('a version that was run and does not fit is named with the reason', async () => {
    const call = await connect(dead());
    const r = await call('seance', { ...lp, path: repoOn('main'), spec: '1.0.1' });
    expect(r.json.versions.covered).toBe(false);
    expect(r.json.versions.doesNotFit?.map((x: any) => x.version)).toContain('1.0.1');
    expect(r.json.versionNotTested).toBe(true);
  });

  it('with no spec the version is read from the project: the lockfile first, then the declared range', async () => {
    const call = await connect(dead());
    const lock = JSON.stringify({
      name: 'x',
      lockfileVersion: 3,
      packages: {
        '': { name: 'x', dependencies: { 'left-pad': '^1.0.0' } },
        'node_modules/left-pad': { version: '1.0.1', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.0.1.tgz' },
      },
    });
    const locked = repoOn('main', {
      'package.json': '{"name":"x","dependencies":{"left-pad":"^1.0.0"}}',
      'package-lock.json': lock,
      'src/receipt.js': readFileSync(path.join(hauntedSrc, 'receipt.js'), 'utf8'),
    });
    const a = await call('seance', { ...lp, path: locked });
    expect(a.json.versions).toMatchObject({ inUse: '1.0.1', inUseFrom: 'lockfile', covered: false });
    const ranged = await call('seance', { ...lp, path: repoOn('main') });
    expect(ranged.json.versions).toMatchObject({ inUse: '^1.3.0', inUseFrom: 'range' });
    // an explicit spec beats the manifests
    const over = await call('seance', { ...lp, path: locked, spec: '1.3.0' });
    expect(over.json.versions.inUse).toBe('1.3.0');
  });

  it('seance_write carries the same note, and still writes only on a resurrect/ branch', async () => {
    const call = await connect(dead());
    const dir = repoOn('resurrect/left-pad');
    const r = await call('seance_write', { ...lp, path: dir, spec: '0.0.9' });
    expect(r.isError).toBe(false);
    expect(r.json.wrote).toBe(true);
    expect(r.json.versionNotTested).toBe(true);
    expect(r.json.versions.covered).toBe(false);
    const main = repoOn('main');
    const refused = await call('seance_write', { ...lp, path: main, spec: '0.0.9' });
    expect(refused.isError).toBe(true);
    expect(git(main, 'status', '--porcelain')).toBe('');
  });

  it('the preview still writes nothing', async () => {
    const call = await connect(dead());
    const dir = repoOn('resurrect/left-pad');
    await call('seance', { ...lp, path: dir, spec: '0.0.9' });
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(existsSync(path.join(dir, 'seance'))).toBe(false);
  });

  it('the generic template says no version was run, and the answer tells the person', async () => {
    const generic: Successor = { name: 'some-other-pad', ecosystem: 'npm', kind: 'package', reason: 'a package', source: 'curated', confidence: 'high' };
    const call = await connect(engineShaped({ verdict: 'dead', evidence: [{ code: 'npm-deprecated', message: 'x', source: 'npm' }], successors: [generic] }));
    const dir = repoOn('main', { 'package.json': '{"dependencies":{"some-old-pad":"1.0.0"}}', 'src/a.js': "const p = require('some-old-pad'); p('a', 3);\n" });
    const r = await call('seance', { ecosystem: 'npm', name: 'some-old-pad', path: dir });
    expect(r.isError).toBe(false);
    expect(r.json.template).toBe('generic');
    expect(r.json.versions.testedAgainst).toEqual([]);
    expect(r.json.versions.note).toMatch(/not run against any version/);
    expect(r.json.versionNotTested).toBe(true);
  });

  it('versionsNote is absent when the engine gave none (an older engine)', () => {
    expect(versionsNote(undefined)).toBeUndefined();
    const v: SeanceVersions = { package: 'x', testedAgainst: ['1.0.0'], inUseFrom: 'unknown', note: 'n' };
    expect(versionsNote(v)).toMatchObject({ covered: null, inUse: null, tellThePerson: true });
  });
});

describe('item 3: skill and prompt', () => {
  const root = path.join(__dirname, '..');
  const skill = readFileSync(path.join(root, 'skills/resurrection/SKILL.md'), 'utf8');
  const prompt: string = JSON.parse(readFileSync(path.join(root, 'agents/necromancer.json'), 'utf8')).prompt;

  it('both say an upgrade notice is an upgrade, never a migration', () => {
    for (const text of [skill, prompt]) {
      expect(text).toMatch(/upgrade/i);
      expect(text).toMatch(/another major version/);
      expect(text).toMatch(/older/);
      expect(text).toMatch(/never migrate|Never migrate|no "raise"/);
    }
    expect(prompt).toMatch(/Night Watch may send you an `upgrade` notification/);
  });

  it('both tell the agent to say when the version in use was not tested', () => {
    for (const text of [skill, prompt]) {
      expect(text).toContain('versionNotTested');
      expect(text).toMatch(/tell the person|Tell the person/i);
    }
    expect(skill).toContain('doesNotFit');
  });
});
