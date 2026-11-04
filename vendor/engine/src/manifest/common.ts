import type { ParseResult } from '../types.js';
import { clip } from '../util/guards.js';
import { isValidNpmName } from '../util/names.js';

export function emptyResult(): ParseResult {
  return { dependencies: [], problems: [] };
}

export type NpmSpecClass =
  { kind: 'registry'; name: string; spec: string } | { kind: 'skip'; label: string };

const LOCAL = /^(?:file:|link:|portal:|\.{1,2}(?:\/|$)|\/|~\/)/;
const GIT = /^(?:git(?:\+[a-z]+)?:|github:|gitlab:|bitbucket:|gist:|ssh:)/i;

/**
 * Decide whether an npm `name: spec` pair can be looked up in the registry.
 * Aliases (`npm:real@^1`) resolve to the real package name.
 */
export function classifyNpmSpec(name: string, specRaw: string): NpmSpecClass {
  const spec = specRaw.trim();
  if (/^npm:/i.test(spec)) {
    const target = spec.slice(4);
    const at = target.lastIndexOf('@');
    const realName = at > 0 ? target.slice(0, at) : target;
    return isValidNpmName(realName)
      ? { kind: 'registry', name: realName, spec: specRaw }
      : { kind: 'skip', label: 'an alias to an invalid package name' };
  }
  if (/^workspace:/i.test(spec)) return { kind: 'skip', label: 'a workspace link' };
  if (/^catalog:/i.test(spec)) return { kind: 'skip', label: 'a catalog entry' };
  if (/^jsr:/i.test(spec)) return { kind: 'skip', label: 'a JSR package' };
  if (/^(?:patch|exec):/i.test(spec))
    return { kind: 'skip', label: 'a patched or generated package' };
  if (GIT.test(spec)) return { kind: 'skip', label: 'a git source' };
  if (/^https?:\/\//i.test(spec)) return { kind: 'skip', label: 'a URL' };
  if (LOCAL.test(spec)) return { kind: 'skip', label: 'a local path' };
  // GitHub shorthand "user/repo#ref". A version range never contains "/".
  if (spec.includes('/')) return { kind: 'skip', label: 'a repository shorthand' };
  if (!isValidNpmName(name)) return { kind: 'skip', label: 'an invalid package name' };
  return { kind: 'registry', name, spec: specRaw };
}

export function skipProblem(name: string, label: string, spec: string): string {
  // The name itself is the problem; the quoted value would be the version, which is not.
  if (label === 'an invalid package name') {
    return `Skipped "${clip(name, 60)}": it is not a valid package name, so it is not checked against a registry.`;
  }
  return `Skipped "${clip(name, 60)}": its source is ${label} ("${clip(spec, 60)}"), which is not checked against a registry.`;
}
