/**
 * Which package a repository holds now (round 5).
 *
 * A repository that was renamed keeps its old address alive, so the engine follows it. Sometimes the new name
 * is another package: `py-pdf/PyPDF2` became `py-pdf/pypdf`, and PyPDF2 was folded into pypdf. The commits
 * there are the other package's life, not PyPDF2's. The manifest at the head of the repository names the
 * package it holds: `package.json` (npm) or `pyproject.toml` (PyPI). A monorepo root (private) holds many packages and says nothing about one of them, so it is never taken.
 */

import type { Http } from '../net/http.js';
import { isRecord } from '../util/guards.js';
import { type Fetched, fail } from './result.js';

export interface HeldPackage {
  name: string;
}

/** The package name in a `pyproject.toml`: `[project] name` or `[tool.poetry] name`. */
export function pyprojectName(text: string): string | undefined {
  const section = /^\[(project|tool\.poetry)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm;
  for (const m of text.matchAll(section)) {
    const name = /^\s*name\s*=\s*["']([^"'\n]{1,214})["']/m.exec(m[2] ?? '');
    if (name?.[1]) return name[1];
  }
  return undefined;
}

/** The package name in a `package.json`, unless the file is a private monorepo root. */
export function packageJsonName(text: string): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  if (data['private'] === true) return undefined;
  const name = data['name'];
  return typeof name === 'string' && name.length > 0 && name.length <= 214 ? name : undefined;
}

/**
 * The package that `owner/name` holds at its head, or null when the manifest is missing, unreadable or a
 * monorepo root. From raw.githubusercontent.com, so it costs none of the GitHub REST API's limit.
 */
export async function getHeldPackage(
  http: Http,
  ecosystem: 'npm' | 'pypi',
  slug: string,
): Promise<Fetched<HeldPackage | null>> {
  const file = ecosystem === 'npm' ? 'package.json' : 'pyproject.toml';
  const [owner, name] = slug.split('/');
  if (!owner || !name) return { ok: true, value: null };
  const r = await http.request(
    `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/HEAD/${file}`,
    undefined,
    'text',
  );
  if (!r.ok) {
    if (r.kind === 'not-found') return { ok: true, value: null };
    return fail(r);
  }
  if (typeof r.data !== 'string') return { ok: true, value: null };
  const held = ecosystem === 'npm' ? packageJsonName(r.data) : pyprojectName(r.data);
  return { ok: true, value: held ? { name: held } : null };
}
