import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '@necromancer/engine';
import type { Diagnosis, Engine, Successor, Verdict } from '@necromancer/engine';
import { describe, expect, it } from 'vitest';
import { readTestRunner } from '../src/project-files';
import { assertSafeName, GuardError, resolveProjectDir, shellQuote } from '../src/project-guard';
import { Store } from '../src/store';
import { createToolServer } from '../src/tools';
import { project, tmp } from './helpers';
import { recordedAt, recordedFetch } from './recorded-fetch';

function engineWith(verdict: Verdict, successors: Successor[], basis?: 'hard' | 'heuristic'): Engine {
  const real = createEngine({ fetch: recordedFetch(), now: () => recordedAt });
  return {
    ...real,
    diagnose: async (deps) =>
      deps.map(
        (dependency): Diagnosis => ({
          dependency,
          verdict,
          ...(basis ? { basis } : {}),
          evidence: [{ code: 'npm-deprecated', message: 'Deprecated (test).', source: 'npm' }],
          advisories: [],
          successors,
        }),
      ),
  };
}
const PADSTART: Successor = { name: 'String.prototype.padStart', ecosystem: 'npm', kind: 'native', reason: 'built in', source: 'curated' };

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

describe('resolveProjectDir (QA-12, QA-19)', () => {
  it('accepts a project directory and lists the manifests directly in it', async () => {
    const dir = project({ 'package.json': '{}', 'requirements.txt': '' });
    const r = await resolveProjectDir(dir);
    expect(r.manifests).toEqual(['package.json', 'requirements.txt']);
    expect(r.real.length).toBeGreaterThan(0);
  });

  it('QA-12 a relative path is refused, named in the message, and never resolved against the working directory', async () => {
    await expect(resolveProjectDir('relative/dir')).rejects.toThrow(/"relative\/dir" is relative/);
    await expect(resolveProjectDir('.')).rejects.toThrow(/"\." is relative/);
    await expect(resolveProjectDir('')).rejects.toThrow(/empty/);
  });

  it('QA-19 refuses the filesystem root', async () => {
    await expect(resolveProjectDir('/')).rejects.toThrow(/filesystem root/);
  });

  it.skipIf(process.platform === 'win32')('a symbolic link to / is refused as the root, and the message says where it leads', async () => {
    const link = path.join(tmp(), 'to-root');
    symlinkSync('/', link);
    await expect(resolveProjectDir(link)).rejects.toThrow(/resolves to "\/"\)? ?is the filesystem root|is the filesystem root/);
    await expect(resolveProjectDir(link)).rejects.toThrow(/resolves to "\/"/);
  });

  it('a home directory, and a folder above one, are refused', async () => {
    await expect(resolveProjectDir(os.homedir())).rejects.toThrow(/home directory/);
    await expect(resolveProjectDir(path.dirname(os.homedir()))).rejects.toThrow(/home directory or a folder above one|filesystem root/);
  });

  it('a directory with no manifest directly in it is refused (a depth limit does not make it a project)', async () => {
    const dir = project({ 'README.md': 'x', 'sub/package.json': '{}' });
    await expect(resolveProjectDir(dir)).rejects.toThrow(/none of package\.json, package-lock\.json, requirements\.txt, pyproject\.toml directly in it/);
  });

  it('a missing path and a file are refused with the path named', async () => {
    await expect(resolveProjectDir('/no/such/necromancer/dir')).rejects.toThrow(/"\/no\/such\/necromancer\/dir" does not exist/);
    const dir = project({ 'package.json': '{}' });
    await expect(resolveProjectDir(path.join(dir, 'package.json'))).rejects.toThrow(/not a directory/);
  });

  it('a path with a newline or a NUL is refused without changing the message line', async () => {
    await expect(resolveProjectDir('/tmp/a\nb')).rejects.toThrow(/control character/);
    await expect(resolveProjectDir('/tmp/a\0b')).rejects.toThrow(/control character/);
    try {
      await resolveProjectDir('/tmp/a\nb');
    } catch (err) {
      expect((err as Error).message.split('\n')).toHaveLength(1);
    }
  });
});

