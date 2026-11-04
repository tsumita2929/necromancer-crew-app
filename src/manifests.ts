import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ManifestFile, ManifestKind } from '@necromancer/engine';

const KINDS: readonly ManifestKind[] = [
  'package.json',
  'package-lock.json',
  'requirements.txt',
  'pyproject.toml',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__']);
const MAX_DEPTH = 3;
const MAX_FILES = 40;
const MAX_BYTES = 2 * 1024 * 1024;

export interface ReadManifests {
  files: ManifestFile[];
  /** Why parts of the tree were not read. */
  problems: string[];
}

/**
 * Reads the four manifest kinds from a project directory, at most three levels
 * deep. Symbolic links are never followed, so a link cannot lead the reader out
 * of the directory the caller named. Nothing is written.
 */
export async function readManifests(root: string): Promise<ReadManifests> {
  const files: ManifestFile[] = [];
  const problems: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      problems.push(`${path.relative(root, dir).split(path.sep).join('/') || '.'}: cannot read directory (${(err as NodeJS.ErrnoException).code ?? 'error'}).`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || !KINDS.includes(entry.name as ManifestKind)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (files.length >= MAX_FILES) {
        problems.push(`${rel}: skipped, more than ${MAX_FILES} manifests.`);
        continue;
      }
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_BYTES) {
          problems.push(`${rel}: skipped, larger than ${MAX_BYTES} bytes.`);
          continue;
        }
        files.push({ kind: entry.name as ManifestKind, path: rel, content: await fs.readFile(full, 'utf8') });
      } catch (err) {
        problems.push(`${rel}: cannot read file (${(err as NodeJS.ErrnoException).code ?? 'error'}).`);
      }
    }
  }

  await walk(root, 0);
  return { files, problems };
}
