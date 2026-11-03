import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { project, tmp } from './helpers';
import { Store } from '../src/store';

const server = path.resolve(__dirname, '../backend/server.py');
let child: ChildProcess | undefined;
afterEach(() => child?.kill());

async function start(dataDir: string, secret = ''): Promise<number> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  child = spawn('python3', [server], {
    env: { ...process.env, PORT: String(port), NECROMANCER_DATA_DIR: dataDir, KIROCREW_PROXY_SECRET: secret },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return port;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('backend did not start');
}

describe('Graveyard backend (R2)', () => {
  it('serves an empty state before anything is watched, and the stored state after', async () => {
    const dir = tmp();
    const port = await start(dir);
    const empty = await (await fetch(`http://127.0.0.1:${port}/api/graveyard`)).json();
    expect(empty).toEqual({ state: { version: 1, projects: {} }, problem: null });

    const { project: p } = await new Store(dir).addProject(project());
    const stored = await (await fetch(`http://127.0.0.1:${port}/api/graveyard`)).json();
    expect(Object.keys(stored.state.projects)).toEqual([p.id]);
  });

  it('reports a corrupt state file as a problem instead of failing', async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'watch.json'), '{ nope');
    const port = await start(dir);
    const body = await (await fetch(`http://127.0.0.1:${port}/api/graveyard`)).json();
    expect(body.state.projects).toEqual({});
    expect(body.problem).toMatch(/could not be read/);
  });

  it('is read-only and answers 404 for unknown paths', async () => {
    const port = await start(tmp());
    expect((await fetch(`http://127.0.0.1:${port}/api/graveyard`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/api/nothing`)).status).toBe(404);
  });

  it('with a proxy secret, rejects unsigned and stale requests and accepts a signed one', async () => {
    const secret = 's3cret-for-test';
    const port = await start(tmp(), secret);
    const url = `http://127.0.0.1:${port}/api/graveyard`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);

    const sign = (ts: number) =>
      `${ts}:${createHmac('sha256', secret)
        .update(`${ts}:GET:/api/graveyard:${createHash('sha256').update('').digest('hex')}`)
        .digest('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    expect((await fetch(url, { headers: { 'X-KiroCrew-Proxy': sign(now) } })).status).toBe(200);
    expect((await fetch(url, { headers: { 'X-KiroCrew-Proxy': sign(now - 3600) } })).status).toBe(401);
    expect((await fetch(url, { headers: { 'X-KiroCrew-Proxy': `${now}:deadbeef` } })).status).toBe(401);
  });
});
