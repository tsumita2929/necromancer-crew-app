import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FetchLike } from '@necromancer/engine';

/**
 * Replays responses recorded from the real public sources (copied from the
 * engine's own recordings, see test/recorded). A request with no recording is
 * listed in `missing` and fails, so a test can never reach the network.
 */
const root = path.resolve(import.meta.dirname, 'recorded');

export const recordedAt = new Date(
  (JSON.parse(readFileSync(path.join(root, 'meta.json'), 'utf8')) as { recordedAt: string }).recordedAt,
);

const osvStore = JSON.parse(readFileSync(path.join(root, 'osv.json'), 'utf8')) as Record<string, unknown[]>;

export function fixtureFileName(method: string, url: string): string {
  const slug = `${method}_${url.replace(/^https?:\/\//, '')}`.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 120);
  const hash = createHash('sha1').update(`${method} ${url}`).digest('hex').slice(0, 8);
  return `${slug}_${hash}.json`;
}

export interface RecordedResponse {
  status: number;
  body: unknown;
}

export interface RecordedFetch extends FetchLike {
  missing: string[];
  requests: string[];
}

/**
 * `override` may change a recorded answer: it receives the URL and the recorded
 * response and returns the response to serve. Used to simulate a package getting worse.
 */
export function recordedFetch(override?: (url: string, recorded: RecordedResponse) => RecordedResponse): RecordedFetch {
  const missing: string[] = [];
  const requests: string[] = [];
  const reply = (status: number, body: unknown) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) as unknown, text: async () => text };
  };
  const impl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url}`);
    if (method === 'POST' && url === 'https://api.osv.dev/v1/querybatch') {
      const queries = (JSON.parse(init?.body ?? '{}') as { queries: Array<{ package: { name: string; ecosystem: string }; version: string }> }).queries;
      const results = queries.map((q) => {
        const key = `${q.package.ecosystem === 'PyPI' ? 'pypi' : 'npm'}:${q.package.name}@${q.version}`;
        const vulns = osvStore[key];
        if (!vulns) {
          missing.push(`OSV ${key}`);
          throw new Error(`No OSV recording for ${key}`);
        }
        return vulns.length > 0 ? { vulns } : {};
      });
      return reply(200, { results });
    }
    const file = path.join(root, fixtureFileName(method, url));
    if (!existsSync(file)) {
      missing.push(`${method} ${url}`);
      throw new Error(`No recording for ${method} ${url}`);
    }
    const saved = JSON.parse(readFileSync(file, 'utf8')) as RecordedResponse;
    const served = override ? override(url, saved) : saved;
    return reply(served.status, served.body);
  };
  return Object.assign(impl, { missing, requests });
}
