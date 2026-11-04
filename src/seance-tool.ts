import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DependencyUsage, SeanceBundle } from '@necromancer/engine';
import { isTestPath, type ProjectSources } from './project-files';

const execFileAsync = promisify(execFile);

export class SeanceError extends Error {}

/**
 * The bundle's install commands list the old package among the dev dependencies the séance needs. Run as
 * written, `npm install --save-dev ... <old>` would move the dead dependency from `dependencies` to
 * `devDependencies` while the code still requires it. The old package is already installed (it is the
 * project's dependency); the commands keep only the test tooling.
 */
export function cleanInstall(
  commands: string[],
  dependency: string,
): { install: string[]; note?: string } {
  const out: string[] = [];
  let removed = false;
  for (const cmd of commands) {
    const m = /^(npm install --save-dev)\s+(.+)$/.exec(cmd.trim());
    if (!m) {
      out.push(cmd);
      continue;
    }
    const kept = (m[2] ?? '').split(/\s+/).filter((t) => t !== dependency && !t.startsWith(`${dependency}@`));
    if (kept.length !== (m[2] ?? '').split(/\s+/).length) removed = true;
    if (kept.length > 0) out.push(`${m[1]} ${kept.join(' ')}`);
  }
  return removed
    ? {
        install: out,
        note: `The bundle's own install command also names ${dependency}; it was left out so the dead dependency stays where the project declares it until you remove it. The séance's old-versus-new comparison needs ${dependency} installed (it is, while the project still depends on it).`,
      }
    : { install: out };
}

export interface UsageReport {
  filesScanned: number;
  filesUsing: string[];
  /** The dependency is imported, and only in test files. */
  onlyInTests: boolean;
  /** No file imports the dependency at run time. */
  notUsed: boolean;
  /** Imported, but no member is ever called. */
  neverCalled: boolean;
  members: Array<{ member: string; calls: number; accesses: number; argCounts: number[] }>;
  unresolvedDynamicImports: number;
  /** Files the scan could not read, and other limits, in plain English. */
  unreadable: string[];
  notes: string[];
  /** Messages from the scan itself. */
  problems: string[];
  /** What the agent should do about the above. Empty when nothing is unusual. */
  warnings: string[];
}

/** A short, honest summary of the scan, with a warning for each unusual case. */
export function summarizeUsage(usage: DependencyUsage, sources: ProjectSources): UsageReport {
  const runtime = usage.imports.filter((i) => !i.typeOnly);
  const filesUsing = usage.filesUsing;
  const notUsed = runtime.length === 0;
  const onlyInTests = !notUsed && filesUsing.length > 0 && filesUsing.every((f) => isTestPath(f));
  const warnings: string[] = [];
  if (notUsed) {
    warnings.push(
      `Stop here: no source file imports ${usage.name} at run time, so there is no call to compare. First look for a use the scan cannot see (a plugin loaded by name, a script, a config file). If there is none, tell the user the dependency is unused and that removing it (for example npm uninstall ${usage.name}) is the fix. Do not remove it yourself and do not create a branch.`,
    );
  } else if (usage.neverCalled) {
    warnings.push(`${usage.name} is imported but no member is ever called, so there is no call to compare.`);
  }
  if (onlyInTests) {
    warnings.push(
      `${usage.name} is imported only in test files (${filesUsing.join(', ')}). Production code does not use it; migrate the tests, or remove the dependency.`,
    );
  }
  if (usage.unresolvedDynamicImports > 0) {
    warnings.push(
      `${usage.unresolvedDynamicImports} dynamic import(s) with a computed specifier could not be attributed. Look at them by hand.`,
    );
  }
  if (sources.unreadable.length > 0) {
    warnings.push(
      `${sources.unreadable.length} file(s) could not be read (${sources.unreadable.slice(0, 3).join('; ')}${sources.unreadable.length > 3 ? '; ...' : ''}). Calls in them are not in the séance's examples; open them by hand.`,
    );
  }
  return {
    filesScanned: usage.filesScanned,
    filesUsing,
    onlyInTests,
    notUsed,
    neverCalled: usage.neverCalled,
    members: usage.members.map((m) => ({
      member: m.member,
      calls: m.calls,
      accesses: m.accesses,
      argCounts: m.argCounts,
    })),
    unresolvedDynamicImports: usage.unresolvedDynamicImports,
    unreadable: sources.unreadable,
    notes: sources.notes,
    problems: usage.problems,
    warnings,
  };
}

/** A bundle path is safe when it is relative, stays inside the project and avoids .git. */
export function isSafeBundlePath(p: string): boolean {
  if (typeof p !== 'string' || p === '' || p.length > 300) return false;
  if (path.isAbsolute(p) || p.includes('\\') || p.includes('\0')) return false;
  const parts = p.split('/');
  return parts.every((s) => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git');
}

async function currentBranch(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    throw new SeanceError(`${root} is not a git repository, so the séance is not written. Nothing was changed.`);
  }
}

export interface WriteResult {
  branch: string;
  written: string[];
  unchanged: string[];
}

/**
 * Writes the bundle into the project. It only ever writes while the project is on a branch named
 * `resurrect/...`, never overwrites a file whose content differs (nothing is written at all then),
 * and refuses any path that would leave the project.
 */
export async function writeBundle(root: string, bundle: SeanceBundle): Promise<WriteResult> {
  const realRoot = await fs.realpath(root);
  const branch = await currentBranch(realRoot);
  if (!/^resurrect\/[^\s]+$/.test(branch)) {
    throw new SeanceError(
      `The project is on branch "${branch}". The séance is written only on a branch named resurrect/<dependency>. Create it first (git switch -c resurrect/<dependency>). Nothing was changed.`,
    );
  }
  if (bundle.files.length === 0) throw new SeanceError('The generator returned no files.');

  const plan: Array<{ rel: string; target: string; content: string; same: boolean }> = [];
  const conflicts: string[] = [];
  for (const file of bundle.files) {
    if (!isSafeBundlePath(file.path)) {
      throw new SeanceError(`Refused: "${file.path}" is not a safe relative path. Nothing was changed.`);
    }
    const target = path.join(realRoot, ...file.path.split('/'));
    // The nearest existing parent must really live inside the project (no symbolic link out).
    let probe = path.dirname(target);
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
          throw new SeanceError(`Refused: "${file.path}" would be written outside the project. Nothing was changed.`);
        }
        break;
      } catch (err) {
        if (err instanceof SeanceError) throw err;
        const parent = path.dirname(probe);
        if (parent === probe) throw new SeanceError(`Refused: cannot place "${file.path}". Nothing was changed.`);
        probe = parent;
      }
    }
    let existing: string | undefined;
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        conflicts.push(`${file.path} exists and is not a regular file`);
        continue;
      }
      existing = await fs.readFile(target, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (existing !== undefined && existing !== file.content) conflicts.push(`${file.path} already exists with different content`);
    plan.push({ rel: file.path, target, content: file.content, same: existing === file.content });
  }
  if (conflicts.length > 0) {
    throw new SeanceError(`Refused to overwrite: ${conflicts.join('; ')}. Nothing was changed.`);
  }

  const written: string[] = [];
  const unchanged: string[] = [];
  for (const item of plan) {
    if (item.same) {
      unchanged.push(item.rel);
      continue;
    }
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    await fs.writeFile(item.target, item.content, { flag: 'wx', mode: 0o644 });
    written.push(item.rel);
  }
  return { branch, written, unchanged };
}
