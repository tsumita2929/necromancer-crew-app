import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A path or a name the tools refuse, with a plain-English reason that names the value. */
export class GuardError extends Error {}

const MANIFEST_NAMES = ['package.json', 'package-lock.json', 'requirements.txt', 'pyproject.toml'];

/** Shows a value in a message without letting a newline or control character change the line. */
export function show(value: unknown): string {
  return JSON.stringify(String(value ?? '')).slice(0, 200);
}

/**
 * A package name that is safe to put in advice text and in a command line: letters, digits and `._~-`,
 * with an optional npm scope. Anything else (a space, a quote, a backtick, `$`, `;`, `|`, `&`, a newline) is refused.
 */
export const SAFE_PACKAGE_NAME = /^(@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/;

export function assertSafeName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214 || !SAFE_PACKAGE_NAME.test(name)) {
    throw new GuardError(
      `${show(name)} is not a package name the tools accept (letters, digits and . _ ~ - only, with an optional @scope/). Nothing was run.`,
    );
  }
  return name;
}

/** Single-quote a value for a POSIX shell, in case a name ever reaches a command line anyway. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface ProjectDir {
  /** The path as given. */
  given: string;
  /** The real path, after symbolic links. */
  real: string;
  /** The manifests that sit directly in the directory. */
  manifests: string[];
}

/**
 * A directory the tools may read as a project. It must be an absolute path (a relative one is refused, never resolved against the
 * server's working directory), a real directory, not the filesystem root, not a home directory or a folder above one, and it must hold a
 * manifest directly (package.json, package-lock.json, requirements.txt or pyproject.toml). Symbolic links are resolved first, so a link to
 * `/` is refused as `/`.
 */
export async function resolveProjectDir(input: unknown, what = 'path'): Promise<ProjectDir> {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new GuardError(`The ${what} is empty. Give the absolute path of a project directory.`);
  }
  if (input.includes('\0') || /[\r\n]/.test(input)) {
    throw new GuardError(`The ${what} ${show(input)} holds a control character and was refused.`);
  }
  if (!path.isAbsolute(input)) {
    throw new GuardError(
      `The ${what} ${show(input)} is relative. Give the absolute path of the project directory; a relative path is not resolved against the server's working directory.`,
    );
  }
  let real: string;
  try {
    real = await fs.realpath(input);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new GuardError(`${show(input)} does not exist or is not a directory.`);
  }
  const via = real === input ? '' : ` (it resolves to ${show(real)})`;
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir());
  if (real === path.parse(real).root) {
    throw new GuardError(`${show(input)}${via} is the filesystem root, not a project. Point at one project directory.`);
  }
  if (real === home || home.startsWith(real + path.sep)) {
    throw new GuardError(
      `${show(input)}${via} is a home directory or a folder above one, not a project. Point at one project directory.`,
    );
  }
  const manifests: string[] = [];
  for (const name of MANIFEST_NAMES) {
    try {
      if ((await fs.stat(path.join(real, name))).isFile()) manifests.push(name);
    } catch {
      /* not there */
    }
  }
  if (manifests.length === 0) {
    throw new GuardError(
      `${show(input)}${via} has none of ${MANIFEST_NAMES.join(', ')} directly in it, so it is not read as a project. Point at the project's root directory.`,
    );
  }
  return { given: input, real, manifests };
}