describe('tools use the guard', () => {
  it('QA-12 autopsy and watch_add name a relative path; watch_add does not resolve it', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const a = await call('autopsy', { path: 'relative/dir' });
    expect(a.isError).toBe(true);
    expect(a.text).toContain('"relative/dir" is relative');
    const w = await call('watch_add', { path: 'relative' });
    expect(w.isError).toBe(true);
    expect(w.text).toContain('"relative" is relative');
    expect(w.text).not.toContain(process.cwd());
    expect((await call('watch_list', {})).json.projects).toEqual([]);
  });

  it('QA-12 the store itself refuses a relative path too', async () => {
    await expect(new Store(tmp()).addProject('relative')).rejects.toThrow(/relative/);
  });

  it('QA-19 autopsy, watch_add, seance and resurrection_spec refuse the root and a home directory', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    for (const p of ['/', os.homedir()]) {
      for (const [tool, args] of [
        ['autopsy', { path: p }],
        ['watch_add', { path: p }],
        ['seance', { ecosystem: 'npm', name: 'left-pad', path: p }],
        ['resurrection_spec', { ecosystem: 'npm', name: 'left-pad', path: p }],
      ] as const) {
        const r = await call(tool, args as Record<string, unknown>);
        expect(r.isError, `${tool} ${p}`).toBe(true);
        expect(r.text).toMatch(/filesystem root|home directory/);
      }
    }
  });

  it('QA-19 autopsy says what it read', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = project({
      'package.json': '{"dependencies":{"left-pad":"1.3.0"}}',
      'sub/requirements.txt': 'nose==1.3.7\n',
      'node_modules/x/package.json': '{}',
    });
    const r = await call('autopsy', { path: dir });
    expect(r.isError).toBe(false);
    expect(r.json.read.directory.length).toBeGreaterThan(0);
    expect(r.json.read.manifests.sort()).toEqual(['package.json', 'sub/requirements.txt']);
    expect(r.json.read.limits).toMatch(/3 levels deep, at most 40 files/);
  });
});

describe('package names (QA-20)', () => {
  const hostile = ['x`touch /tmp/qa-pwn-1`', 'a b', 'x;rm -rf y', '$(id)', 'a|b', 'a&b', "it's", 'line\nbreak', '../x', '-rf', '', 'a'.repeat(300), '@scope/', '@/x'];

  it('assertSafeName accepts real names and refuses shell-active ones', () => {
    for (const ok of ['left-pad', 'lodash.merge', '@babel/core', 'Flask', 'zope.interface', 'a_b', 'x~1']) {
      expect(() => assertSafeName(ok), ok).not.toThrow();
    }
    for (const bad of hostile) expect(() => assertSafeName(bad), JSON.stringify(bad)).toThrow(GuardError);
  });

  it('every tool that takes a name refuses a hostile one before anything runs', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = project({ 'package.json': '{}' });
    for (const bad of hostile) {
      for (const [tool, args] of [
        ['diagnose', { dependencies: [{ ecosystem: 'npm', name: bad }] }],
        ['successors', { ecosystem: 'npm', name: bad }],
        ['resurrection_spec', { ecosystem: 'npm', name: bad }],
        ['seance', { ecosystem: 'npm', name: bad, path: dir }],
      ] as const) {
        const r = await call(tool, args as Record<string, unknown>);
        expect(r.isError, `${tool} ${JSON.stringify(bad)}`).toBe(true);
        expect(r.text).toMatch(/not a package name the tools accept|Too small|Too big|Invalid|invalid/i);
      }
    }
  });

  it('the advice text quotes a name anyway (defence in depth)', () => {
    expect(shellQuote('left-pad')).toBe("'left-pad'");
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    expect(shellQuote('x`id`')).toBe("'x`id`'");
  });

  it('a name is never put in the unused-dependency advice unquoted', async () => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = project({ 'package.json': '{}', 'src/a.js': 'module.exports = 1;\n' });
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.json.usage.warnings.join(' ')).toContain("npm uninstall 'left-pad'");
  });
});

