import type { Http } from '../net/http.js';
import type { RepoRef } from './repo.js';
import { badShape, fail, type Fetched } from './result.js';

/**
 * "This repository has moved to https://...", "development has moved to ...", "now lives at ...".
 * One address on the same line, within 80 characters of the phrase.
 */
const MOVED =
  /\b(?:(?:this|the)\s+(?:repository|repo|project|package|code|source)\s+(?:has\s+|have\s+)?(?:been\s+)?moved\s+to|(?:development|maintenance)\s+(?:has\s+)?moved\s+to|(?:has|have)\s+(?:been\s+)?moved\s+to|moved\s+to|now\s+(?:lives|developed|maintained|hosted)\s+(?:at|on))\b[^\n]{0,80}?(https?:\/\/[^\s)>\]"'`]+)/i;

/** The part of a README that is read: a notice of a move is at the top. */
const HEAD_CHARS = 2000;

/** The address a README's notice of a move names, or null. Pure. */
export function findMovedNotice(readme: string): string | null {
  const match = MOVED.exec(readme.slice(0, HEAD_CHARS));
  // Markdown around the address ("**https://...**", "<https://...>.") is not part of it.
  const target = match?.[1]?.replace(/[.,;:!?*~)]+$/, '');
  return target ? target : null;
}

/**
 * The README of an archived repository, read for a notice that the project moved. It comes from
 * raw.githubusercontent.com, which is not the GitHub REST API and does not use its limit. Only
 * `README.md` is tried. Returns the address the notice names, or null.
 */
export async function getMovedNotice(http: Http, repo: RepoRef): Promise<Fetched<string | null>> {
  const r = await http.request(
    `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/HEAD/README.md`,
    undefined,
    'text',
  );
  if (!r.ok) {
    if (r.kind === 'not-found') return { ok: true, value: null };
    return fail(r);
  }
  if (typeof r.data !== 'string') return badShape('README');
  return { ok: true, value: findMovedNotice(r.data) };
}
