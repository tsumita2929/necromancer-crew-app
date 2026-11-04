import { runAutopsy } from './autopsy.js';
import { Core, newRun } from './diagnose.js';
import { parseManifest } from './manifest/index.js';
import { type EngineTuning, resolveTuning } from './options.js';
import { generateSeance } from './seance/index.js';
import { resurrectionSpec } from './spec.js';
import { scanUsage } from './usage/index.js';
import type { DependencyRef, Diagnosis, Engine, EngineOptions } from './types.js';
import { errorMessage } from './util/guards.js';
import * as signals from './signals.js';

export * from './types.js';
export type { EngineTuning } from './options.js';
export { decide, classOf, EVIDENCE_CLASS } from './verdict.js';
export { THRESHOLDS } from './signals.js';
export { mergeDependencies } from './autopsy.js';
export { parseManifest } from './manifest/index.js';
export { resurrectionSpec } from './spec.js';
export { scanUsage } from './usage/index.js';
export { generateSeance, pickRecipe, RECIPES } from './seance/index.js';
export { normalizePypiName, isValidNpmName } from './util/names.js';

/**
 * Create an engine. `options.fetch` is the only way it reaches the network.
 * `tuning` is optional and never required by consumers of the shared contract.
 */
export function createEngine(options: EngineOptions, tuning?: EngineTuning): Engine {
  const resolved = resolveTuning(tuning);
  const now = options.now ?? (() => new Date());
  const core = new Core(options.fetch, now, resolved);

  const fallback = (dep: DependencyRef, reason: string): Diagnosis => ({
    dependency: dep,
    verdict: 'alive',
    evidence: [signals.unchecked(dep.ecosystem, [reason])],
    advisories: [],
    successors: [],
  });

  return {
    parseManifest,
    async diagnose(deps) {
      const list = Array.isArray(deps) ? deps : [];
      try {
        return await core.diagnose(list, newRun());
      } catch (error) {
        return list.map((dep) => fallback(dep, errorMessage(error)));
      }
    },
    autopsy(input) {
      return runAutopsy(core, now, resolved.maxDependencies, input);
    },
    resurrectionSpec,
    scanUsage,
    seance: generateSeance,
  };
}
