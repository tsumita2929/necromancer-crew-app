import type { DependencyRef, ManifestFile, ParseResult } from '../types.js';
import { asString, clip, errorMessage, getOwn, isRecord } from '../util/guards.js';
import { classifyNpmSpec, emptyResult, skipProblem } from './common.js';

const FIELDS = [
  ['dependencies', 'main'],
  ['devDependencies', 'dev'],
  ['optionalDependencies', 'optional'],
  ['peerDependencies', 'peer'],
] as const;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parsePackageJson(file: ManifestFile): ParseResult {
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
  for (const [field, scope] of FIELDS) {
    const table = getOwn(json, field);
    if (table === undefined) continue;
    if (!isRecord(table)) {
      result.problems.push(`"${field}" in ${file.path} is not an object, so it was not read.`);
      continue;
    }
    for (const [name, value] of Object.entries(table)) {
      const spec = asString(value);
      if (spec === undefined) {
        result.problems.push(
          `Skipped "${clip(name, 60)}" in "${field}": its version is not a string.`,
        );
        continue;
      }
      const classified = classifyNpmSpec(name, spec);
      if (classified.kind === 'skip') {
        result.problems.push(skipProblem(name, classified.label, spec));
        continue;
      }
      const dep: DependencyRef = {
        ecosystem: 'npm',
        name: classified.name,
        spec: classified.spec,
        direct: true,
        scope,
        declaredIn: file.path,
      };
      result.dependencies.push(dep);
    }
  }
  return result;
}
