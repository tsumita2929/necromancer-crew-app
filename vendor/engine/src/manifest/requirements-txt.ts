import type { DependencyRef, ManifestFile, ParseResult } from '../types.js';
import { clip } from '../util/guards.js';
import { emptyResult } from './common.js';
import { parseRequirement } from './requirement.js';

const DEV_PATH =
  /(?:^|[/_.-])(?:dev|devel|test|tests|testing|lint|linting|docs?|ci|typing|types)(?:[/_.-]|$)/i;

export function scopeFromPath(path: string): DependencyRef['scope'] {
  return DEV_PATH.test(path) ? 'dev' : 'main';
}

const MAX_LOGICAL_LINE = 20_000;

/**
 * Join lines that end with a backslash, remembering the first line number of each.
 * Like pip, a comment line is never continued. Linear time: parts are collected and
 * joined once, and a runaway continuation is cut at MAX_LOGICAL_LINE characters.
 */
function logicalLines(content: string): Array<{ no: number; text: string }> {
  const raw = content.split(/\r\n|\r|\n/);
  const out: Array<{ no: number; text: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const no = i + 1;
    let line = raw[i] ?? '';
    const parts: string[] = [];
    let total = line.length;
    while (
      line.endsWith('\\') &&
      !line.trimStart().startsWith('#') &&
      i + 1 < raw.length &&
      total <= MAX_LOGICAL_LINE
    ) {
      parts.push(line.slice(0, -1));
      line = raw[++i] ?? '';
      total += line.length;
    }
    parts.push(line);
    out.push({ no, text: parts.join(' ') });
  }
  return out;
}

const SILENT_OPTIONS =
  /^(?:-i|--index-url|--extra-index-url|--no-index|-f|--find-links|--no-binary|--only-binary|--prefer-binary|--pre|--trusted-host|--use-feature|--require-hashes|--no-deps|--config-settings|--hash)\b/;

export function parseRequirementsTxt(file: ManifestFile): ParseResult {
  const result = emptyResult();
  const scope = scopeFromPath(file.path);
  for (const { no, text: rawLine } of logicalLines(file.content)) {
    if (rawLine.length > MAX_LOGICAL_LINE + 1000) {
      result.problems.push(
        `Line ${no}: skipped, it is longer than ${MAX_LOGICAL_LINE} characters.`,
      );
      continue;
    }
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    if (line.startsWith('-')) {
      if (/^(?:-r|--requirement|-c|--constraint)(?:\s|=|(?=[^\s-]))/.test(line)) {
        const target = line.replace(/^(?:--requirement|--constraint|-r|-c)\s*=?\s*/, '');
        result.problems.push(
          `Line ${no}: "${clip(line, 60)}" includes ${clip(target, 40) || 'another file'}, which is read only when it is also provided as a manifest.`,
        );
      } else if (/^(?:-e|--editable)\b/.test(line)) {
        result.problems.push(`Line ${no}: skipped an editable install ("${clip(line, 60)}").`);
      } else if (!SILENT_OPTIONS.test(line)) {
        result.problems.push(`Line ${no}: ignored the option "${clip(line, 60)}".`);
      }
      continue;
    }
    const parsed = parseRequirement(line);
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
        `Line ${no}: skipped ${parsed.name ? `"${parsed.name}"` : `"${clip(line, 50)}"`}, which is ${parsed.label}.`,
      );
    } else {
      result.problems.push(`Line ${no}: skipped, ${parsed.message}.`);
    }
  }
  return result;
}
