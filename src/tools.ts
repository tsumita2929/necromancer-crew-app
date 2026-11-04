import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DependencyRef, Diagnosis, Successor } from '@necromancer/engine';
import { z } from 'zod';
import { NOT_FOUND_TEXT, advisoryList, basisInfo, describeSuccessor, isLowConfidence, movedNote } from './advice';
import type { EnginePort } from './engine-port';
import { buildGraveyard } from './graveyard';
import { readManifests as defaultReadManifests, type ReadManifests } from './manifests';
import { runNightWatch } from './nightwatch';
import { GuardError, assertSafeName, resolveProjectDir } from './project-guard';
import { readSourceFiles, readTestRunner } from './project-files';
import { SeanceError, cleanInstall, summarizeUsage, writeBundle } from './seance-tool';
import { Store, StoreError } from './store';

export interface ToolDeps {
  engine: EnginePort;
  store: Store;
  readManifests?: (dir: string) => Promise<ReadManifests>;
  now?: () => Date;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

class ToolInputError extends Error {}

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Runs a handler; turns any thrown error into a tool error, never a crash (R5.4). */
function guard<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      if (
        err instanceof ToolInputError ||
        err instanceof StoreError ||
        err instanceof SeanceError ||
        err instanceof GuardError
      ) {
        return fail(err.message);
      }
      return fail(`Unexpected error: ${(err as Error).message}`);
    }
  };
}

const ecosystem = z.enum(['npm', 'pypi']).describe('Package ecosystem.');
const name = z
  .string()
  .min(1)
  .max(214)
  .superRefine((value, ctx) => {
    try {
      assertSafeName(value);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message });
    }
  })
  .describe('Package name as published (letters, digits and . _ ~ - only, with an optional @scope/).');

const depInput = z.object({
  ecosystem,
  name,
  spec: z.string().max(200).optional().describe('Version range as written, e.g. "^2.88.0".'),
});

function toRef(d: z.infer<typeof depInput>): DependencyRef {
  return {
    ecosystem: d.ecosystem,
    name: d.ecosystem === 'pypi' ? d.name.toLowerCase().replace(/[-_.]+/g, '-') : d.name,
    spec: d.spec ?? '',
    direct: true,
    scope: 'main',
    declaredIn: 'tool-input',
  };
}

export { basisInfo };

/** What every answer about one dependency says first: verdict, basis, not-found, advisories, moved. */
function summarize(d: Diagnosis) {
  const moved = movedNote(d);
  return {
    name: d.dependency.name,
    verdict: d.verdict,
    notFound: d.notFound === true,
    ...(d.notFound ? { notFoundText: NOT_FOUND_TEXT } : {}),
    basis: basisInfo(d),
    advisories: advisoryList(d),
    ...(moved ? { moved } : {}),
    successors: d.successors.map(describeSuccessor),
  };
}

