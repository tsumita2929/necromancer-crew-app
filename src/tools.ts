import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DependencyRef, Diagnosis, Successor } from '@necromancer/engine';
import { realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { EnginePort } from './engine-port';
import { buildGraveyard } from './graveyard';
import { readManifests as defaultReadManifests, type ReadManifests } from './manifests';
import { runNightWatch } from './nightwatch';
import { readSourceFiles } from './project-files';
import { SeanceError, summarizeUsage, writeBundle } from './seance-tool';
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
      if (err instanceof ToolInputError || err instanceof StoreError || err instanceof SeanceError) {
        return fail(err.message);
      }
      return fail(`Unexpected error: ${(err as Error).message}`);
    }
  };
}

const ecosystem = z.enum(['npm', 'pypi']).describe('Package ecosystem.');
const name = z.string().min(1).max(214).describe('Package name as published.');

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
        const read = await readManifests(args.path);
        if (read.files.length === 0) {
          throw new ToolInputError(
            read.problems.length > 0 ? read.problems.join(' ') : `No manifest found in ${args.path}.`,
          );
        }
        const report = await engine.engine.autopsy({ subject: `local:${args.path}`, files: read.files });
        return { ...tag, report };
      }
      const report = await engine.engine.autopsy({ subject: 'upload', files: args.files ?? [] });
      return { ...tag, report };
    }),
  );

  server.registerTool(
    'diagnose',
    {
      description: 'Give verdicts and evidence for specific dependencies, without a project.',
      inputSchema: { dependencies: z.array(depInput).min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { dependencies: Array<z.infer<typeof depInput>> }) => ({
      ...tag,
      diagnoses: await engine.engine.diagnose(args.dependencies.map(toRef)),
    })),
  );

  server.registerTool(
    'successors',
    {
      description: 'List the ways out for one dependency, best first (package, native or raise).',
      inputSchema: { ecosystem, name },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { ecosystem: 'npm' | 'pypi'; name: string }) => {
      const d = await diagnoseOne(args);
      return { ...tag, verdict: d.verdict, successors: d.successors };
    }),
  );

  /** The successor to use: a listed one, or "raise" when none is known. Throws a clear message otherwise. */
  function chooseSuccessor(
    d: Diagnosis,
    args: { ecosystem: 'npm' | 'pypi'; name: string; successor?: string },
  ): Successor {
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
    let real: string;
    try {
      real = await realpath(dir);
      if (!(await stat(real)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ToolInputError(`${dir} does not exist or is not a directory.`);
    }
    const sources = await readSourceFiles(real);
    const usage = eng.scanUsage(sources.files, target);
    return { root: real, sources, usage };
  }

  server.registerTool(
    'resurrection_spec',
    {
      description:
        'Write the three Kiro spec files (requirements, design, tasks) for moving a project off one dead dependency. The successor must be one that "successors" lists; the default is the best one. With no successor known it writes a raise spec. Give "path" (the project directory) to scan how the project uses the dependency; the spec then describes the project\'s real calls and the generated séance.',
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
      if (args.path !== undefined) {
        const { usage, sources } = await scanProject(args.path, { ecosystem: args.ecosystem, name: args.name });
        return {
          ...tag,
          successor: chosen,
          usage: summarizeUsage(usage, sources),
          spec: engine.engine.resurrectionSpec(d, chosen, { usage }),
        };
      }
      return { ...tag, successor: chosen, spec: engine.engine.resurrectionSpec(d, chosen) };
    }),
  );

  server.registerTool(
    'seance',
    {
      description:
        'Generate the séance for moving a project off one dead dependency: a differential property-based test that asks the old package and its replacement the same generated questions, using the project\'s own calls as examples. Scans the project at "path", picks a curated recipe when one exists (else a generic template whose comparisons stay skipped until the replacement sets READY), and returns the files, the install and run commands, what it compares, and the known differences. With write=true the files are written into the project, but only while it is on a branch named resurrect/<dependency>, and never over a file that differs.',
      inputSchema: {
        ecosystem,
        name,
        path: z.string().min(1).describe('Absolute path of the project directory.'),
        successor: z.string().min(1).optional().describe('Successor name; default the best listed one, or raise.'),
        importNames: z.array(z.string().min(1).max(100)).max(10).optional().describe('Python import names when they differ from the distribution name.'),
        write: z.boolean().optional().describe('Write the files into the project (resurrection branch only).'),
      },
    },
    guard(
      async (args: {
        ecosystem: 'npm' | 'pypi';
        name: string;
        path: string;
        successor?: string;
        importNames?: string[];
        write?: boolean;
      }) => {
        const d = await diagnoseOne(args);
        const chosen = chooseSuccessor(d, args);
        const { root, sources, usage } = await scanProject(args.path, {
          ecosystem: args.ecosystem,
          name: args.name,
          ...(args.importNames ? { importNames: args.importNames } : {}),
        });
        const bundle = engine.engine.seance!(d, chosen, usage);
        if (bundle.files.length === 0) throw new ToolInputError('The generator returned no files.');
        const generic = bundle.recipe === null;
        const report = summarizeUsage(usage, sources);
        const notes: string[] = [];
        if (generic) {
          notes.push(
            'No curated recipe exists for this pair, so this is the generic template. Its comparisons are SKIPPED until the replacement module sets READY. Write the replacement, fill each TODO(necromancer) marker (generators and comparison), then set READY.',
          );
        }
        if (bundle.todos > 0 && !generic) {
          notes.push(`${bundle.todos} TODO(necromancer) marker(s) remain in the files. Resolve them.`);
        }
        const base = {
          ...tag,
          dependency: args.name,
          verdict: d.verdict,
          successor: chosen,
          language: bundle.language,
          recipe: bundle.recipe,
          template: generic ? 'generic' : 'curated',
          comparisonsSkipped: generic,
          todos: bundle.todos,
          install: bundle.install,
          run: bundle.run,
          compares: bundle.compares,
          members: bundle.members,
          knownDifferences: bundle.knownDifferences,
          usage: report,
          notes,
        };
        if (args.write === true) {
          const result = await writeBundle(root, bundle);
          return {
            ...base,
            wrote: true,
            branch: result.branch,
            written: result.written,
            unchanged: result.unchanged,
          };
        }
        return { ...base, wrote: false, files: bundle.files };
      },
    ),
  );

  server.registerTool(
    'watch_add',
    {
      description: 'Add a local project directory to the Night Watch list.',
      inputSchema: { path: z.string().min(1).describe('Absolute path of an existing directory.') },
    },
    guard(async (args: { path: string }) => {
      const { project, added } = await store.addProject(args.path);
      return { added, id: project.id, path: project.path };
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
