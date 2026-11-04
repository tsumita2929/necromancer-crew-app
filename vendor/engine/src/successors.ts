/**
 * Successor discovery: curated list, e18e module-replacements, deprecation messages.
 */

import { curatedSuccessors } from './curated.js';
import type { Ecosystem, SourceId, Successor } from './types.js';
import { isValidNpmName } from './util/names.js';

const NATIVE_API =
  /\b((?:Array|String|Object|Number|Math|Promise|Map|Set|WeakMap|Date|JSON|Reflect|Symbol|Intl|Buffer|URL|URLSearchParams|BigInt|globalThis|AbortController|TextEncoder|TextDecoder)(?:\.[A-Za-z_$][\w$]*)+)(?:\(\))?/g;

const CUE =
  /(?:\buse|\busing|replaced (?:by|with)|moved to|migrate to|switch to|renamed to|superseded by|in favou?r of|install)\s+(?:the\s+)?(?:npm\s+package\s+)?(?:`([^`]+)`|'([^']+)'|"([^"]+)"|(@[a-z0-9~-][\w.~-]*\/[\w.~-]+|[a-z0-9][\w.~-]*))/gi;
const TICKED = /`([^`\s]+)`/g;

const STOP = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'it',
  'its',
  'one',
  'new',
  'newer',
  'latest',
  'native',
  'built',
  'builtin',
  'built-in',
  'node',
  'npm',
  'yarn',
  'pnpm',
  'package',
  'packages',
  'module',
  'modules',
  'version',
  'versions',
  'instead',
  'please',
  'see',
  'more',
  'information',
  'now',
  'only',
  'any',
  'another',
  'other',
  'standard',
  'platform',
  'browser',
  'javascript',
  'typescript',
  'es6',
  'install',
  'upgrade',
  'update',
  'github',
  'https',
  'http',
  'and',
  'or',
  'for',
  'to',
  'of',
]);

export interface DeprecationTargets {
  packages: string[];
  natives: string[];
}

/** Names a deprecation message points to. Conservative: a wrong guess is worse than none. */
export function parseDeprecationTargets(message: string, self: string): DeprecationTargets {
  const text = message.length > 1000 ? message.slice(0, 1000) : message;
  const natives = new Set<string>();
  for (const m of text.matchAll(NATIVE_API)) if (m[1]) natives.add(m[1]);
  const names = new Set<string>();
  const consider = (raw: string | undefined, quoted: boolean): void => {
    if (!raw) return;
    const name = raw.replace(/[.,;:)]+$/, '');
    if (name === self || STOP.has(name.toLowerCase())) return;
    if (/\s|\/\//.test(name) || name.startsWith('http')) return;
    if (name !== name.toLowerCase() && !name.startsWith('@')) return; // JS APIs, product names
    if (!isValidNpmName(name)) return;
    // Plain words after "use" are too ambiguous unless quoted or clearly a package name.
    if (!quoted && !/[-@/.\d]/.test(name)) return;
    names.add(name);
  };
  for (const m of text.matchAll(TICKED)) consider(m[1], true);
  for (const m of text.matchAll(CUE)) {
    consider(m[1], true);
    consider(m[2], true);
    consider(m[3], true);
    consider(m[4], false);
  }
  for (const native of natives) names.delete(native);
  return { packages: [...names].slice(0, 3), natives: [...natives].slice(0, 3) };
}

export interface SuccessorInputs {
  ecosystem: Ecosystem;
  name: string;
  deprecation?: string;
  deprecationSource?: SourceId;
  replacements: Successor[];
  /** Successors found elsewhere in the engine (the package a renamed repository holds now), first in line. */
  known?: Successor[];
  /** Returns true when the package exists and is not deprecated. */
  verifyPackage?: (name: string) => Promise<boolean>;
}

/** Best first, unique by name, never the dependency itself. */
export async function findSuccessors(input: SuccessorInputs): Promise<Successor[]> {
  const list: Successor[] = [
    ...(input.known ?? []),
    ...curatedSuccessors(input.ecosystem, input.name),
  ];
  if (input.ecosystem === 'npm') list.push(...input.replacements);
  if (input.ecosystem === 'npm' && input.deprecation) {
    const source = input.deprecationSource ?? 'npm';
    const targets = parseDeprecationTargets(input.deprecation, input.name);
    for (const native of targets.natives) {
      list.push({
        name: native,
        ecosystem: 'npm',
        kind: 'native',
        reason: `The deprecation message points to ${native}, which is built into the platform.`,
        source,
      });
    }
    for (const candidate of targets.packages) {
      if (input.verifyPackage && !(await input.verifyPackage(candidate))) continue;
      list.push({
        name: candidate,
        ecosystem: 'npm',
        kind: 'package',
        reason: `The deprecation message points to ${candidate}.`,
        source,
        url: `https://www.npmjs.com/package/${candidate}`,
      });
    }
  }
  const seen = new Set<string>();
  const out: Successor[] = [];
  const self = input.ecosystem === 'pypi' ? input.name.toLowerCase() : input.name;
  for (const successor of list) {
    const key = `${successor.kind === 'package' ? 'p' : 'x'}:${successor.name}`;
    const comparable = input.ecosystem === 'pypi' ? successor.name.toLowerCase() : successor.name;
    if (comparable === self && successor.kind === 'package') continue;
    if (seen.has(key) || !successor.reason.trim() || !successor.name.trim()) continue;
    seen.add(key);
    out.push(successor);
  }
  // A low-confidence mapping is a suggestion: it goes after the others (stable otherwise).
  return [
    ...out.filter((s) => s.confidence !== 'low'),
    ...out.filter((s) => s.confidence === 'low'),
  ];
}
