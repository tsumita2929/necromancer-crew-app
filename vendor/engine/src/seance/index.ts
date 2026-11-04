import type { DependencyUsage, Diagnosis, SeanceBundle, Successor } from '../types.js';
import { normalizePypiName } from '../util/names.js';
import { errorMessage } from '../util/guards.js';
import { genericSeance } from './generic.js';
import type { Recipe, RecipeContext } from './recipe.js';
import { RECIPES } from './recipes/index.js';

export { RECIPES } from './recipes/index.js';
export type { Recipe, Mutant } from './recipe.js';

/** The curated recipe for this pair, or undefined. */
export function pickRecipe(diagnosis: Diagnosis, successor: Successor): Recipe | undefined {
  try {
    const dep = diagnosis?.dependency;
    if (!dep || typeof dep.name !== 'string') return undefined;
    const name = dep.ecosystem === 'pypi' ? normalizePypiName(dep.name) : dep.name;
    const target = typeof successor?.name === 'string' ? successor.name.toLowerCase() : '';
    return RECIPES.find(
      (r) =>
        r.ecosystem === dep.ecosystem &&
        r.old === name &&
        (r.successors.some((s) => s.toLowerCase() === target) ||
          (r.kind !== undefined && r.kind === successor?.kind)),
    );
  } catch {
    return undefined;
  }
}

/**
 * The séance for a migration: the curated recipe when there is one, the generic template when
 * not. Never throws; malformed input gives a generic bundle (R2.13).
 */
export function generateSeance(
  diagnosis: Diagnosis,
  successor: Successor,
  usage?: DependencyUsage,
): SeanceBundle {
  const ctx: RecipeContext = { diagnosis, successor, usage };
  try {
    const recipe = pickRecipe(diagnosis, successor);
    return recipe ? recipe.build(ctx) : genericSeance(ctx);
  } catch (error) {
    try {
      return genericSeance({ diagnosis: undefined as never, successor, usage: undefined });
    } catch {
      void errorMessage(error);
      return {
        language: 'javascript',
        recipe: null,
        title: 'séance',
        files: [],
        install: [],
        run: '',
        compares: [],
        knownDifferences: [],
        members: [],
        todos: 0,
      };
    }
  }
}