describe('project.testRunner (item 6)', () => {
  const spec = async (files: Record<string, string>) => {
    const call = await connect(engineWith('dead', [PADSTART]));
    const dir = project({ 'src/a.js': "const p = require('left-pad'); p('a', 3);\n", ...files });
    const r = await call('resurrection_spec', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.isError).toBe(false);
    return r.json;
  };

  it('reads scripts.test and passes the runner to the spec', async () => {
    const r = await spec({ 'package.json': '{"scripts":{"test":"vitest run --coverage"}}' });
    expect(r.project.testRunner).toBe('vitest');
    expect(Object.values(r.spec).join('\n')).toContain('`vitest`');
  });

  it('keeps the whole command when no known runner is named', async () => {
    const r = await spec({ 'package.json': '{"scripts":{"test":"./run-tests.sh --fast"}}' });
    expect(r.project.testRunner).toBe('./run-tests.sh --fast');
  });

  it('a project whose package.json has no scripts.test still gets a spec, with no runner named', async () => {
    const r = await spec({ 'package.json': '{"name":"x"}' });
    expect(r.project.testRunner).toBeNull();
    expect(Object.keys(r.spec)).toEqual(['requirements.md', 'design.md', 'tasks.md']);
    expect(Object.values(r.spec).join('\n')).toContain('whatever it uses');
  });

  it('readTestRunner copes with npm\'s placeholder, broken JSON, a non-string script and a missing file', async () => {
    const t = async (content: string | undefined) => {
      const dir = tmp();
      if (content !== undefined) writeFileSync(path.join(dir, 'package.json'), content);
      return readTestRunner(dir);
    };
    expect(await t('{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}')).toBeUndefined();
    expect(await t('{ nope')).toBeUndefined();
    expect(await t('{"scripts":{"test":42}}')).toBeUndefined();
    expect(await t('{"scripts":{"test":"   "}}')).toBeUndefined();
    expect(await t(undefined)).toBeUndefined();
    expect(await t('{"scripts":{"test":"node --test test/*.test.js"}}')).toBe('node --test');
    expect(await t('{"scripts":{"test":"jest"}}')).toBe('jest');
  });
});

describe('basis in tool answers (item 1)', () => {
  it('successors and resurrection_spec say whether the verdict rests on a hard signal or a heuristic', async () => {
    const heuristic = await connect(engineWith('dying', [PADSTART], 'heuristic'));
    const h = await heuristic('successors', { ecosystem: 'npm', name: 'left-pad' });
    expect(h.json.basis).toEqual({ basis: 'heuristic', label: expect.stringMatching(/^Heuristic: a guess from staleness/) });
    const hard = await connect(engineWith('dead', [PADSTART], 'hard'));
    const k = await hard('resurrection_spec', { ecosystem: 'npm', name: 'left-pad' });
    expect(k.json.basis.basis).toBe('hard');
    expect(k.json.basis.label).toMatch(/^Hard signal/);
    const unknown = await connect(engineWith('dead', [PADSTART]));
    expect((await unknown('successors', { ecosystem: 'npm', name: 'left-pad' })).json.basis.basis).toBeNull();
  });

  it('diagnose passes the engine\'s basis field through unchanged', async () => {
    const call = await connect(engineWith('dying', [], 'heuristic'));
    const r = await call('diagnose', { dependencies: [{ ecosystem: 'npm', name: 'moment' }] });
    expect(r.json.diagnoses[0].basis).toBe('heuristic');
  });

  it('seance carries the basis too', async () => {
    const call = await connect(engineWith('dead', [PADSTART], 'hard'));
    const dir = project({ 'package.json': '{}', 'src/a.js': "const p = require('left-pad'); p('a', 3);\n" });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    const r = await call('seance', { ecosystem: 'npm', name: 'left-pad', path: dir });
    expect(r.json.basis.basis).toBe('hard');
  });
});
