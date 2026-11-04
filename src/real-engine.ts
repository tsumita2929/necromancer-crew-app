import { createEngine } from '@necromancer/engine';
import type { Engine, FetchLike } from '@necromancer/engine';

/**
 * The real engine, bundled into dist/server.mjs. The installed app has no
 * node_modules, so it cannot import the engine at run time. Network access
 * goes through the injected fetch; Node's global fetch matches `FetchLike`.
 */
export function createRealEngine(
  fetch: FetchLike = globalThis.fetch as unknown as FetchLike,
  env: Record<string, string | undefined> = process.env,
): Engine {
  return createEngine({ fetch: blockHosts(fetch, env.NECROMANCER_BLOCK_HOSTS) });
}

/**
 * `NECROMANCER_BLOCK_HOSTS=api.github.com,example.org` makes requests to those hosts fail at once, with
 * no network call: the engine sees an HTTP 403 and reports the source as unavailable. It lets an operator
 * keep a host (for example the unauthenticated GitHub API, 60 requests an hour) out of reach while the
 * other sources still answer.
 */
export function blockHosts(fetch: FetchLike, list: string | undefined): FetchLike {
  const hosts = new Set(
    (list ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h !== ''),
  );
  if (hosts.size === 0) return fetch;
  return async (url, init) => {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      /* not a URL: let the real fetch refuse it */
    }
    if (hosts.has(host)) {
      const body = JSON.stringify({ message: `${host} is blocked by NECROMANCER_BLOCK_HOSTS` });
      return { ok: false, status: 403, json: async () => JSON.parse(body) as unknown, text: async () => body };
    }
    return fetch(url, init);
  };
}
