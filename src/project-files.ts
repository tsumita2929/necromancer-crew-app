import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SourceFile } from '@necromancer/engine';

const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx|py)$/i;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.mypy_cache',
  // Séance bundles written by an earlier run import the old package on purpose.
  'seance',
]);
const MAX_DEPTH = 8;
const MAX_FILES = 2000;
const MAX_BYTES = 2 * 1024 * 1024;

export interface ProjectSources {
  files: SourceFile[];
  /** Files that look like source but could not be read, and why (plain English). */
  unreadable: string[];
  /** Other limits that were hit. */
  notes: string[];
}

/** Does the path look like a test file? Used to say "only used in tests". */
export function isTestPath(p: string): boolean {
  const rel = p.split(path.sep).join('/');
  return (
    /(^|\/)(test|tests|__tests__|spec|specs)\//i.test(rel) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel) ||
    /(^|\/)test_[^/]*\.py$/i.test(rel) ||
    /_test\.py$/i.test(rel) ||
    /(^|\/)conftest\.py$/i.test(rel)
  );
}

/**
 * Reads the JavaScript, TypeScript and Python files of a project for the usage scan. Read-only.
 * Symbolic links are never followed, so a link cannot lead the reader out of the project.
 * Nothing is thrown for a file that cannot be read: it is listed in `unreadable`.
 */
export async function readSourceFiles(root: string): Promise<ProjectSources> {
  const files: SourceFile[] = [];
  const unreadable: string[] = [];
  const notes: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      unreadable.push(`${path.relative(root, dir) || '.'}: directory cannot be read (${(err as NodeJS.ErrnoException).code ?? 'error'}).`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) {
          notes.push(`${path.relative(root, full)}: not entered, deeper than ${MAX_DEPTH} levels.`);
        } else if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (files.length >= MAX_FILES) {
        if (!notes.some((n) => n.startsWith('more than'))) notes.push(`more than ${MAX_FILES} source files; the rest were not read.`);
        continue;
      }
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_BYTES) {
          unreadable.push(`${rel}: larger than ${MAX_BYTES} bytes, not read.`);
          continue;
        }
        const buf = await fs.readFile(full);
        if (buf.includes(0)) {
          unreadable.push(`${rel}: contains binary data, not read.`);
          continue;
        }
        files.push({ path: rel, content: buf.toString('utf8') });
      } catch (err) {
        unreadable.push(`${rel}: cannot be read (${(err as NodeJS.ErrnoException).code ?? 'error'}).`);
      }
    }
  }

  await walk(root, 0);
  return { files, unreadable, notes };
}
