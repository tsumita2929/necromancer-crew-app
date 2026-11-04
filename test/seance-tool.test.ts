import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '@necromancer/engine';
import type { Diagnosis, Engine, SeanceBundle, Successor, Verdict } from '@necromancer/engine';
import { describe, expect, it } from 'vitest';
import { cleanInstall, isSafeBundlePath, writeBundle } from '../src/seance-tool';
import { Store } from '../src/store';
import { createStubEngine } from '../src/stub-engine';
import { createToolServer } from '../src/tools';
import { project, tmp } from './helpers';
import { hauntedApp } from './paths';
import { recordedAt, recordedFetch } from './recorded-fetch';

const hauntedSrc = path.join(hauntedApp, 'src');

/** The real engine's scan and séance generator; diagnosis is fixed so no network is needed. */
function engineWith(verdict: Verdict, successors: Successor[]): Engine {
  const real = createEngine({ fetch: recordedFetch(), now: () => recordedAt });
  return {
    ...real,
    diagnose: async (deps) =>
      deps.map(
        (dependency): Diagnosis => ({
          dependency,
          verdict,
          evidence: [{ code: 'npm-deprecated', message: 'Deprecated (test).', source: 'npm' }],
          advisories: [],
          successors,
        }),
      ),
  };
}

const PADSTART: Successor = { name: 'String.prototype.padStart', ecosystem: 'npm', kind: 'native', reason: 'built in', source: 'curated' };
const FETCH: Successor = { name: 'fetch', ecosystem: 'npm', kind: 'native', reason: 'built in', source: 'curated' };

