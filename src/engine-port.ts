import type { Engine } from '@necromancer/engine';
import { createRealEngine } from './real-engine';
import { createStubEngine } from './stub-engine';

/** The engine the tools talk to, and which implementation it is. */
export interface EnginePort {
  name: 'stub' | 'engine';
  engine: Engine;
  /** Set when the real engine was wanted and could not be created. */
  note?: string;
  /**
   * Makes a new engine of the same kind. The real engine caches every answer for the
   * life of one instance, so Night Watch takes a fresh one for each run; otherwise a
   * long-lived server would compare tonight's scan with last night's cached answers.
   */
  create?: () => Engine;
}

/**
 * Picks the engine. The real engine is the default. `NECROMANCER_ENGINE=stub`
 * asks for the stub. If the real engine cannot be created, the stub is used and
 * the cause is reported, so an answer never claims more than it is.
 * `factory` exists so a test can simulate a load failure.
 */
export function selectEngine(
  env: Record<string, string | undefined> = process.env,
  factory: () => Engine = () => createRealEngine(),
): EnginePort {
  if (env.NECROMANCER_ENGINE === 'stub') {
    return { name: 'stub', engine: createStubEngine() };
  }
  try {
    return { name: 'engine', engine: factory(), create: factory };
  } catch (err) {
    return {
      name: 'stub',
      engine: createStubEngine(),
      note: `Real engine unavailable, using the stub: ${(err as Error).message}`,
    };
  }
}
