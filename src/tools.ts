import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DependencyRef, Diagnosis } from '@necromancer/engine';
import { z } from 'zod';
import type { EnginePort } from './engine-port';
import { buildGraveyard } from './graveyard';
import { readManifests as defaultReadManifests, type ReadManifests } from './manifests';
import { runNightWatch } from './nightwatch';
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
      if (err instanceof ToolInputError || err instanceof StoreError) return fail(err.message);
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

  server.registerTool(
    'resurrection_spec',
    {
      description:
        'Write the three Kiro spec files (requirements, design, tasks) for moving a project off one dead dependency. The successor must be one that "successors" lists; the default is the best one.',
      inputSchema: {
        ecosystem,
        name,
        successor: z.string().min(1).optional().describe('Successor name from the successors tool.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args: { ecosystem: 'npm' | 'pypi'; name: string; successor?: string }) => {
      const d = await diagnoseOne(args);
      if (d.verdict === 'alive') {
        throw new ToolInputError(`${args.name} is alive; there is nothing to resurrect.`);
      }
      const names = d.successors.map((s) => s.name);
      const chosen =
        args.successor === undefined ? d.successors[0] : d.successors.find((s) => s.name === args.successor);
      if (!chosen) {
        throw new ToolInputError(
          names.length === 0
            ? `No successor is known for ${args.name}.`
            : `"${args.successor}" is not a successor of ${args.name}. Valid successors: ${names.join(', ')}.`,
        );
      }
      return { ...tag, successor: chosen, spec: engine.engine.resurrectionSpec(d, chosen) };
    }),
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
