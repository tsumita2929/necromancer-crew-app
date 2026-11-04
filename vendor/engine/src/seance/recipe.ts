import type {
  DependencyUsage,
  Diagnosis,
  KnownDifference,
  SeanceBundle,
  SeanceFile,
  Successor,
} from '../types.js';
import { countTodos } from './emit.js';

export interface RecipeContext {
  diagnosis: Diagnosis;
  successor: Successor;
  usage?: DependencyUsage | undefined;
}

/** A deliberately wrong replacement. Running the séance with it must fail. */
export interface Mutant {
  id: string;
  description: string;
  /** Replaces the file with the same path in the bundle. */
  files: SeanceFile[];
}

export interface Recipe {
  /** Stable id, also the folder name under `seance/`. */
  id: string;
  language: 'javascript' | 'python';
  ecosystem: 'npm' | 'pypi';
  /** The dead package, as named in the manifest (PEP 503 normalised for PyPI). */
  old: string;
  /** Successor names this recipe handles; the first is the default. */
  successors: readonly string[];
  /** Also accept any successor of this kind (for the raise path). */
  kind?: Successor['kind'];
  /** Why this pair was picked, for the write-up. */
  why: string;
  build(ctx: RecipeContext): SeanceBundle;
  mutants(ctx: RecipeContext): Mutant[];
}

export function makeBundle(
  base: Omit<SeanceBundle, 'todos' | 'knownDifferences'> & { knownDifferences?: KnownDifference[] },
): SeanceBundle {
  return { ...base, knownDifferences: base.knownDifferences ?? [], todos: countTodos(base.files) };
}

/** Members the project uses, as a set of first-level names. Empty when no usage is known. */
export function usedMembers(usage: DependencyUsage | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of usage?.members ?? []) out.add(m.member.split('.')[0] ?? m.member);
  return out;
}
