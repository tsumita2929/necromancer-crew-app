import { Core, emptySummary, newRun, unavailableList } from './diagnose.js';
import { parseManifest } from './manifest/index.js';
import type { AutopsyReport, DependencyRef, Diagnosis, ManifestFile } from './types.js';
import { VERDICTS } from './types.js';
import { errorMessage } from './util/guards.js';

const depKey = (d: DependencyRef): string => `${d.ecosystem}:${d.name}`;

/**
 * Merge duplicates (R4.3). A manifest entry (spec, no resolved version) joins the lockfile
 * entry of the same package when that entry is unambiguous: exactly one top-level copy.
 */
export function mergeDependencies(all: readonly DependencyRef[]): DependencyRef[] {
  const groups = new Map<string, DependencyRef[]>();
  for (const dep of all) {
    const list = groups.get(depKey(dep));
    if (list) list.push(dep);
    else groups.set(depKey(dep), [dep]);
  }
  const out: DependencyRef[] = [];
  for (const group of groups.values()) {
    const locked = group.filter((d) => d.resolved !== undefined);
    const declared = group.filter((d) => d.resolved === undefined);
    const topLevel = locked.filter((d) => d.direct);
    const target =
      topLevel.length === 1 ? topLevel[0] : locked.length === 1 ? locked[0] : undefined;
    const merged = new Map<string, DependencyRef>();
    const add = (d: DependencyRef): void => {
      merged.set(
        JSON.stringify([
          d.ecosystem,
          d.name,
          d.spec,
          d.resolved ?? '',
          d.scope,
          d.declaredIn,
          d.direct,
        ]),
        d,
      );
    };
    let mergedTarget: DependencyRef | undefined = target ? { ...target } : undefined;
    for (const decl of declared) {
      if (mergedTarget && decl.direct) {
        mergedTarget = {
          ...mergedTarget,
          spec: mergedTarget.spec || decl.spec,
          direct: true,
          scope: decl.scope,
          declaredIn: decl.declaredIn,
        };
      } else {
        add(decl);
      }
    }
    for (const lock of locked) add(lock === target && mergedTarget ? mergedTarget : lock);
    out.push(...merged.values());
  }
  return out;
}

const severity = (d: Diagnosis): number => VERDICTS.indexOf(d.verdict);

export function sortDiagnoses(list: Diagnosis[]): Diagnosis[] {
  return [...list].sort(
    (a, b) =>
      severity(b) - severity(a) ||
      Number(b.dependency.direct) - Number(a.dependency.direct) ||
      a.dependency.name.localeCompare(b.dependency.name) ||
      (a.dependency.resolved ?? '').localeCompare(b.dependency.resolved ?? ''),
  );
}

export function summarize(list: readonly Diagnosis[]): Record<(typeof VERDICTS)[number], number> {
  const summary = emptySummary();
  for (const d of list) summary[d.verdict]++;
  return summary;
}

export async function runAutopsy(
  core: Core,
  now: () => Date,
  maxDependencies: number,
  input: { subject: string; files: ManifestFile[] },
): Promise<AutopsyReport> {
  const files = Array.isArray(input?.files) ? input.files : [];
  const problems: AutopsyReport['problems'] = [];
  const parsed: DependencyRef[] = [];
  const manifests: AutopsyReport['manifests'] = [];
  for (const file of files) {
    const result = parseManifest(file);
    const path = typeof file?.path === 'string' ? file.path : '(unnamed)';
    if (file && typeof file.kind === 'string') manifests.push({ kind: file.kind, path });
    parsed.push(...result.dependencies);
    for (const message of result.problems) problems.push({ path, message });
  }
  const merged = mergeDependencies(parsed).sort(
    (a, b) => Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name),
  );
  let plan = merged;
  if (merged.length > maxDependencies) {
    plan = merged.slice(0, maxDependencies);
    const left = merged.slice(maxDependencies);
    const skipped = left.length;
    const directLeft = left.filter((d) => d.direct).length;
    // "Transitive" only when every dependency left out really is (QA-14: 450 direct ones are not).
    const kind = directLeft === 0 ? 'transitive ' : '';
    const some = directLeft > 0 && directLeft < skipped ? ` (${directLeft} of them direct)` : '';
    problems.push({
      path: '(scan)',
      message: `Checked the first ${plan.length} of ${merged.length} dependencies (direct ones first); ${skipped} more ${kind}${skipped === 1 ? 'dependency was' : 'dependencies were'} not checked${some}.`,
    });
  }
  const run = newRun();
  let diagnoses: Diagnosis[];
  try {
    diagnoses = await core.diagnose(plan, run);
  } catch (error) {
    problems.push({ path: '(scan)', message: `The check stopped early: ${errorMessage(error)}.` });
    diagnoses = [];
  }
  const sorted = sortDiagnoses(diagnoses);
  return {
    subject: typeof input?.subject === 'string' ? input.subject : '',
    scannedAt: now().toISOString(),
    manifests,
    diagnoses: sorted,
    problems,
    unavailable: unavailableList(run),
    summary: summarize(sorted),
  };
}
