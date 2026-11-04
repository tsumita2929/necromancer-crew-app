/**
 * Built-in alternatives to packages whose versions in use are often deprecated (round 5). Each entry is
 * shown beside the upgrade notice: the package may not be needed at all on a new enough Node.
 *
 * Every version below is from Node's own documentation (the `added` and `changes` history of each API in
 * https://nodejs.org/docs/latest-v24.x/api/fs.json and crypto.json, read on 2026-11-04):
 *   fs.glob          added v22.0.0, marked stable in v22.17.0 and v24.0.0
 *   fs.rm            added v14.14.0 (`recursive` and `force` options)
 *   fs.mkdir         `recursive` option added v10.12.0
 *   crypto.randomUUID added v15.6.0 and v14.17.0 (version 4 UUIDs only)
 */

export interface NativeAlternative {
  /** What to use. */
  api: string;
  /** From which Node it exists, in words that include the version. */
  node: string;
  /** What to check before replacing the package. */
  check: string;
}

export const NATIVE_ALTERNATIVES: Readonly<Record<string, NativeAlternative>> = {
  glob: {
    api: 'fs.glob (and fs.globSync, fs.promises.glob)',
    node: 'Node 22.17 or later (added in Node 22.0, experimental until 22.17; stable in Node 24.0)',
    check: 'its options are fewer than the package has, so check your patterns',
  },
  rimraf: {
    api: 'fs.rm (or fs.rmSync) with { recursive: true, force: true }',
    node: 'Node 14.14 or later',
    check: "it does not do the package's glob patterns or its retries on Windows",
  },
  mkdirp: {
    api: 'fs.mkdir (or fs.mkdirSync) with { recursive: true }',
    node: 'Node 10.12 or later',
    check: 'the answer for a directory that already exists is undefined, not null',
  },
  uuid: {
    api: 'crypto.randomUUID()',
    node: 'Node 14.17 or later (and 15.6 or later)',
    check: 'it makes version 4 ids only; versions 1, 3, 5 and 7 and validation need the package',
  },
  'node-uuid': {
    api: 'crypto.randomUUID()',
    node: 'Node 14.17 or later (and 15.6 or later)',
    check: 'it makes version 4 ids only; version 1 ids and the other versions need a package',
  },
};

/** The sentence for the notice, or '' when no built-in alternative is known for this package. */
export function nativeAlternativeSentence(name: string): string {
  const alt = Object.prototype.hasOwnProperty.call(NATIVE_ALTERNATIVES, name)
    ? NATIVE_ALTERNATIVES[name]
    : undefined;
  if (!alt) return '';
  return ` ${alt.node.startsWith('Node') ? alt.node : `Node ${alt.node}`} also has ${alt.api}, so the package may not be needed; ${alt.check}.`;
}
