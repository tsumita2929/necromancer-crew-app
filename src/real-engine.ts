import { createEngine } from '@necromancer/engine';
import type { Engine, FetchLike } from '@necromancer/engine';

/**
 * The real engine, bundled into dist/server.mjs. The installed app has no
 * node_modules, so it cannot import the engine at run time. Network access
 * goes through the injected fetch; Node's global fetch matches `FetchLike`.
 */
export function createRealEngine(fetch: FetchLike = globalThis.fetch as unknown as FetchLike): Engine {
  return createEngine({ fetch });
}