async function connect(engine: Engine, name: 'engine' | 'stub' = 'engine') {
  const server = createToolServer({ engine: { name, engine }, store: new Store(tmp()) });
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

/** A git repository with the haunted app's source, on the given branch. */
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

describe('seance tool (live R-seance)', () => {
  it('generates the curated left-pad séance from the project\'s own calls, and writes nothing by default', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main');
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({
      engine: 'engine',
      recipe: 'left-pad',
      template: 'curated',
      comparisonsSkipped: false,
      wrote: false,
      language: 'javascript',
    });
    expect(r.json.run.length).toBeGreaterThan(0);
    expect(r.json.install.length).toBeGreaterThan(0);
    expect(r.json.knownDifferences.length).toBeGreaterThanOrEqual(3);
    expect(r.json.usage.members.some((m: any) => m.calls > 0)).toBe(true);
    expect(r.json.usage.warnings).toEqual([]);
    expect(r.json.files.map((f: any) => f.path).some((p: string) => p.endsWith('.mjs'))).toBe(true);
    expect(existsSync(path.join(dir, 'seance'))).toBe(false);
  });

  it('the install command never names the old package (so it cannot move to devDependencies), whatever the engine emits; the notes mention the Vitest and node --test points', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: repoOn('main') });
    // Invariant: no returned install command names the dead package. Older engine output named it and the
    // tool removed it (with a note); newer engine output no longer names it. Both must satisfy this.
    expect(r.json.install.length).toBeGreaterThan(0);
    for (const cmd of r.json.install as string[]) {
      expect(cmd, cmd).not.toMatch(/(^|[\s@/])left-pad(@|\s|$)/);
    }
    expect((r.json.install as string[]).join(' ')).toMatch(/vitest/);
    expect((r.json.install as string[]).join(' ')).toMatch(/fast-check/);
    const notes = r.json.notes.join(' ');
    expect(notes).toMatch(/Node 22\.12/);
    expect(notes).toMatch(/node --test test\/\*\.test\.js/);
  });

  it('with older engine output that names the old package in the install line, the tool still never returns it, and says so', async () => {
    const base = engineWith('dead', [PADSTART]);
    const older: Engine = {
      ...base,
      seance: (d, s, u) => {
        const bundle = base.seance!(d, s, u);
        return { ...bundle, install: ['npm install --save-dev vitest fast-check left-pad'] };
      },
    };
    const call = await connect(older);
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: repoOn('main') });
    expect(r.json.install).toEqual(['npm install --save-dev vitest fast-check']);
    expect(r.json.notes.join(' ')).toMatch(/also names left-pad/);
  });

  it('cleanInstall (a guard for older engine output) removes the old package and says so, and says nothing when it is absent', () => {
    const older = cleanInstall(['npm install --save-dev vitest fast-check left-pad'], 'left-pad');
    expect(older.install).toEqual(['npm install --save-dev vitest fast-check']);
    expect(older.note).toMatch(/also names left-pad/);
    const newer = cleanInstall(['npm install --save-dev vitest fast-check'], 'left-pad');
    expect(newer).toEqual({ install: ['npm install --save-dev vitest fast-check'] });
  });

  it('cleanInstall leaves other commands alone', () => {
    expect(cleanInstall(['pip install hypothesis pytest toml'], 'toml')).toEqual({ install: ['pip install hypothesis pytest toml'] });
    expect(cleanInstall(['npm install --save-dev vitest left-pad@1.3.0'], 'left-pad').install).toEqual(['npm install --save-dev vitest']);
  });

  it('write=true writes the bundle on a resurrect/ branch, and a second call changes nothing', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('resurrect/left-pad');
    const first = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir, write: true });
    expect(first.isError).toBe(false);
    expect(first.json.wrote).toBe(true);
    expect(first.json.branch).toBe('resurrect/left-pad');
    expect(first.json.written.length).toBeGreaterThan(1);
    for (const rel of first.json.written) expect(existsSync(path.join(dir, rel))).toBe(true);
    const second = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir, write: true });
    expect(second.json.written).toEqual([]);
    expect(second.json.unchanged.sort()).toEqual(first.json.written.sort());
  });

  it('write=true on main is refused and nothing is written', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main');
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir, write: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/branch "main"/);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('write=true outside a git repository is refused', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = project({ 'package.json': '{}', 'src/a.js': "const p = require('left-pad'); p('a', 3);" });
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir, write: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not a git repository/);
    expect(existsSync(path.join(dir, 'seance'))).toBe(false);
  });

  it('never overwrites a file whose content differs, and writes nothing at all then', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('resurrect/left-pad');
    const probe = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    const [first, second] = probe.json.files;
    mkdirSync(path.dirname(path.join(dir, first.path)), { recursive: true });
    writeFileSync(path.join(dir, first.path), 'my own work\n');
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir, write: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Refused to overwrite/);
    expect(readFileSync(path.join(dir, first.path), 'utf8')).toBe('my own work\n');
    expect(existsSync(path.join(dir, second.path))).toBe(false);
  });

  it('request to fetch has no curated recipe: the generic template, comparisons skipped, and it says so', async () => {
    const call = await connect(engineWith('zombie', [FETCH]));
    const dir = repoOn('main', {
      'package.json': '{"dependencies":{"request":"^2.88.2"}}',
      'src/rates.js': "const request = require('request');\nrequest({ url: 'http://x', json: true }, (err, res, body) => {});\n",
    });
    const r = await call('seance', { ecosystem: 'npm', name: 'request', path: dir });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ recipe: null, template: 'generic', comparisonsSkipped: true });
    expect(r.json.todos).toBeGreaterThan(0);
    expect(r.json.notes.join(' ')).toMatch(/SKIPPED until the replacement module sets READY/);
  });

  it('is-odd with a raise successor gets the curated is-odd recipe', async () => {
    const raise: Successor = { name: 'is-odd', ecosystem: 'npm', kind: 'raise', reason: 'tiny', source: 'module-replacements' };
    const call = await connect(engineWith('dead', [raise]));
    const dir = repoOn('main', { 'package.json': '{}', 'src/i.js': "const isOdd = require('is-odd');\nmodule.exports = (n) => isOdd(n);\n" });
    const r = await call('seance', { ecosystem: 'npm', name: 'is-odd', path: dir });
    expect(r.json).toMatchObject({ recipe: 'is-odd', template: 'curated', comparisonsSkipped: false });
  });

  it('no successor listed: the raise path still produces a séance', async () => {
    const call = await connect(engineWith('dead', []));
    const dir = repoOn('main', { 'package.json': '{}', 'src/i.js': "const { flatten } = require('array-flatten');\nflatten([1,[2]]);\n" });
    const r = await call('seance', { ecosystem: 'npm', name: 'array-flatten', path: dir });
    expect(r.isError).toBe(false);
    expect(r.json.successor).toMatchObject({ kind: 'raise', name: 'array-flatten' });
  });

  it('a dependency the scan finds no calls for is flagged, not hidden', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main', { 'package.json': '{}', 'src/a.js': "const x = require('lodash');\nx.map([], (y) => y);\n" });
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.isError).toBe(false);
    expect(r.json.usage.notUsed).toBe(true);
    expect(r.json.usage.warnings.join(' ')).toMatch(/Stop here: no source file imports left-pad at run time/);
    expect(r.json.usage.warnings.join(' ')).toMatch(/Do not remove it yourself and do not create a branch/);
  });

  it('a dependency imported but never called is flagged', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main', { 'package.json': '{}', 'src/a.js': "const leftPad = require('left-pad');\nmodule.exports = {};\n" });
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.json.usage.neverCalled).toBe(true);
    expect(r.json.usage.warnings.join(' ')).toMatch(/no member is ever called/);
  });

  it('a dependency imported only in a test file is flagged as test-only', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main', {
      'package.json': '{}',
      'src/a.js': 'module.exports = 1;\n',
      'test/a.test.js': "const leftPad = require('left-pad');\nrequire('node:test')('x', () => leftPad('a', 3));\n",
    });
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.json.usage.onlyInTests).toBe(true);
    expect(r.json.usage.filesUsing).toEqual(['test/a.test.js']);
    expect(r.json.usage.warnings.join(' ')).toMatch(/only in test files/);
  });

  // File modes are not enforced for root or on Windows, so this check needs an ordinary POSIX user.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a project file the scan cannot read is listed, and the rest is still scanned', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main', {
      'package.json': '{}',
      'src/ok.js': "const leftPad = require('left-pad');\nleftPad('a', 3, '0');\n",
      'src/secret.js': "const leftPad = require('left-pad');\nleftPad('b', 4);\n",
    });
    writeFileSync(path.join(dir, 'src/binary.js'), Buffer.from([0x61, 0x00, 0x62]));
    chmodSync(path.join(dir, 'src/secret.js'), 0o000);
    try {
      const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
      expect(r.isError).toBe(false);
      const unreadable: string[] = r.json.usage.unreadable;
      expect(unreadable.some((u) => u.startsWith('src/binary.js') && /binary/.test(u))).toBe(true);
      expect(unreadable.some((u) => u.startsWith('src/secret.js'))).toBe(true);
      expect(r.json.usage.filesUsing).toEqual(['src/ok.js']);
      expect(r.json.usage.warnings.join(' ')).toMatch(/could not be read/);
    } finally {
      chmodSync(path.join(dir, 'src/secret.js'), 0o644);
    }
  });

  it.skipIf(process.platform === 'win32')('symbolic links in the project are not followed by the scan', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const outside = project({ 'evil.js': "const leftPad = require('left-pad');\nleftPad('a', 3);\n" });
    const dir = repoOn('main', { 'package.json': '{}', 'src/a.js': 'module.exports = 1;\n' });
    symlinkSync(outside, path.join(dir, 'linked'));
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.json.usage.filesUsing).toEqual([]);
  });

  it('an alive dependency, a missing directory and the stub engine are tool errors with a message', async () => {
    const alive = await connect(engineWith('alive', []));
    expect((await alive('seance', { ecosystem: 'npm', name: 'express', path: tmp() })).text).toMatch(/alive/);
    const call = await connect(engineWith('dead', [PADSTART]));
    expect((await call('seance', { ecosystem: 'npm', name: 'left-pad', path: '/no/such/dir/necromancer' })).text).toMatch(/does not exist/);
    const stub = await connect(createStubEngine(), 'stub');
    const r = await stub('seance', { ecosystem: 'npm', name: 'left-pad', path: tmp() });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/stub engine cannot scan usage or generate a séance/);
  });

  it('resurrection_spec with a path describes the project\'s real usage and the séance', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = repoOn('main');
    const plain = await call('resurrection_spec', { ecosystem: 'npm', name: 'left-pad' });
    const scanned = await call('resurrection_spec', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(scanned.isError).toBe(false);
    expect(plain.json.usage).toBeUndefined();
    expect(scanned.json.usage.members.length).toBeGreaterThan(0);
    expect(scanned.json.usage.filesUsing).toEqual(['src/receipt.js']);
    // The spec names the séance files that the seance tool writes.
    expect(scanned.json.spec['requirements.md']).toContain('seance/left-pad/seance.test.mjs');
    expect(Object.keys(scanned.json.spec)).toEqual(['requirements.md', 'design.md', 'tasks.md']);
  });
});