export function createToolServer(deps: ToolDeps): McpServer {
  const { engine, store } = deps;
  const readManifests = deps.readManifests ?? defaultReadManifests;
  const server = new McpServer({ name: 'necromancer', version: '0.1.0' });
  const tag = { engine: engine.name, ...(engine.note ? { note: engine.note } : {}) };

  async function diagnoseOne(d: z.infer<typeof depInput>): Promise<Diagnosis> {
    const [diagnosis] = await engine.engine.diagnose([toRef(d)]);
    if (!diagnosis) throw new ToolInputError('The engine returned no diagnosis.');
    return diagnosis;
  }

  server.registerTool(
    'autopsy',
    {
      description:
        'Scan a project and give every dependency a verdict (alive, dying, dead, ghost, zombie) with evidence. Give either "path" (a local directory, read-only) or "files" (manifest contents).',
      inputSchema: {
        path: z.string().min(1).optional().describe('Absolute path of a local project directory.'),
        files: z
          .array(
            z.object({
              kind: z.enum(['package.json', 'package-lock.json', 'requirements.txt', 'pyproject.toml']),
              path: z.string().min(1).max(500),
              content: z.string().max(2_000_000),
            }),
          )
          .max(40)
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { path?: string; files?: Array<{ kind: 'package.json' | 'package-lock.json' | 'requirements.txt' | 'pyproject.toml'; path: string; content: string }> }) => {
      if ((args.path === undefined) === (args.files === undefined)) {
        throw new ToolInputError('Give exactly one of "path" or "files".');
      }
      if (args.path !== undefined) {
        const project = await resolveProjectDir(args.path);
        const read = await readManifests(project.real);
        if (read.files.length === 0) {
          throw new ToolInputError(
            read.problems.length > 0 ? read.problems.join(' ') : `No manifest could be read in ${project.real}.`,
          );
        }
        const report = await engine.engine.autopsy({ subject: `local:${project.real}`, files: read.files });
        return {
          ...tag,
          read: {
            directory: project.real,
            ...(project.real !== project.given ? { given: project.given } : {}),
            manifests: read.files.map((f) => f.path),
            skipped: read.problems,
            limits: 'manifests up to 3 levels deep, at most 40 files, 2 MB each; node_modules, .git, dist and virtual environments are skipped; symbolic links are not followed',
          },
          report,
        };
      }
      const report = await engine.engine.autopsy({ subject: 'upload', files: args.files ?? [] });
      return { ...tag, report };
    }),
  );

  server.registerTool(
    'diagnose',
    {
      description:
        'Give verdicts and evidence for specific dependencies, without a project. "summaries" has one short entry per dependency (verdict, notFound, advisories with their other ids, a moved-repository note, ways out); "diagnoses" has the full engine records. A dependency with notFound=true is unknown to its registry (removed, private or misspelled), which is not the same as alive.',
      inputSchema: { dependencies: z.array(depInput).min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { dependencies: Array<z.infer<typeof depInput>> }) => ({
      ...tag,
      ...(await (async () => {
        const diagnoses = await engine.engine.diagnose(args.dependencies.map(toRef));
        return { summaries: diagnoses.map(summarize), diagnoses };
      })()),
    })),
  );

  server.registerTool(
    'successors',
    {
      description:
        'List the ways out for one dependency, best first (package, native or raise). A way out with isSuggestion=true is low confidence: offer it to the person, do not apply it unasked. A dependency with notFound=true has no verdict and no ways out; tell the person.',
      inputSchema: { ecosystem, name },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { ecosystem: 'npm' | 'pypi'; name: string }) => {
      const d = await diagnoseOne(args);
      const sum = summarize(d);
      const low = d.successors.filter(isLowConfidence).length;
      return {
        ...tag,
        verdict: d.verdict,
        notFound: sum.notFound,
        ...(sum.notFoundText ? { notFoundText: sum.notFoundText } : {}),
        basis: sum.basis,
        advisories: sum.advisories,
        ...(sum.moved ? { moved: sum.moved } : {}),
        successors: sum.successors,
        ...(d.successors.length > 0 && low === d.successors.length
          ? { note: 'Every way out is low confidence. Show them to the person as suggestions and ask which one, if any, to use.' }
          : {}),
      };
    }),
  );

  /** The successor to use: a listed one, or "raise" when none is known. Throws a clear message otherwise. */
  function chooseSuccessor(
    d: Diagnosis,
    args: { ecosystem: 'npm' | 'pypi'; name: string; successor?: string },
  ): Successor {
    if (d.notFound) {
      throw new ToolInputError(
        `${args.name} was not found on the ${args.ecosystem} registry (removed, private or misspelled). Do not migrate it. Tell the person, and ask them to check the name and where the package comes from.`,
      );
    }
    if (d.verdict === 'alive') {
      throw new ToolInputError(`${args.name} is alive; there is nothing to resurrect.`);
    }
    const names = d.successors.map((s) => s.name);
    let chosen =
      args.successor === undefined ? d.successors[0] : d.successors.find((s) => s.name === args.successor);
    // No successor is known: the way out is to raise the package, that is, rebuild it as code
    // the project owns. Allowed when the caller names nothing, "raise", or the package itself.
    if (
      !chosen &&
      d.successors.length === 0 &&
      (args.successor === undefined || args.successor === 'raise' || args.successor === args.name)
    ) {
      chosen = {
        name: args.name,
        ecosystem: args.ecosystem,
        kind: 'raise',
        reason: 'No successor is known. Rebuild the small utility as code the project owns.',
        source: 'curated',
      };
    }
    if (!chosen) {
      throw new ToolInputError(
        names.length === 0
          ? `No successor is known for ${args.name}.`
          : `"${args.successor}" is not a successor of ${args.name}. Valid successors: ${names.join(', ')}.`,
      );
    }
    return chosen;
  }

  /** Scan a project directory for how it uses one dependency. Needs an engine that can scan. */
  async function scanProject(dir: string, target: { ecosystem: 'npm' | 'pypi'; name: string; importNames?: string[] }) {
    const eng = engine.engine;
    if (typeof eng.scanUsage !== 'function' || typeof eng.seance !== 'function') {
      throw new ToolInputError(
        `The ${engine.name} engine cannot scan usage or generate a séance${engine.note ? ` (${engine.note})` : ''}. Write the comparison by hand.`,
      );
    }
    const project = await resolveProjectDir(dir);
    const real = project.real;
    const sources = await readSourceFiles(real);
    const usage = eng.scanUsage(sources.files, target);
    return { root: real, sources, usage, project };
  }

  /**
   * What to tell the agent about the chosen way out. A low-confidence one is a suggestion: the agent
   * asks the person before using it. When every listed way out is low, the best of them is still chosen
   * by default, and this says so.
   */
  function confirmation(d: Diagnosis, chosen: Successor, explicit: boolean) {
    const low = isLowConfidence(chosen);
    const allLow = d.successors.length > 0 && d.successors.every(isLowConfidence);
    const notes: string[] = [];
    if (low) {
      notes.push(
        allLow && !explicit
          ? 'Every listed way out is low confidence, so this is the best of a weak list. Ask the person whether to use it, or to name another, before you migrate.'
          : 'This way out is low confidence: a suggestion, not a drop-in. Ask the person before you migrate.',
      );
    }
    return { needsConfirmation: low, notes };
  }

  server.registerTool(
    'resurrection_spec',
    {
      description:
        'Write the three Kiro spec files (requirements, design, tasks) for moving a project off one dead dependency. The successor must be one that "successors" lists; the default is the best one. With no successor known it writes a raise spec. Give "path" (the project directory) to scan how the project uses the dependency; the spec then describes the project\'s real calls and the generated séance. A package the registry does not know (notFound) is refused. When the chosen way out has needsConfirmation=true (low confidence), ask the person before you migrate.',
      inputSchema: {
        ecosystem,
        name,
        successor: z.string().min(1).optional().describe('Successor name from the successors tool.'),
        path: z.string().min(1).optional().describe('Absolute path of the project, to scan its usage.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { ecosystem: 'npm' | 'pypi'; name: string; successor?: string; path?: string }) => {
      const d = await diagnoseOne(args);
      const chosen = chooseSuccessor(d, args);
      const confirm = confirmation(d, chosen, args.successor !== undefined);
      const common = {
        ...tag,
        basis: basisInfo(d),
        advisories: advisoryList(d),
        ...(movedNote(d) ? { moved: movedNote(d) } : {}),
        successor: describeSuccessor(chosen),
        needsConfirmation: confirm.needsConfirmation,
        notes: confirm.notes,
      };
      if (args.path !== undefined) {
        const { usage, sources, root } = await scanProject(args.path, { ecosystem: args.ecosystem, name: args.name });
        const testRunner = await readTestRunner(root);
        return {
          ...common,
          usage: summarizeUsage(usage, sources),
          project: { testRunner: testRunner ?? null },
          spec: engine.engine.resurrectionSpec(d, chosen, { usage, project: testRunner ? { testRunner } : {} }),
        };
      }
      return { ...common, spec: engine.engine.resurrectionSpec(d, chosen) };
    }),
  );

  type SeanceArgs = {
    ecosystem: 'npm' | 'pypi';
    name: string;
    path: string;
    successor?: string;
    importNames?: string[];
    acceptLowConfidence?: boolean;
  };

  const seanceShape = {
    ecosystem,
    name,
    path: z.string().min(1).describe('Absolute path of the project directory.'),
    successor: z.string().min(1).optional().describe('Successor name; default the best listed one, or raise.'),
    importNames: z.array(z.string().min(1).max(100)).max(10).optional().describe('Python import names when they differ from the distribution name.'),
  };

  /** Scan, choose, generate. Writes nothing. Shared by the preview and the write tool. */
  async function prepareSeance(args: SeanceArgs) {
    const d = await diagnoseOne(args);
    const chosen = chooseSuccessor(d, args);
    const confirm = confirmation(d, chosen, args.successor !== undefined);
    const { root, sources, usage } = await scanProject(args.path, {
      ecosystem: args.ecosystem,
      name: args.name,
      ...(args.importNames ? { importNames: args.importNames } : {}),
    });
    const bundle = engine.engine.seance!(d, chosen, usage);
    if (bundle.files.length === 0) throw new ToolInputError('The generator returned no files.');
    const generic = bundle.recipe === null;
    const report = summarizeUsage(usage, sources);
    const notes: string[] = [...confirm.notes];
    if (generic) {
      notes.push(
        'No curated recipe exists for this pair, so this is the generic template. Its comparisons are SKIPPED until the replacement module sets READY. Write the replacement, fill each TODO(necromancer) marker (generators and comparison), then set READY.',
      );
    }
    if (bundle.todos > 0 && !generic) {
      notes.push(`${bundle.todos} TODO(necromancer) marker(s) remain in the files. Resolve them.`);
    }
    const cleaned = cleanInstall(bundle.install, args.name);
    if (cleaned.note) notes.push(cleaned.note);
    if (bundle.language === 'javascript') {
      notes.push(
        'The generated séance runs under Vitest, which needs Node 22.12 or newer. If the project supports older Node, say so in the report. If the project runs tests with node --test, keep the Vitest file out of that run (for example "test": "node --test test/*.test.js") and add a separate script ("seance": "vitest run seance").',
      );
    }
    const moved = movedNote(d);
    const base = {
      ...tag,
      dependency: args.name,
      verdict: d.verdict,
      basis: basisInfo(d),
      advisories: advisoryList(d),
      ...(moved ? { moved } : {}),
      successor: describeSuccessor(chosen),
      needsConfirmation: confirm.needsConfirmation,
      language: bundle.language,
      recipe: bundle.recipe,
      template: generic ? 'generic' : 'curated',
      comparisonsSkipped: generic,
      todos: bundle.todos,
      install: cleaned.install,
      run: bundle.run,
      compares: bundle.compares,
      members: bundle.members,
      knownDifferences: bundle.knownDifferences,
      usage: report,
      notes,
    };
    return { base, bundle, root, chosen };
  }

  server.registerTool(
    'seance',
    {
      description:
        'PREVIEW of the séance for moving a project off one dead dependency. Read-only: it scans the project at "path" and returns the files, the install and run commands, what they compare and the known differences, and it never writes anything. It is a differential property-based test that asks the old package and its replacement the same generated questions, using the project\'s own calls as examples; a curated recipe is used when one exists, else a generic template whose comparisons stay skipped until the replacement sets READY. To put the files into the project, call seance_write on a resurrect/<dependency> branch. If the answer has needsConfirmation=true (a low-confidence way out), ask the person first. A package the registry does not know (notFound) is refused.',
      inputSchema: seanceShape,
      annotations: { readOnlyHint: true },
    },
    guard(async (args: SeanceArgs) => {
      const { base, bundle } = await prepareSeance(args);
      return { ...base, wrote: false, files: bundle.files };
    }),
  );

  server.registerTool(
    'seance_write',
    {
      description:
        'WRITE the séance files into the project. Only while the project is on a git branch named resurrect/<dependency>; never over a file that differs; never outside the project. Use "seance" first to preview. A low-confidence way out is refused unless the person agreed and you pass acceptLowConfidence=true. A package the registry does not know (notFound) is refused.',
      inputSchema: {
        ...seanceShape,
        acceptLowConfidence: z
          .boolean()
          .optional()
          .describe('Set true only after the person agreed to use a low-confidence way out.'),
      },
    },
    guard(async (args: SeanceArgs) => {
      const { base, bundle, root, chosen } = await prepareSeance(args);
      if (isLowConfidence(chosen) && args.acceptLowConfidence !== true) {
        throw new ToolInputError(
          `${chosen.name} is a low-confidence way out for ${args.name}: a suggestion, not a drop-in. Nothing was written. Ask the person whether to use it, then call seance_write again with acceptLowConfidence=true.`,
        );
      }
      const result = await writeBundle(root, bundle);
      return {
        ...base,
        wrote: true,
        branch: result.branch,
        written: result.written,
        unchanged: result.unchanged,
      };
    }),
  );

  server.registerTool(
    'watch_add',
    {
      description:
        'Add a local project directory to the Night Watch list. The path must be absolute and hold a manifest (package.json, package-lock.json, requirements.txt or pyproject.toml); the filesystem root and home directories are refused.',
      inputSchema: { path: z.string().min(1).describe('Absolute path of an existing directory.') },
    },
    guard(async (args: { path: string }) => {
      const dir = await resolveProjectDir(args.path);
      const { project, added } = await store.addProject(dir.real);
      return { added, id: project.id, path: project.path, manifests: dir.manifests };
    }),
  );

  server.registerTool(
    'watch_list',
    { description: 'List watched projects and when each was last scanned.', inputSchema: {}, annotations: { readOnlyHint: true } },
    guard(async () => {
      const state = await store.load();
      return {
        projects: Object.values(state.projects).map((p) => ({
          id: p.id,
          path: p.path,
          status: p.status,
          lastScanAt: p.lastScanAt ?? null,
          baselineDone: p.snapshot !== undefined,
        })),
      };
    }),
  );

  server.registerTool(
    'watch_remove',
    {
      description: 'Stop watching a project (by id or path) and delete its snapshot.',
      inputSchema: { id: z.string().min(1) },
    },
    guard(async (args: { id: string }) => {
      const removed = await store.removeProject(args.id);
      return removed ? { removed: true } : { removed: false, message: `"${args.id}" is not watched.` };
    }),
  );

  server.registerTool(
    'nightwatch_run',
    {
      description:
        'Re-scan every watched project and return the notifications to send: one per dependency whose verdict got worse, and one when a project directory first goes missing. An empty "notifications" list means stay silent.',
      inputSchema: {},
    },
    guard(async () =>
      runNightWatch({
        store,
        engine: engine.create ? engine.create() : engine.engine,
        engineName: engine.name,
        readManifests,
        now: deps.now,
      }),
    ),
  );

  server.registerTool(
    'graveyard',
    {
      description: 'The stored graveyard: per project, verdict counts and the non-alive dependencies, worst first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => buildGraveyard(await store.load())),
  );

  return server;
}
