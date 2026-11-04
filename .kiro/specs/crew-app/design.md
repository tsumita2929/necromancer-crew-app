# Design: Necromancer Kiro Crew app

## Overview

```
 cron "night-watch" (daily, silent)
        |  message
        v
 Necromancer agent --calls--> MCP server "necromancer" (stdio, Node)
        |  skill: resurrection         |-- engine port --> stub (fixtures)  | real engine (next round)
        |                              |-- store (data/watch.json)
        |  send_notification           '-- nightwatch handler (pure core)
        v
 owner's notification channel

 Graveyard page (React, ui/) --GET--> backend (Python stdlib, reads data/watch.json)
```

Why each piece exists:

| Piece | Why it is there |
|---|---|
| Scheduled agent job | The one Kiro Crew feature a static web app cannot have: the product keeps watching after the tab closes. The job spends one short model turn a day, only to relay and to offer the migration. The decision itself is code, not a model call. |
| MCP server | The engine's tools become available to any Kiro agent, not only ours. The same server answers the cron run and the interactive migration. |
| Pure Night Watch core | `detectWorse(previous, current)` is a pure function, so a property test can cover the whole input space. |
| Python backend | The dashboard page can only reach the gateway and the app's own backend. A 60-line stdlib server reads the JSON file the MCP server writes. No dependencies to install. |
| Skill | The migration procedure (spec, séance test, branch, no push) is domain knowledge that must be identical every run. |

## Components

### Engine port (`src/engine-port.ts`)

`EnginePort = Pick<Engine, 'diagnose' | 'autopsy' | 'resurrectionSpec'>` plus a
`name: 'stub' | 'engine'`. `selectEngine()` returns the stub unless
`NECROMANCER_ENGINE=real` is set and `@necromancer/engine` exports `createEngine`;
if loading fails it falls back to the stub and the tool results say so. The package is
imported dynamically through a variable specifier, so the bundle never contains the
engine and the app builds while the engine is unfinished.

### Stub engine (`src/stub-engine.ts`, `src/fixtures.ts`)

Deterministic fixtures typed against `types.ts`: `left-pad` (dead, native successor),
`request` (zombie, with an advisory), `moment` (dying), `express` (alive), a PyPI
`nose` (dead), `ghost-pkg` (ghost). `diagnose` looks the package up by name; unknown
names are `alive` with no evidence, which is what an engine finding nothing would say.
`autopsy` parses a minimal subset of `package.json` and `requirements.txt` (names only),
so the Night Watch path runs end to end against real files on disk.

### Store (`src/store.ts`)

One JSON file `watch.json` in `NECROMANCER_DATA_DIR` (default `<app root>/data`):

```ts
interface WatchState {
  version: 1;
  projects: Record<string, WatchedProject>; // id -> project
}
interface WatchedProject {
  id: string;            // sha1(resolved path).slice(0, 12)
  path: string;          // absolute
  addedAt: string;       // ISO-8601
  lastScanAt?: string;
  status: 'ok' | 'missing' | 'error';
  snapshot?: Record<string, Verdict>;   // "npm:left-pad" -> verdict
  report?: AutopsyReport;               // last report, rendered by the page
}
```

Writes go to a temp file in the same directory and are renamed over the target
(atomic on POSIX). A corrupt file is renamed to `watch.json.corrupt-<ms>` and an empty
state starts (R3.6).

### Night Watch (`src/nightwatch.ts`)

```ts
rank(v: Verdict): number
detectWorse(prev: Snapshot | undefined, cur: Snapshot): Worsened[]   // pure
mergeSnapshot(prev, cur, partial): Snapshot                          // pure
runNightWatch({ store, engine, readManifests, now }): Promise<NightWatchResult>
```

`detectWorse`: for each dependency key in `cur`, `before = prev[key] ?? 'alive'`;
worse when `rank(cur) > rank(before)`. With `prev === undefined` (first scan) the
result is empty (baseline, R4.5).

