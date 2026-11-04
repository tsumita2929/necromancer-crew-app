import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The haunted demo app the tests read. In the standalone Crew app repository it is `examples/haunted-app`;
 * in the Necromancer repository it is `demo/haunted-app`.
 */
export const hauntedApp: string = [
  path.resolve(import.meta.dirname, '../examples/haunted-app'),
  path.resolve(import.meta.dirname, '../../../demo/haunted-app'),
].find((p) => existsSync(path.join(p, 'package.json'))) ?? path.resolve(import.meta.dirname, '../examples/haunted-app');
