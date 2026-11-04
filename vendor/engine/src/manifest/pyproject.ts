import type { DependencyRef, ManifestFile, ParseResult } from '../types.js';
import { asString, clip, getOwn, isRecord, type UnknownRecord } from '../util/guards.js';
import { isValidPypiName, normalizePypiName } from '../util/names.js';
import { parseToml } from '../util/toml.js';
import { emptyResult } from './common.js';
import { parseRequirement } from './requirement.js';

type Scope = DependencyRef['scope'];

const DEV_GROUP =
  /^(?:dev|devel|develop|development|test|tests|testing|lint|linting|docs?|ci|typing|types|check|checks|qa)$/i;

function table(value: unknown, ...path: string[]): UnknownRecord | undefined {
  let node: unknown = value;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = getOwn(node, key);
  }
  return isRecord(node) ? node : undefined;
}

export function parsePyproject(file: ManifestFile): ParseResult {
  const result = emptyResult();
  const toml = parseToml(file.content);
  if (toml.error) {
    result.problems.push(
      `${file.path} is not valid TOML (line ${toml.error.line}: ${toml.error.message}). Everything before that line was read; the rest was not.`,
    );
  }
  const root = toml.value;
  const add = (text: unknown, scope: Scope, where: string): void => {
    if (typeof text !== 'string') {
      result.problems.push(`Skipped an entry in ${where}: it is not a string.`);
      return;
    }
    const parsed = parseRequirement(text);
    if (parsed.kind === 'ok') {
      result.dependencies.push({
        ecosystem: 'pypi',
        name: parsed.name,
        spec: parsed.spec,
        direct: true,
        scope,
        declaredIn: file.path,
      });
    } else if (parsed.kind === 'skip') {
      result.problems.push(
        `Skipped ${parsed.name ? `"${parsed.name}"` : `"${clip(text, 50)}"`} in ${where}: it is ${parsed.label}.`,
      );
    } else {
      result.problems.push(`Skipped an entry in ${where}: ${parsed.message}.`);
    }
  };
  const addList = (list: unknown, scope: Scope, where: string): void => {
    if (!Array.isArray(list)) {
      result.problems.push(`${where} in ${file.path} is not a list, so it was not read.`);
      return;
    }
    for (const item of list) {
      if (isRecord(item)) continue; // PEP 735 {include-group = "..."}
      add(item, scope, where);
    }
  };

  // PEP 621
  const project = table(root, 'project');
  if (project) {
    const deps = getOwn(project, 'dependencies');
    if (deps !== undefined) addList(deps, 'main', 'project.dependencies');
    const optional = table(project, 'optional-dependencies');
    if (optional) {
      for (const [group, list] of Object.entries(optional)) {
        addList(
          list,
          DEV_GROUP.test(group) ? 'dev' : 'optional',
          `project.optional-dependencies.${clip(group, 30)}`,
        );
      }
    }
  }
  // PEP 735
  const groups = table(root, 'dependency-groups');
  if (groups) {
    for (const [group, list] of Object.entries(groups)) {
      addList(list, 'dev', `dependency-groups.${clip(group, 30)}`);
    }
  }
  // uv and PDM
  const uvDev = getOwn(table(root, 'tool', 'uv') ?? {}, 'dev-dependencies');
  if (uvDev !== undefined) addList(uvDev, 'dev', 'tool.uv.dev-dependencies');
  const pdmDev = table(root, 'tool', 'pdm', 'dev-dependencies');
  if (pdmDev) {
    for (const [group, list] of Object.entries(pdmDev)) {
      addList(list, 'dev', `tool.pdm.dev-dependencies.${clip(group, 30)}`);
    }
  }
  // Poetry
  const poetry = table(root, 'tool', 'poetry');
  if (poetry) {
    readPoetryTable(table(poetry, 'dependencies'), 'main', 'tool.poetry.dependencies');
    readPoetryTable(table(poetry, 'dev-dependencies'), 'dev', 'tool.poetry.dev-dependencies');
    const poetryGroups = table(poetry, 'group');
    if (poetryGroups) {
      for (const [group, body] of Object.entries(poetryGroups)) {
        readPoetryTable(
          table(body, 'dependencies'),
          group === 'main' ? 'main' : 'dev',
          `tool.poetry.group.${clip(group, 30)}.dependencies`,
        );
      }
    }
  }
  return result;

  function readPoetryTable(deps: UnknownRecord | undefined, scope: Scope, where: string): void {
    if (!deps) return;
    for (const [rawName, value] of Object.entries(deps)) {
      if (rawName.toLowerCase() === 'python') continue;
      if (!isValidPypiName(rawName)) {
        result.problems.push(`Skipped "${clip(rawName, 60)}" in ${where}: invalid package name.`);
        continue;
      }
      const name = normalizePypiName(rawName);
      const alternatives = Array.isArray(value) ? value : [value];
      let picked: { spec: string; optional: boolean } | undefined;
      let skipLabel = 'not a registry dependency';
      for (const alt of alternatives) {
        if (typeof alt === 'string') {
          picked = { spec: alt.trim(), optional: false };
          break;
        }
        if (!isRecord(alt)) continue;
        if (alt['git'] !== undefined || alt['path'] !== undefined || alt['url'] !== undefined) {
          skipLabel =
            alt['git'] !== undefined
              ? 'a git source'
              : alt['url'] !== undefined
                ? 'a URL'
                : 'a local path';
          continue;
        }
        picked = {
          spec: asString(alt['version'])?.trim() ?? '',
          optional: alt['optional'] === true,
        };
        break;
      }
      if (!picked) {
        result.problems.push(`Skipped "${name}" in ${where}: its source is ${skipLabel}.`);
        continue;
      }
      result.dependencies.push({
        ecosystem: 'pypi',
        name,
        spec: picked.spec,
        direct: true,
        scope: picked.optional ? 'optional' : scope,
        declaredIn: file.path,
      });
    }
  }
}