`mergeSnapshot(prev, cur, partial)`: when `partial` is false the new snapshot is `cur`.
When true, each key takes the worse of `prev` and `cur`, so a source outage cannot
fake a recovery (R4.8). Keys no longer present are dropped when not partial.

`runNightWatch` per project: path check (missing → skip, one notification on the
transition from `ok`), read manifests, `engine.autopsy`, `detectWorse`, store. Each
project runs in its own try/catch (R4.10). The result:

```ts
interface NightWatchResult {
  engine: 'stub' | 'engine';
  ranAt: string;
  projects: Array<{ id; path; status: 'scanned'|'baseline'|'missing'|'error'; worsened: number;
                    unavailable: SourceId[]; message?: string }>;
  notifications: Array<{ kind: 'worse'|'project-missing'; projectId; title; body }>;
}
```

### MCP server (`src/server.ts`, `src/tools.ts`)

`@modelcontextprotocol/sdk` over stdio, bundled with esbuild into `dist/server.mjs`.
`tools.ts` exposes `createToolServer(deps)` taking the engine and store, so tests
connect a client over an in-memory transport. A bare `mcp/launch.py` starts it, because the
platform resolves a relative `.py` launcher against the app root but leaves a relative
`node` script path under the session's working directory.

Tool results are JSON text with `isError` set on failure. Input is validated with
zod; `path` inputs are resolved and must be directories; only the four manifest names are read.

### Page (`ui/src/App.tsx`)

`useAppApi().get('/apps/necromancer/api/graveyard')`. Parts: summary row of `StatCard`s
(one per verdict, with symbol and text), project list, dependency "tombstones" with the
epitaph and successor, "Raise the dead" button using `useChatLauncher().openChat` with
`autoSend: false` and `agent: 'necromancer'`. Verdict symbols: alive ✓, dying ◐, dead ✝,
ghost ◌, zombie ☣. Motion is a CSS fade, disabled under `prefers-reduced-motion`.

### Manifest (`app.json`)

Permissions: `api: ["/apps/necromancer/api"]`, `events: ["notification"]`,
`mcpTools: ["send_notification"]`, `cron: true`. Nothing else.
Cron `night-watch`: `cron_expr: "0 3 * * *"`, `timezone: "Asia/Tokyo"`, `silent: true`,
`persistent_session: false`, `agent: "necromancer"`.

### Agent and skill

`agents/necromancer.json`: tools are the app's MCP server, file tools, `execute_bash`,
and `@kirocrew-core/send_notification`. The prompt carries the hard rules (no push, local
branch only, ask on dirty tree). `skills/resurrection/SKILL.md` carries the procedure
for Reincarnate and Raise, and the shape of the séance test.

## Error handling

| Input | Behaviour |
|---|---|
| No watched projects | `nightwatch_run` returns an empty result, no notification |
| Path gone | status `missing`, snapshot kept, one notification on transition |
| Source unavailable | verdicts never lowered, sources listed |
| Same verdicts twice | no notification |
| One dependency worse | exactly one notification |
| Corrupt state file | moved aside, empty state, message in result |
| Invalid tool input | `isError` result with message |

## Testing strategy

- Vitest unit tests for store, stub engine, tools (in-memory MCP client), Night Watch
  runner (temp directories, injected clock).
- fast-check properties named after requirements:
  `R4.2 never notifies when nothing got worse`,
  `R4.3 notifies once per worsened dependency`,
  `R4.4 equal or better never notifies`,
  `R4.8 a partial scan never lowers a stored verdict`,
  `R4.7 a second run with the same input is silent`.
- A contract test: the local verdict order equals `VERDICTS` of the shared contract.
- A stdio smoke script launches `mcp/launch.py`, lists tools and calls `diagnose`.
- Install proof: `kirocrew app install`, `kirocrew app info`, then enable once trusted.
