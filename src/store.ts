import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WatchState, WatchedProject } from './state';

export const STATE_FILE = 'watch.json';

export function projectId(absPath: string): string {
  return createHash('sha1').update(absPath).digest('hex').slice(0, 12);
}

export class StoreError extends Error {}

/**
 * Watchlist and snapshots in one JSON file. Writes are atomic (temp file, then
 * rename). Calls from one process are serialised; two processes writing at once
 * resolve as last writer wins, which is acceptable for a once-a-day job.
 */
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  /** Set when the last load had to move a corrupt file aside. */
  recovered?: string;

  constructor(
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get file(): string {
    return path.join(this.dir, STATE_FILE);
  }

  async load(): Promise<WatchState> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projects: {} };
      throw err;
    }
    try {
      const doc = JSON.parse(text) as Partial<WatchState> | null;
      if (
        doc === null ||
        typeof doc !== 'object' ||
        doc.version !== 1 ||
        typeof doc.projects !== 'object' ||
        doc.projects === null ||
        Array.isArray(doc.projects)
      ) {
        throw new Error('unexpected shape');
      }
      return { version: 1, projects: doc.projects };
    } catch {
      const aside = `${this.file}.corrupt-${this.now().getTime()}`;
      await fs.rename(this.file, aside);
      this.recovered = `State file was unreadable; moved to ${path.basename(aside)} and started empty.`;
      return { version: 1, projects: {} };
    }
  }

  private async write(state: WatchState): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  /** Read, change, write, one at a time. */
  update<T>(fn: (state: WatchState) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.load();
      const result = await fn(state);
      await this.write(state);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Add a watched directory. Refuses a path that is not an existing directory. */
  async addProject(input: string): Promise<{ project: WatchedProject; added: boolean }> {
    if (typeof input !== 'string' || input.trim() === '') {
      throw new StoreError('A project path is required.');
    }
    const resolved = path.resolve(input);
    let real: string;
    try {
      real = await fs.realpath(resolved);
      if (!(await fs.stat(real)).isDirectory()) throw new StoreError(`${resolved} is not a directory.`);
    } catch (err) {
      if (err instanceof StoreError) throw err;
      throw new StoreError(`${resolved} does not exist or cannot be read.`);
    }
    const id = projectId(real);
    return this.update((state) => {
      const existing = state.projects[id];
      if (existing) return { project: existing, added: false };
      const project: WatchedProject = {
        id,
        path: real,
        addedAt: this.now().toISOString(),
        status: 'ok',
      };
      state.projects[id] = project;
      return { project, added: true };
    });
  }

  /** Remove a project and its snapshot. Returns false when it was not watched. */
  removeProject(idOrPath: string): Promise<boolean> {
    return this.update((state) => {
      const id =
        state.projects[idOrPath] !== undefined
          ? idOrPath
          : Object.values(state.projects).find((p) => p.path === path.resolve(idOrPath))?.id;
      if (id === undefined) return false;
      delete state.projects[id];
      return true;
    });
  }
}
