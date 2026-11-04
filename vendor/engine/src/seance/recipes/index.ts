import type { Recipe } from '../recipe.js';
import { isOddRecipe } from './is-odd.js';
import { leftPadRecipe } from './left-pad.js';
import { mkdirpRecipe } from './mkdirp.js';
import { pep8Recipe } from './pep8.js';
import { querystringRecipe } from './querystring.js';
import { tomlRecipe } from './toml.js';

/** Curated recipes, in the order they are offered. */
export const RECIPES: readonly Recipe[] = [
  leftPadRecipe,
  querystringRecipe,
  mkdirpRecipe,
  isOddRecipe,
  tomlRecipe,
  pep8Recipe,
];
