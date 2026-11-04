# Design: Crew app on the real engine, and one end-to-end resurrection

## Real engine in the bundle (R1.1 to R1.4)

`src/real-engine.ts` imports `createEngine` from `@necromancer/engine` and esbuild bundles
the engine source into `dist/server.mjs`. The installed app copy has no `node_modules`, so a
dynamic import would fail there; bundling fixes that. The engine has no runtime dependencies
and is isomorphic, so bundling is safe.

`selectEngine(env, factory = createReal)`:

| Condition | Result |
|---|---|
| `NECROMANCER_ENGINE=stub` | stub, no note |
| default | `factory()`; on success `engine: "engine"` |
| `factory()` throws | stub, `note: "Real engine unavailable, using the stub: <cause>"` |

The `factory` parameter exists so a test can simulate a load failure. The live fetch is
`globalThis.fetch`, which already matches `FetchLike`.

Night Watch (`runNightWatch`) already receives `engineName`, so its result is labelled.

## Offline tests on the real engine (R1.5, R1.6, R4)

`test/recorded/` holds a small copy of the engine's recorded responses for the packages the
haunted app uses (left-pad, request, and their repositories, plus the OSV entries). The
test fetch serves them and fails on anything unrecorded. File names use the same
hash scheme as the engine's own recordings. Verdicts are compared with the values asserted
in `packages/engine/test/fixtures.test.ts`.

"Gets worse" is simulated by wrapping the fetch: on the second scan, the npm registry answer for
one live package gains a `deprecated` message. Night Watch then notifies once.

## Haunted app (R2)

```
demo/haunted-app/
  package.json, package-lock.json   left-pad, request; fast-check only as devDependency
  src/receipt.js     formats a receipt table: leftPad for numeric columns and a configurable fill
  src/rates.js       fetches exchange rates from a rates service with `request`
  test/*.test.js     node:test, a local HTTP server for the rates service
  README.md          "haunted on purpose"
```

The fill character is configurable (`options.fill`), because real projects let users
configure padding. That makes the séance generator's domain include odd fills, where the dead
package and `padStart` can really differ.

## The run (R3)

Scratch copy: `scratch/crew/haunted-app/` with `git init`. The steps follow the skill. The
driver is recorded in `crew-live.md`: the installed app if the owner has installed it, else a
fresh subagent (or this worker, said plainly) using the agent prompt, the skill and the MCP
server over stdio.

Branch name: the skill currently says `necromancer/<dependency>`. The lead asked for
`resurrect/<dependency>`. The skill and the agent prompt are changed to `resurrect/`, so
the run follows them as written.

## Séance shapes

- left-pad to `padStart`: `fc.string`, integer width (negative, zero, large), fill drawn from
  what the project allows.
- request to `fetch`: a local HTTP server whose handler is driven by the generated case
  (status, body, headers, delay). Compare the project-visible result: status code, parsed
  body, headers the project reads, error kind.
- Old versus old first. A deliberately wrong replacement must fail with a shrunk counterexample.

## Failure handling (R5)

| Input | Behaviour |
|---|---|
| No successor | `successors` returns an empty list or a `raise` entry; the skill rebuilds the utility in `src/vendor/` |
| Unlisted successor | `resurrection_spec` refuses with the valid names (tested in round 1) |
| Dirty tree | skill step 1 stops; nothing is written |
| No git repository | skill step 1 stops; no `git init` |
| Engine load failure | stub, labelled |
