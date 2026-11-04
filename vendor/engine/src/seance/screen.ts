/**
 * Which literal arguments of a project call could make a replay reach outside the test (QA-08).
 *
 * The generic séance replays the project's own calls on the old package. A call that names a host, a
 * file path or a command is left out, and the test file, README and spec say so. This is a screen on
 * the text of the literal, not a proof: the guard (`guard.ts`) is the second line, and blocks the
 * network, processes and writes outside a temporary directory whatever the arguments were.
 */

import type { LiteralArg } from '../types.js';

/** What a call's literal arguments name. */
export type Reach = 'network' | 'path' | 'command';

const NETWORK: RegExp[] = [
  /[a-z][a-z0-9+.-]*:\/\//i, // a URL with a scheme
  /^\/\/[^/]/, // a protocol-relative URL
  /(^|[^\w.-])localhost(?![\w-])/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // an IPv4 address
  /(^|[\s@])[\w-]+(?:\.[\w-]+)*:\d{2,5}(?:\/|\s|$)/, // host:port
  /^(?:www\.|mailto:)/i,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|co|edu|gov|ai|cloud|info|me|us|uk|de|jp|cn|ru|fr|nl)\b(?::\d+)?(?:\/|$)/i,
];

const PATHS: RegExp[] = [
  /^[/\\~]/, // absolute, UNC or home
  /^\.{1,2}[/\\]/, // ./ and ../
  /^[A-Za-z]:[\\/]/, // a drive
  /(^|[/\\])\.\.([/\\]|$)/, // a parent step anywhere
  /^file:/i,
  /\$HOME|%USERPROFILE%/,
];

const PROGRAMS =
  'sudo|rm|mv|cp|cat|ls|git|npm|npx|pip3?|python3?|node|docker|kubectl|curl|wget|sh|bash|zsh|powershell|cmd|echo|touch|mkdir|kill|pkill|chmod|chown|dd';
const COMMANDS: RegExp[] = [
  /;|&&|\|\||`|\$\(|\s[|&]\s|>\s*\S/, // shell metacharacters (a bare & in a query string is not one)
  new RegExp(`^(?:${PROGRAMS})(?:\\s|$)`),
];

/** What the text of one literal argument names, if it names a host, a path or a command. */
export function reachOf(l: LiteralArg): Reach | undefined {
  if (l.kind !== 'string' || !l.text) return undefined;
  const text = l.text;
  if (/^file:/i.test(text)) return 'path';
  if (NETWORK.some((re) => re.test(text))) return 'network';
  if (PATHS.some((re) => re.test(text))) return 'path';
  if (COMMANDS.some((re) => re.test(text))) return 'command';
  return undefined;
}

/** The first thing any literal of one call names, if anything. */
export function callReach(literals: readonly LiteralArg[]): Reach | undefined {
  for (const l of literals) {
    const r = reachOf(l);
    if (r) return r;
  }
  return undefined;
}
