/**
 * resurrectionSpec: a Kiro spec (requirements, design, tasks) for moving a project off
 * one dead dependency onto one successor. Pure string generation, deterministic.
 *
 * The requirement ids are built first and the tasks cite those ids, so a task can only
 * cite a requirement that exists.
 */

import { codeCell } from './seance/emit.js';
import { generateSeance } from './seance/index.js';
import type {
  DependencyRef,
  DependencyUsage,
  Diagnosis,
  KiroSpec,
  SeanceBundle,
  Successor,
} from './types.js';

interface Criterion {
  id: string;
  text: string;
}
interface Requirement {
  id: string;
  title: string;
  story: string;
  criteria: Criterion[];
}

/** Facts about the project that several parts of the spec repeat. */
interface Project {
  ecosystem: 'npm' | 'pypi';
  /** Where the usage inventory is saved (R1.2 and the task that cites it). */
  usagePath: string;
  /** Where the owned replacement goes, as inline code, with a note when the extension is unknown. */
  vendor: string;
  /** The project's own test runner, when the caller named it. */
  testRunner?: string;
}

/** Text that is safe inside a Markdown line and inline code. */
function flatten(text: unknown): string {
  let raw: string;
  try {
    raw = String(text ?? '');
  } catch {
    raw = '';
  }
  return (
    raw
      // Controls (C0, C1), line and paragraph separators, backticks: one flat line.
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029`]+/g, ' ')
      .replace(/\s+/g, ' ')
      // Untrusted text must not become links, images or HTML in a Markdown viewer.
      .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
      .replace(/[[\]!]/g, (c) => `\\${c}`)
      .trim()
  );
}

function safe(text: unknown, fallback: string, max = 120): string {
  // The fallback can itself be untrusted (an evidence code), so it is flattened too.
  const flat = flatten(text) || flatten(fallback) || '(unnamed)';
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'dependency' : s.slice(0, 60);
}

/** The language of the project's code, from the files that use the dependency. */
function codeExtension(ecosystem: 'npm' | 'pypi', usage: DependencyUsage | undefined): string {
  if (ecosystem === 'pypi') return '.py';
  const files = [...(usage?.filesUsing ?? []), ...(usage?.imports ?? []).map((i) => i.file)].filter(
    (f): f is string => typeof f === 'string',
  );
  if (files.some((f) => /\.(?:ts|tsx|mts|cts)$/i.test(f))) return '.ts';
  if (files.some((f) => /\.(?:js|jsx|mjs|cjs)$/i.test(f))) return '.js';
  return '';
}

/** The path of the owned replacement, in the language of the project (T4.3). */
function vendorPath(
  old: string,
  ecosystem: 'npm' | 'pypi',
  usage: DependencyUsage | undefined,
  bundle: SeanceBundle,
): string {
  const fromBundle = bundle.files.find(
    (f) => f.role === 'replacement' && f.path.startsWith('src/vendor/'),
  );
  if (fromBundle) return `\`${safe(fromBundle.path, 'file', 100)}\``;
  const ext = codeExtension(ecosystem, usage);
  if (ecosystem === 'pypi') return `\`vendor/${slug(old).replace(/-/g, '_')}${ext}\``;
  if (ext === '') {
    return `\`src/vendor/${slug(old)}\` (give it the file extension and folder the project already uses)`;
  }
  return `\`src/vendor/${slug(old)}${ext}\``;
}

/** Version in use, from the lockfile when there is one, never "latest". */
function versionInUse(dep: DependencyRef): string {
  const resolved = safe(dep.resolved, '', 40);
  if (dep.resolved && resolved) return `${resolved} (from the lockfile)`;
  const range = safe(dep.spec, '', 60);
  if (dep.spec && !/^(?:\*|latest|next)$/i.test(range))
    return `declared as \`${range}\`, no lockfile version`;
  return 'unknown (no lockfile version, and the manifest names no range)';
}

/** What the séance needs, whatever runner the project uses for its own tests (T4.1). */
function seanceTooling(project: Project): string {
  const own = project.testRunner
    ? `\`${safe(project.testRunner, 'its test runner', 40)}\``
    : 'whatever it uses';
  return project.ecosystem === 'npm'
    ? `The séance runs on Vitest and fast-check and needs Node 22.12 or newer. The project's own tests stay on ${own}; the séance is a separate command.`
    : `The séance runs on pytest and Hypothesis. The project's own tests stay on ${own}; the séance is a separate command.`;
}

function buildRequirements(
  old: string,
  next: Successor,
  diagnosis: Diagnosis,
  project: Project,
): Requirement[] {
  const nextName = safe(next.name, 'the successor');
  // A raised replacement has no name of its own: it is code the project owns.
  const nextRef = next.kind === 'raise' ? 'the owned replacement' : `\`${nextName}\``;
  const reqs: Requirement[] = [];
  reqs.push({
    id: 'R1',
    title: 'Know how the project uses the dependency',
    story: `As a maintainer, I want a list of every way the project uses \`${old}\`, so that the migration covers all of it and nothing more.`,
    criteria: [
      {
        id: 'R1.1',
        text: `WHEN the project is searched, THE migration SHALL list every import, require and call of \`${old}\` with the exported names used.`,
      },
      {
        id: 'R1.2',
        text: `THE list SHALL be saved in the repository at \`${project.usagePath}\` so reviewers can check it against the diff.`,
      },
    ],
  });
  reqs.push({
    id: 'R2',
    title: 'Same behaviour before and after',
    story: `As a maintainer, I want proof that ${nextRef} answers like \`${old}\` for the way the project uses it, so that the switch is safe.`,
    criteria: [
      {
        id: 'R2.1',
        text: `THE project SHALL have a differential property-based test (a séance) that asks \`${old}\` and ${nextRef} the same generated questions over each API in R1.1.`,
      },
      {
        id: 'R2.2',
        text: 'WHEN the two answers differ, THE test SHALL fail and print the input and both answers.',
      },
      {
        id: 'R2.3',
        text: 'WHERE both throw, THE test SHALL compare the kind of error, not the message text.',
      },
      {
        id: 'R2.4',
        text: 'THE test SHALL pass with the old implementation on both sides before any code is changed.',
      },
    ],
  });
  if (next.kind === 'native') {
    reqs.push({
      id: 'R3',
      title: 'Use the platform instead',
      story: `As a maintainer, I want the code to call \`${nextName}\` directly, so that the project carries no package for it.`,
      criteria: [
        { id: 'R3.1', text: `THE code SHALL call \`${nextName}\` where it called \`${old}\`.` },
        {
          id: 'R3.2',
          text: `THE project's supported runtimes (Node version, browser list) SHALL all provide \`${nextName}\`.`,
        },
      ],
    });
  } else if (next.kind === 'raise') {
    reqs.push({
      id: 'R3',
      title: 'Own a small replacement',
      story: `As a maintainer, I want a small implementation of what the project uses from \`${old}\`, so that the project owns that code.`,
      criteria: [
        {
          id: 'R3.1',
          text: `THE project SHALL contain its own dependency-free implementation of the APIs listed in R1.1 at ${project.vendor}.`,
        },
        {
          id: 'R3.2',
          text: 'THE implementation SHALL have example tests for edge cases found in R1.1 in addition to the séance.',
        },
        {
          id: 'R3.3',
          text: `WHERE the licence of \`${old}\` requires attribution, THE project SHALL keep it.`,
        },
      ],
    });
  } else {
    reqs.push({
      id: 'R3',
      title: 'Move to a living package',
      story: `As a maintainer, I want the project on \`${nextName}\`, which is maintained, so that it receives fixes.`,
      criteria: [
        {
          id: 'R3.1',
          text: `THE project SHALL declare \`${nextName}\` in its manifest with a version range that has no known advisory.`,
        },
        {
          id: 'R3.2',
          text: `THE code SHALL import \`${nextName}\` where it imported \`${old}\`, adapting calls where the API differs.`,
        },
      ],
    });
  }
  const removal: Criterion[] = [
    {
      id: 'R4.1',
      text: `THE project SHALL NOT declare \`${old}\` in any manifest or lockfile after the migration.`,
    },
    { id: 'R4.2', text: 'THE build, type check and test suite SHALL pass after the migration.' },
  ];
  if (diagnosis.advisories.length > 0) {
    const ids = diagnosis.advisories
      .slice(0, 5)
      .map((a) => safe(a, 'advisory', 40))
      .join(', ');
    removal.push({
      id: 'R4.3',
      text: `THE dependency audit SHALL no longer report ${ids} for this project.`,
    });
  }
  reqs.push({
    id: 'R4',
    title: 'Remove the dead dependency',
    story: `As a maintainer, I want \`${old}\` gone, so that nothing unmaintained stays in the tree.`,
    criteria: removal,
  });
  reqs.push({
    id: 'R5',
    title: 'Safe to undo',
    story:
      'As a maintainer, I want each step in its own commit, so that I can revert one step without losing the others.',
    criteria: [
      {
        id: 'R5.1',
        text: 'THE migration SHALL be made in small commits: test first, then the switch, then the removal.',
      },
    ],
  });
  return reqs;
}

/** What the verdict rests on, in words: a hard signal, or a guess from staleness. */
function basisPhrase(diagnosis: Diagnosis): string {
  // The rule of round 4b (R2.11): a deprecated or yanked version in use is an upgrade notice on a
  // package that is itself alive. Say so, so the spec is not read as "this package is dying".
  const notice = Array.isArray(diagnosis.evidence)
    ? diagnosis.evidence.find(
        (e) => e?.code === 'version-deprecated' || e?.code === 'version-yanked',
      )
    : undefined;
  if (notice && diagnosis.verdict === 'alive') {
    const to = diagnosis.upgradeTo;
    const what = notice.code === 'version-yanked' ? 'yanked' : 'deprecated';
    const where = to ? `; upgrade to ${safe(to.version, 'a newer release', 40)} first` : '';
    return ` (a maintained package: only the version in use is ${what}, which is an upgrade notice and not a sign of death${where})`;
  }
  if (diagnosis.basis === 'hard') return ' (a hard signal: see the evidence)';
  if (diagnosis.basis === 'heuristic') return ' (a heuristic from staleness, not a hard signal)';
  return '';
}

function renderRequirements(
  old: string,
  next: Successor,
  diagnosis: Diagnosis,
  reqs: Requirement[],
): string {
  const chosen =
    next.kind === 'raise'
      ? 'the way out is to rebuild it as code the project owns (a raise)'
      : `the chosen successor is \`${safe(next.name, 'the successor')}\` (${safe(next.kind, 'package', 20)})`;
  const lines: string[] = [
    `# Requirements: Move off ${old}`,
    '',
    `Generated by Necromancer. \`${old}\` is **${safe(diagnosis.verdict, 'dead', 20)}**${basisPhrase(diagnosis)}; ${chosen}.`,
    '',
    '## Why',
    '',
    ...(diagnosis.evidence.length > 0
      ? diagnosis.evidence.map(
          (e) =>
            `- Evidence: ${safe(e?.message, e?.code, 220)} (${safe(e?.source, 'unknown', 30)})`,
        )
      : ['- No evidence was recorded.']),
    '',
    `Why this successor: ${safe(next.reason, 'no reason recorded', 220)}`,
    '',
  ];
  for (const r of reqs) {
    lines.push(`## ${r.id}. ${r.title}`, '', `**User story.** ${r.story}`, '');
    for (const c of r.criteria) lines.push(`- ${c.id} ${c.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderDesign(
  old: string,
  next: Successor,
  diagnosis: Diagnosis,
  project: Project,
): string {
  const nextName = safe(next.name, 'the successor');
  const nextRef = next.kind === 'raise' ? 'the owned replacement' : `\`${nextName}\``;
  const eco = diagnosis.dependency.ecosystem === 'npm' ? 'JavaScript / TypeScript' : 'Python';
  const test =
    diagnosis.dependency.ecosystem === 'npm' ? 'fast-check with Vitest' : 'Hypothesis with pytest';
  const how =
    next.kind === 'native'
      ? `Replace calls to \`${old}\` with \`${nextName}\`. No package is added.`
      : next.kind === 'raise'
        ? `Write ${project.vendor}, a small module with the same exported names the project uses, and import it where \`${old}\` was imported.`
        : `Add \`${nextName}\` and adapt each call site to its API.`;
  return [
    `# Design: Move off ${old}`,
    '',
    `Ecosystem: ${eco}.`,
    '',
    `- Version in use: ${versionInUse(diagnosis.dependency)}.`,
    `- Latest release: ${diagnosis.latest ? safe(diagnosis.latest.version, 'unknown', 40) : 'unknown'}.`,
    '',
    '## Approach',
    '',
    how,
    '',
    '## The séance (differential test)',
    '',
    `Both implementations are loaded in one test file (${test}). ${seanceTooling(project)} For each API from the inventory the test:`,
    '',
    '1. builds an arbitrary that generates inputs of the types the API accepts, biased toward edge cases (empty, zero, negative, very long, unicode, `null` and `undefined`);',
    `2. calls \`${old}\` and ${nextRef} with the same input;`,
    '3. fails if the results differ, or if exactly one of them throws, and shows the shrunk input and both outputs.',
    '',
    `While \`${old}\` is still installed, it is the oracle. It stays installed until the last step. Before it is removed, record its outputs for the failing and edge inputs as a golden file, so the test keeps guarding the new code.`,
    '',
    '## Risks',
    '',
    '- A behaviour that the inventory missed. The test only covers the APIs it lists.',
    '- Differences the project relies on by accident (error messages, key order). Decide per case whether to match or to change the caller.',
    ...(next.kind === 'native'
      ? ['- A runtime that lacks the platform API. Check the supported runtime list first.']
      : []),
    '',
    '## Order of work',
    '',
    'Inventory, then the séance against the old code, then the switch, then the removal.',
    '',
  ].join('\n');
}

function renderTasks(old: string, next: Successor, reqs: Requirement[], project: Project): string {
  const nextName = safe(next.name, 'the successor');
  const nextRef = next.kind === 'raise' ? 'the owned replacement' : `\`${nextName}\``;
  const has = (id: string): boolean => reqs.some((r) => r.criteria.some((c) => c.id === id));
  const cite = (...ids: string[]): string => `_Requirements: ${ids.filter(has).join(', ')}_`;
  const install =
    next.kind === 'native'
      ? [
          `- [ ] 3. Check runtime support for \`${nextName}\``,
          `  - [ ] 3.1 List the Node versions and browsers the project supports and confirm each has \`${nextName}\` ${cite('R3.2')}`,
        ]
      : next.kind === 'raise'
        ? [
            `- [ ] 3. Build the replacement`,
            `  - [ ] 3.1 Write ${project.vendor} with the APIs from the inventory ${cite('R3.1')}`,
            `  - [ ] 3.2 Add example tests for the edge cases found in the inventory ${cite('R3.2')}`,
            `  - [ ] 3.3 Keep the licence attribution if \`${old}\` requires it ${cite('R3.3')}`,
          ]
        : [
            `- [ ] 3. Install the successor`,
            `  - [ ] 3.1 Add \`${nextName}\` to the manifest and lockfile ${cite('R3.1')}`,
          ];
  return [
    `# Tasks: Move off ${old}`,
    '',
    `- [ ] 1. Inventory the usage of \`${old}\``,
    `  - [ ] 1.1 Search for every import, require and call; list the exported names used ${cite('R1.1')}`,
    `  - [ ] 1.2 Save the list in \`${project.usagePath}\` ${cite('R1.2')}`,
    `- [ ] 2. Write the séance: a differential property-based test, old versus new`,
    `  - [ ] 2.1 For each API in the inventory, write an arbitrary that generates its inputs ${cite('R2.1')}`,
    `  - [ ] 2.2 Assert that \`${old}\` and ${nextRef} return equal results, or both throw the same kind of error ${cite('R2.1', 'R2.3')}`,
    `  - [ ] 2.3 Make a failure print the shrunk input and both answers ${cite('R2.2')}`,
    `  - [ ] 2.4 Run it with \`${old}\` on both sides; it must pass before any code changes ${cite('R2.4')}`,
    ...install,
    `- [ ] 4. Switch the code`,
    `  - [ ] 4.1 Replace each use of \`${old}\` from the inventory ${cite('R3.1', 'R3.2')}`,
    `  - [ ] 4.2 Run the séance and the full test suite; fix every difference or record the decision ${cite('R2.2', 'R4.2')}`,
    `- [ ] 5. Remove \`${old}\``,
    `  - [ ] 5.1 Record the old outputs of the séance as a golden file, then delete the dependency from the manifest and lockfile ${cite('R4.1')}`,
    `  - [ ] 5.2 Run build, type check, tests and the dependency audit ${cite('R4.2', 'R4.3')}`,
    `- [ ] 6. Commit in small steps: test, switch, removal ${cite('R5.1')}`,
    '',
  ].join('\n');
}

/** What `resurrectionSpec` reads beyond the diagnosis and the successor. */
export interface SpecOptions {
  usage?: DependencyUsage;
  /** Facts about the project. `testRunner` is named in the spec, e.g. "jest" or "unittest". */
  project?: { testRunner?: string };
}

function isSuccessor(value: unknown): value is Successor {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    (value as { name: string }).name.trim() !== ''
  );
}

/**
 * The successor to write the spec for: the one given, else the diagnosis's best, else a `raise`
 * successor built from the dependency itself (T4.5).
 */
function chooseSuccessor(diagnosis: Diagnosis | undefined, given: unknown): Successor {
  if (isSuccessor(given)) return given;
  const listed = Array.isArray(diagnosis?.successors)
    ? diagnosis.successors.find(isSuccessor)
    : undefined;
  if (listed) return listed;
  return {
    name: safe(diagnosis?.dependency?.name, 'the dependency', 80),
    ecosystem: diagnosis?.dependency?.ecosystem === 'pypi' ? 'pypi' : 'npm',
    kind: 'raise',
    reason: 'No successor is known. Rebuild the small utility as code the project owns.',
    source: 'curated',
  };
}

/**
 * A Kiro spec for moving the project off `diagnosis.dependency` onto `successor`. With a usage
 * scan it also describes the séance written for this project (files, command, what it compares).
 * When no successor is given, the diagnosis's first one is used, else the spec rebuilds the
 * dependency as code the project owns.
 */
export function resurrectionSpec(
  diagnosis: Diagnosis,
  successor?: Successor,
  options?: SpecOptions,
): KiroSpec {
  try {
    return buildSpec(diagnosis, successor, options);
  } catch {
    // Malformed input (for example an object whose properties throw): spec the bare names.
    return buildSpec(undefined as never, undefined, undefined);
  }
}

function seanceSection(bundle: SeanceBundle): string {
  const out: string[] = ['', '## The séance', ''];
  out.push(
    bundle.recipe
      ? `A curated recipe (\`${safe(bundle.recipe, 'recipe', 40)}\`) wrote it; it was run against the real packages before it was shipped.`
      : 'No curated recipe exists for this pair, so the generic template wrote it. Every `TODO(necromancer)` marker is a decision it could not make; the comparisons stay skipped until the replacement is written.',
    '',
    'Files to add to the project:',
    '',
    ...bundle.files.map((f) => `- \`${safe(f.path, 'file', 100)}\` (${safe(f.role, 'file', 20)})`),
    '',
    'Install and run (the old package is already installed and stays so until the last step):',
    '',
    '```sh',
    ...bundle.install.map((c) => safe(c, '', 160)),
    safe(bundle.run, '', 160),
    '```',
    '',
    'What it compares and ignores:',
    '',
    ...bundle.compares.map((c) => `- ${safe(c, '', 700)}`),
  );
  if (bundle.knownDifferences.length > 0) {
    out.push('', 'Known differences, found by running the séance against the real packages:', '');
    out.push(
      '| Input | Old package | Naive replacement | In the generated replacement |',
      '| --- | --- | --- | --- |',
    );
    for (const k of bundle.knownDifferences) {
      // Code spans keep runs of spaces: the old package's answer may be several.
      out.push(
        `| ${codeCell(k.input, 110)} | ${codeCell(k.old, 160)} | ${codeCell(k.naive, 160)} | ${safe(k.handled, '-', 160).replace(/\|/g, '/')} |`,
      );
    }
  }
  out.push('');
  return out.join('\n');
}

function buildSpec(
  diagnosis: Diagnosis,
  given: Successor | undefined,
  options: SpecOptions | undefined,
): KiroSpec {
  const usage = options?.usage;
  const old = safe(diagnosis?.dependency?.name, 'the dependency', 80);
  const chosen = chooseSuccessor(diagnosis, given);
  const next: Successor = {
    ...chosen,
    name: safe(chosen.name, 'the successor', 80),
    reason: safe(chosen.reason, 'no reason recorded', 220),
  };
  const safeDiagnosis: Diagnosis = {
    dependency: diagnosis?.dependency ?? {
      ecosystem: 'npm',
      name: old,
      spec: '',
      direct: true,
      scope: 'main',
      declaredIn: '',
    },
    verdict: diagnosis?.verdict ?? 'dead',
    evidence: Array.isArray(diagnosis?.evidence)
      ? diagnosis.evidence.filter((e) => typeof e === 'object' && e !== null)
      : [],
    advisories: Array.isArray(diagnosis?.advisories) ? diagnosis.advisories : [],
    successors: [],
    ...(diagnosis?.latest ? { latest: diagnosis.latest } : {}),
    ...(typeof diagnosis?.upgradeTo?.version === 'string'
      ? {
          upgradeTo: {
            version: diagnosis.upgradeTo.version,
            sameMajor: diagnosis.upgradeTo.sameMajor === true,
          },
        }
      : {}),
    ...(diagnosis?.basis === 'hard' || diagnosis?.basis === 'heuristic'
      ? { basis: diagnosis.basis }
      : {}),
  };
  const bundle = generateSeance(safeDiagnosis, chosen, usage);
  const ecosystem = safeDiagnosis.dependency.ecosystem === 'pypi' ? 'pypi' : 'npm';
  const runner = options?.project?.testRunner;
  const project: Project = {
    ecosystem,
    usagePath: `docs/migration/${slug(old)}-usage.md`,
    vendor: vendorPath(old, ecosystem, usage, bundle),
    ...(typeof runner === 'string' && runner.trim() !== '' ? { testRunner: runner } : {}),
  };
  const reqs = buildRequirements(old, next, safeDiagnosis, project);
  const r2 = reqs.find((r) => r.id === 'R2');
  if (r2) {
    const paths = bundle.files.map((f) => `\`${safe(f.path, 'file', 100)}\``).join(', ');
    r2.criteria.push({
      id: 'R2.5',
      text: `THE séance SHALL be added to the project as ${paths || 'the generated files'} and run with \`${safe(bundle.run, 'the test runner', 100)}\`. ${seanceTooling(project)}`,
    });
    if (bundle.knownDifferences.length > 0) {
      r2.criteria.push({
        id: 'R2.6',
        text: 'THE migration SHALL handle, or record as accepted, every known difference listed in the design.',
      });
    }
  }
  const needs =
    ecosystem === 'npm'
      ? 'needs Vitest, fast-check and Node 22.12 or newer'
      : 'needs pytest and Hypothesis';
  const tasks = renderTasks(old, next, reqs, project).replace(
    /(  - \[ \] 2\.4 [^\n]*\n)/,
    `$1  - [ ] 2.5 Add the generated séance files and run \`${safe(bundle.run, 'the test runner', 100).replace(/\$/g, '$$$$')}\` (${needs}); read every TODO(necromancer) marker ${r2 ? '_Requirements: R2.5' + (bundle.knownDifferences.length > 0 ? ', R2.6' : '') + '_' : ''}\n`,
  );
  return {
    'requirements.md': renderRequirements(old, next, safeDiagnosis, reqs),
    'design.md': renderDesign(old, next, safeDiagnosis, project) + seanceSection(bundle),
    'tasks.md': tasks,
  };
}
