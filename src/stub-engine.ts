import type {
  AutopsyReport,
  DependencyRef,
  Diagnosis,
  Engine,
  KiroSpec,
  ManifestFile,
  ParseResult,
  Successor,
  Verdict,
} from '@necromancer/engine';
import { fixtureDiagnosis } from './fixtures';
import { VERDICT_ORDER } from './verdict';

const NPM_SECTIONS: Array<[string, DependencyRef['scope']]> = [
  ['dependencies', 'main'],
  ['devDependencies', 'dev'],
  ['optionalDependencies', 'optional'],
  ['peerDependencies', 'peer'],
];

function parsePackageJson(file: ManifestFile): ParseResult {
  const dependencies: DependencyRef[] = [];
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(file.content);
  } catch {
    return { dependencies, problems: [`${file.path}: not valid JSON, skipped.`] };
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { dependencies, problems: [`${file.path}: expected a JSON object, skipped.`] };
  }
  for (const [section, scope] of NPM_SECTIONS) {
    const table = (doc as Record<string, unknown>)[section];
    if (table === undefined) continue;
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      problems.push(`${file.path}: "${section}" is not an object, skipped.`);
      continue;
    }
    for (const [name, spec] of Object.entries(table as Record<string, unknown>)) {
      dependencies.push({
        ecosystem: 'npm',
        name,
        spec: typeof spec === 'string' ? spec : '',
        direct: true,
        scope,
        declaredIn: file.path,
      });
    }
  }
  return { dependencies, problems };
}

const REQ_LINE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*((?:===|==|~=|!=|<=|>=|<|>).*)?$/;

function parseRequirements(file: ManifestFile): ParseResult {
  const dependencies: DependencyRef[] = [];
  const problems: string[] = [];
  file.content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').replace(/;.*$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('-')) return;
    const m = REQ_LINE.exec(line);
    if (!m) {
      problems.push(`${file.path}:${i + 1}: could not read "${raw.trim().slice(0, 60)}", skipped.`);
      return;
    }
    dependencies.push({
      ecosystem: 'pypi',
      name: (m[1] ?? '').toLowerCase().replace(/[-_.]+/g, '-'),
      spec: (m[2] ?? '').replace(/\s+/g, ''),
      direct: true,
      scope: 'main',
      declaredIn: file.path,
    });
  });
  return { dependencies, problems };
}

function parseManifest(file: ManifestFile): ParseResult {
  try {
    switch (file.kind) {
      case 'package.json':
        return parsePackageJson(file);
      case 'requirements.txt':
        return parseRequirements(file);
      default:
        return {
          dependencies: [],
          problems: [`${file.path}: the stub engine does not read ${file.kind}.`],
        };
    }
  } catch (err) {
    return { dependencies: [], problems: [`${file.path}: ${(err as Error).message}`] };
  }
}

export function summarize(diagnoses: Diagnosis[]): Record<Verdict, number> {
  const summary = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const d of diagnoses) summary[d.verdict] += 1;
  return summary;
}

function resurrectionSpec(diagnosis: Diagnosis, successor: Successor): KiroSpec {
  const dep = diagnosis.dependency.name;
  const why = diagnosis.evidence[0]?.message ?? `${dep} is ${diagnosis.verdict}.`;
  const how =
    successor.kind === 'raise'
      ? `Rebuild ${dep} as a small dependency-free module the project owns.`
      : `Replace ${dep} with ${successor.name} (${successor.kind}).`;
  return {
    'requirements.md': [
      `# Requirements: move off ${dep}`,
      '',
      `Reason: ${why}`,
      '',
      '1. WHEN the project builds THEN it SHALL NOT import or require ' + dep + '.',
      `2. WHEN a call that used ${dep} is made with any input the project uses THEN the new code SHALL return the same result.`,
      '',
    ].join('\n'),
    'design.md': [
      `# Design: move off ${dep}`,
      '',
      how,
      '',
      successor.reason,
      '',
      '(Stub engine output. The real engine writes the full design.)',
      '',
    ].join('\n'),
    'tasks.md': [
      `# Tasks: move off ${dep}`,
      '',
      `- [ ] 1. Write the differential property-based test (${dep} against the replacement).`,
      '- [ ] 2. Replace each import, one module at a time.',
      `- [ ] 3. Remove ${dep} from the manifest and the lockfile.`,
      '- [ ] 4. Run the project tests and the differential test.',
      '',
    ].join('\n'),
  };
}

/** Deterministic engine for tests, demos and the first round. Never touches the network. */
export function createStubEngine(options: { now?: () => Date } = {}): Engine {
  const now = options.now ?? (() => new Date());
  const diagnose = async (deps: DependencyRef[]): Promise<Diagnosis[]> =>
    deps.map((d) => fixtureDiagnosis(d));
  return {
    parseManifest,
    diagnose,
    async autopsy(input): Promise<AutopsyReport> {
      const deps: DependencyRef[] = [];
      const problems: AutopsyReport['problems'] = [];
      const manifests: AutopsyReport['manifests'] = [];
      for (const file of input.files) {
        manifests.push({ kind: file.kind, path: file.path });
        const parsed = parseManifest(file);
        deps.push(...parsed.dependencies);
        for (const message of parsed.problems) problems.push({ path: file.path, message });
      }
      const diagnoses = await diagnose(deps);
      return {
        subject: input.subject,
        scannedAt: now().toISOString(),
        manifests,
        diagnoses,
        problems,
        unavailable: [],
        summary: summarize(diagnoses),
      };
    },
    resurrectionSpec,
  };
}
