import type { DependencyRef, ManifestFile, ParseResult } from '../types.js';
import {
  asString,
  clip,
  errorMessage,
  getOwn,
  isRecord,
  type UnknownRecord,
} from '../util/guards.js';
import { isValidNpmName } from '../util/names.js';
import { parseVersion } from '../versions/semver.js';
import { emptyResult } from './common.js';
import { stripBom } from './package-json.js';

type Scope = DependencyRef['scope'];

const ROOT_FIELDS = [
  ['dependencies', 'main'],
  ['devDependencies', 'dev'],
  ['optionalDependencies', 'optional'],
  ['peerDependencies', 'peer'],
] as const;

function scopeOf(entry: UnknownRecord): Scope {
  if (entry['dev'] === true || entry['devOptional'] === true) return 'dev';
  if (entry['optional'] === true) return 'optional';
  if (entry['peer'] === true) return 'peer';
  return 'main';
}

function isRegistryResolved(resolved: unknown): boolean {
  if (resolved === undefined) return true; // v1 entries and some v3 entries omit it
  const text = asString(resolved);
  return text !== undefined && /^https?:\/\//i.test(text) && !/^git\+/i.test(text);
}

export function parsePackageLock(file: ManifestFile): ParseResult {
  const result = emptyResult();
  let json: unknown;
  try {
    json = JSON.parse(stripBom(file.content));
  } catch (error) {
    result.problems.push(`${file.path} is not valid JSON (${clip(errorMessage(error), 100)}).`);
    return result;
  }
  if (!isRecord(json)) {
    result.problems.push(`${file.path} is valid JSON but not an object.`);
    return result;
  }
  let skipped = 0;
  const packages = getOwn(json, 'packages');
  if (isRecord(packages)) {
    skipped = readPackagesMap(packages, file, result.dependencies);
  } else if (isRecord(getOwn(json, 'dependencies'))) {
    // lockfileVersion 1: nested "dependencies" tree. It does not say which are direct.
    skipped = readLegacyTree(
      getOwn(json, 'dependencies') as UnknownRecord,
      file,
      result.dependencies,
      0,
    );
  } else {
    result.problems.push(`${file.path} has no "packages" or "dependencies" section.`);
  }
  if (skipped > 0) {
    result.problems.push(
      `Skipped ${skipped} lockfile ${skipped === 1 ? 'entry' : 'entries'} that ${skipped === 1 ? 'does' : 'do'} not come from a registry (links, git, local paths).`,
    );
  }
  return result;
}

function readPackagesMap(
  packages: UnknownRecord,
  file: ManifestFile,
  out: DependencyRef[],
): number {
  const root = getOwn(packages, '');
  const declared = new Map<string, { spec: string; scope: Scope }>();
  if (isRecord(root)) {
    for (const [field, scope] of ROOT_FIELDS) {
      const table = getOwn(root, field);
      if (!isRecord(table)) continue;
      for (const [name, spec] of Object.entries(table)) {
        if (typeof spec === 'string' && !declared.has(name)) declared.set(name, { spec, scope });
      }
    }
  }
  let skipped = 0;
  for (const [path, entry] of Object.entries(packages)) {
    if (path === '' || !isRecord(entry)) continue;
    const marker = path.lastIndexOf('node_modules/');
    if (marker < 0) continue; // a workspace member's own folder, not an installed package
    if (entry['link'] === true) {
      skipped++;
      continue;
    }
    const installName = path.slice(marker + 'node_modules/'.length);
    const name = asString(entry['name']) ?? installName;
    const version = asString(entry['version']);
    if (!version || !parseVersion(version) || !isRegistryResolved(entry['resolved'])) {
      skipped++;
      continue;
    }
    if (!isValidNpmName(name)) {
      skipped++;
      continue;
    }
    const topLevel = path === `node_modules/${installName}`;
    const decl = topLevel ? declared.get(installName) : undefined;
    out.push({
      ecosystem: 'npm',
      name,
      spec: decl ? decl.spec : '',
      resolved: version,
      direct: decl !== undefined,
      scope: decl ? decl.scope : scopeOf(entry),
      declaredIn: file.path,
    });
  }
  return skipped;
}

const MAX_TREE_DEPTH = 64;

function readLegacyTree(
  tree: UnknownRecord,
  file: ManifestFile,
  out: DependencyRef[],
  depth: number,
): number {
  if (depth > MAX_TREE_DEPTH) return 0;
  let skipped = 0;
  for (const [installName, raw] of Object.entries(tree)) {
    if (!isRecord(raw)) continue;
    let name = installName;
    let version = asString(raw['version']);
    if (version && /^npm:/i.test(version)) {
      const target = version.slice(4);
      const at = target.lastIndexOf('@');
      if (at > 0) {
        name = target.slice(0, at);
        version = target.slice(at + 1);
      }
    }
    if (
      !version ||
      !parseVersion(version) ||
      !isValidNpmName(name) ||
      !isRegistryResolved(raw['resolved'])
    ) {
      skipped++;
    } else {
      out.push({
        ecosystem: 'npm',
        name,
        spec: '',
        resolved: version,
        direct: false,
        scope: scopeOf(raw),
        declaredIn: file.path,
      });
    }
    const nested = getOwn(raw, 'dependencies');
    if (isRecord(nested)) skipped += readLegacyTree(nested, file, out, depth + 1);
  }
  return skipped;
}
