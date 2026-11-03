import type { Engine, FetchLike } from '@necromancer/engine';
import { createStubEngine } from './stub-engine';

/** The engine the tools talk to, and which implementation it is. */
export interface EnginePort {
  name: 'stub' | 'engine';
  engine: Engine;
  /** Set when the real engine was asked for and could not be loaded. */
  note?: string;
}

/**
 * Picks the engine. The stub is the default. `NECROMANCER_ENGINE=real` asks for
 * `createEngine` from `@necromancer/engine`; if that cannot be loaded the stub is
 * used and the reason is reported, so a tool answer never claims more than it is.
 * The package is imported through a variable so the bundle never contains it.
 */
export async function selectEngine(
  env: Record<string, string | undefined> = process.env,
): Promise<EnginePort> {
  if (env.NECROMANCER_ENGINE !== 'real') {
    return { name: 'stub', engine: createStubEngine() };
  }
  try {
    const specifier = '@necromancer/engine';
    const mod = (await import(specifier)) as {
      createEngine?: (o: { fetch: FetchLike }) => Engine;
    };
    if (typeof mod.createEngine !== 'function') {
      throw new Error('@necromancer/engine does not export createEngine yet');
    }
    return { name: 'engine', engine: mod.createEngine({ fetch: globalThis.fetch as FetchLike }) };
  } catch (err) {
    return {
      name: 'stub',
      engine: createStubEngine(),
      note: `Real engine unavailable, using the stub: ${(err as Error).message}`,
    };
  }
}