describe('writeBundle safety', () => {
  const bundle = (paths: string[]): SeanceBundle => ({
    language: 'javascript',
    recipe: null,
    title: 't',
    files: paths.map((p) => ({ path: p, content: 'x\n', role: 'test' as const })),
    install: [],
    run: '',
    compares: [],
    knownDifferences: [],
    members: [],
    todos: 0,
  });

  it('isSafeBundlePath accepts relative project paths only', () => {
    for (const ok of ['seance/a/b.mjs', 'a.txt']) expect(isSafeBundlePath(ok)).toBe(true);
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', '.git/hooks/pre-commit', 'a\\b', './a']) {
      expect(isSafeBundlePath(bad), bad).toBe(false);
    }
  });

  it('refuses a bundle with a path that leaves the project, and writes none of its files', async () => {
    const dir = repoOn('resurrect/x');
    await expect(writeBundle(dir, bundle(['seance/ok.mjs', '../escape.mjs']))).rejects.toThrow(/not a safe relative path/);
    expect(existsSync(path.join(dir, 'seance'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('refuses to write through a symbolic link that points out of the project', async () => {
    const dir = repoOn('resurrect/x');
    const outside = tmp();
    symlinkSync(outside, path.join(dir, 'seance'));
    await expect(writeBundle(dir, bundle(['seance/a.mjs']))).rejects.toThrow(/outside the project/);
    expect(existsSync(path.join(outside, 'a.mjs'))).toBe(false);
  });
});
