/** One PEP 508 requirement string, as used by requirements.txt and pyproject.toml. */

import { clip } from '../util/guards.js';
import { isValidPypiName, normalizePypiName } from '../util/names.js';

export type RequirementParse =
  | { kind: 'ok'; name: string; spec: string }
  | { kind: 'skip'; label: string; name?: string }
  | { kind: 'invalid'; message: string };

const NAME_PART = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*(.*)$/;
const CLAUSE = '(?:===|==|!=|~=|<=|>=|<|>)\\s*[A-Za-z0-9*+!._-]+';
const SPECIFIER = new RegExp(`^\\(?\\s*${CLAUSE}(?:\\s*,\\s*${CLAUSE})*\\s*\\)?$`);

/** Parse "Name[extra]>=1,<2 ; python_version < '3.9'". Extras and markers are dropped. */
/** Longest requirement text read. Longer text is refused, which also bounds regex work. */
export const MAX_REQUIREMENT_CHARS = 2000;

export function parseRequirement(raw: string): RequirementParse {
  if (raw.length > MAX_REQUIREMENT_CHARS) {
    return {
      kind: 'invalid',
      message: `a requirement longer than ${MAX_REQUIREMENT_CHARS} characters`,
    };
  }
  // Per-requirement options such as "--hash=sha256:..." are not part of the requirement.
  let text = raw.split(/\s+--?[A-Za-z]/)[0] ?? '';
  text = text.trim();
  if (text === '') return { kind: 'invalid', message: 'empty requirement' };
  // Direct references and paths
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|git\+|file:|\.{1,2}(?:\/|$)|\/|~\/)/i.test(text)) {
    return { kind: 'skip', label: 'a URL or local path' };
  }
  const semicolon = text.indexOf(';');
  const beforeMarker = (semicolon >= 0 ? text.slice(0, semicolon) : text).trim();
  const at = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*@\s*\S/.exec(
    beforeMarker,
  );
  if (at)
    return { kind: 'skip', label: 'a direct URL reference', name: normalizePypiName(at[1] ?? '') };
  if (/\.(?:whl|tar\.gz|zip|tgz)$/i.test(beforeMarker) && !SPECIFIER.test(beforeMarker)) {
    return { kind: 'skip', label: 'a local archive' };
  }
  const m = NAME_PART.exec(beforeMarker);
  if (!m) return { kind: 'invalid', message: `cannot read "${clip(text, 60)}"` };
  const name = m[1] ?? '';
  const rest = (m[2] ?? '').trim();
  if (!isValidPypiName(name))
    return { kind: 'invalid', message: `invalid package name "${clip(name, 60)}"` };
  if (rest !== '' && !SPECIFIER.test(rest)) {
    return {
      kind: 'invalid',
      message: `cannot read the version of "${clip(name, 60)}": "${clip(rest, 60)}"`,
    };
  }
  const spec = rest.replace(/^\(\s*/, '').replace(/\s*\)$/, '');
  return { kind: 'ok', name: normalizePypiName(name), spec };
}
