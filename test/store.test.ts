import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store, StoreError } from '../src/store';
import { project, tmp } from './helpers';

describe('Store (R3)', () => {
  it('R3.1 adds an existing directory once, keyed by its resolved path', async () => {
    const store = new Store(tmp());
    const dir = project();
    const first = await store.addProject(dir);
    expect(first.added).toBe(true);
    expect(first.project.id).toMatch(/^[0-9a-f]{12}$/);
    expect(first.project.path).toBe(await fs.realpath(dir));
  });

  it('R3.3 adding the same path twice keeps one entry', async () => {
    const store = new Store(tmp());
    const dir = project();
    await store.addProject(dir);
    const again = await store.addProject(dir + path.sep);
    expect(again.added).toBe(false);
    expect(Object.keys((await store.load()).projects)).toHaveLength(1);
  });

  it('R3.2 refuses a path that does not exist, and stores nothing', async () => {
    const store = new Store(tmp());
    await expect(store.addProject('/no/such/necromancer/dir')).rejects.toBeInstanceOf(StoreError);
    expect(Object.keys((await store.load()).projects)).toHaveLength(0);
  });

  it('R3.2 refuses a file and an empty path', async () => {
    const store = new Store(tmp());
    const dir = project();
    await expect(store.addProject(path.join(dir, 'package.json'))).rejects.toThrow(/not a directory/);
    await expect(store.addProject('  ')).rejects.toThrow(/required/);
  });

  it('R3.4 removes by id and by path; an unknown id is false, not an error', async () => {
    const store = new Store(tmp());
    const a = await store.addProject(project());
    const b = await store.addProject(project());
    expect(await store.removeProject(a.project.id)).toBe(true);
    expect(await store.removeProject(b.project.path)).toBe(true);
    expect(await store.removeProject('nope')).toBe(false);
  });

  it('R3.5 survives a restart (a new Store on the same directory sees the project)', async () => {
    const dir = tmp();
    const added = await new Store(dir).addProject(project());
    const state = await new Store(dir).load();
    expect(state.projects[added.project.id]?.path).toBe(added.project.path);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('R3.5 concurrent adds in one process are not lost', async () => {
    const store = new Store(tmp());
    await Promise.all(Array.from({ length: 8 }, () => store.addProject(project())));
    expect(Object.keys((await store.load()).projects)).toHaveLength(8);
  });

  it('R3.6 a corrupt file is moved aside and the list starts empty', async () => {
    const dir = tmp();
    await fs.writeFile(path.join(dir, 'watch.json'), '{ not json');
    const store = new Store(dir, () => new Date(1000));
    const state = await store.load();
    expect(state.projects).toEqual({});
    expect(store.recovered).toMatch(/moved to watch\.json\.corrupt-1000/);
    expect(await fs.readdir(dir)).toContain('watch.json.corrupt-1000');
  });

  it('R3.6 a file with the wrong shape is treated as corrupt', async () => {
    const dir = tmp();
    await fs.writeFile(path.join(dir, 'watch.json'), JSON.stringify({ version: 2, projects: [] }));
    const store = new Store(dir);
    expect((await store.load()).projects).toEqual({});
    expect(store.recovered).toBeDefined();
  });
});
