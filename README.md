# Necromancer: a Kiro Crew app that watches your dependencies and raises the dead ones

> Find the dead in your dependency tree. Raise your code on living ones.

Necromancer is a [Kiro Crew](https://kiro.dev) app for the **Kiroween 2026** hackathon (category Resurrection, and the Best Kiro Crew App prize).
It finds dead dependencies (deprecated, archived, abandoned, or carrying advisories nobody will fix), keeps watching your
projects every night, and, when you ask, **raises** a project off a dead dependency on a local git branch: it writes a Kiro spec,
generates a **séance** (a differential property-based test that asks the dead package and its replacement the same generated
questions), migrates the code and proves the result. It never pushes.

This repository is the Crew app on its own, ready to install. The engine, the static web app, the research and the full history
live in the main repository: **https://github.com/tsumita2929/necromancer**.

## What you get

| Piece | What it is | Kiro Crew feature |
|---|---|---|
| **Graveyard** page | Your watched projects and their dead dependencies, worst first, each with an epitaph (the evidence) and a way out. Verdict is shown as a symbol and a word, never colour alone. "Raise the dead" opens a chat draft with the agent. | UI page (`ui/`), app backend (`backend/`) |
| **Night Watch** | A scheduled job (daily, 03:00 Asia/Tokyo, silent) that re-scans the watched projects and notifies **only when a dependency's verdict got worse**, once per dependency. Detection is plain code with property tests, not a model's opinion; the agent only relays the result. | `crons` in `app.json`, `send_notification` |
| **Necromancer agent** | Runs Night Watch and the resurrection. Hard rules in its prompt: never push, never add a remote, work only on a local `resurrect/<dependency>` branch, stop on a dirty tree or a non-git folder. | `agents/necromancer.json` |
| **`resurrection` skill** | The procedure: scan before branching, write the spec, run the **generated séance first**, prove it can fail, migrate task by task, keep a golden guard after the old package is gone, report. | `skills/resurrection/SKILL.md` |
| **MCP server** (11 tools) | `autopsy`, `diagnose`, `successors`, `resurrection_spec`, `seance` (read-only preview), `seance_write` (writes, on a `resurrect/` branch only), `watch_add`, `watch_list`, `watch_remove`, `nightwatch_run`, `graveyard`. The real [Necromancer engine](#the-engine) is bundled; it reads public data only (npm, PyPI, deps.dev, OSV, OpenSSF Scorecard). | `mcpServers` in `app.json`, started by `mcp/launch.py` |
| **Minimal permissions** | `api: /apps/necromancer/api` and `cron`. No `network`, `spawn`, `sessionApproval`, `memory` or `storage`. | `permissions` |

### How a resurrection goes

```
you:     Raise the dead: left-pad in ~/work/my-shop. Use the resurrection skill; do not push.
agent:   diagnose  -> left-pad 1.3.0 is dead (deprecated; no release in 8 years)
         successors -> String.prototype.padStart (native)
         seance (scan)   -> 4 calls in src/receipt.js, no warnings
         git switch -c resurrect/left-pad
         seance_write    -> seance/left-pad/{seance.test.mjs, replacement.mjs, README.md}
         run the séance  -> passes against left-pad
         swap in the plain padStart as a mutant -> FAILS with a shrunk counterexample:
                            leftPad("", 1, "")      is " "   but padStart gives ""
                            leftPad("$12.50", 10, "*-") is "*-*-*-*-$12.50" but padStart gives "*-*-$12.50"
         migrate task by task, keep a golden replay, remove left-pad, run the project's tests
         report: branch, spec, séance result, mutant, what was written by hand. Nothing was pushed.
```

That failure is the point: a plain swap to the "obvious" replacement is **not** a drop-in, and nobody wrote those differences
down before the property tests found them. Three runs on a demo project (included here as `examples/haunted-app`) found real
differences for `left-pad` (empty and multi-character fills), `request` to `fetch` (idle timeout versus total deadline, `Accept` on POST,
redirects, query encoding) and `is-odd`. See the verification records in the main repository.

### Night Watch, precisely

* Re-scans every watched project with the engine. The **first scan is a baseline** and never notifies.
* Compares each dependency's verdict (`alive < dying < dead < ghost < zombie`) with the stored snapshot. Equal or better never notifies; worse
  notifies **exactly once**, then the snapshot moves, so the next night is silent.
* A scan with an unavailable source never lowers a stored verdict (missing evidence is not recovery).
* A project directory that disappears gives one "project missing" notice, not one per night.
* One project failing does not stop the others. Property tests (fast-check) cover the detector over the whole input space.

## Install (for a judge)

You need a running Kiro Crew gateway, **Node.js 22.12 or newer** (the test run uses 22.12), and Python 3. Git is needed for the
resurrection itself.

```bash
git clone https://github.com/tsumita2929/necromancer-crew-app.git necromancer-crew-app
kirocrew app install "$(pwd)/necromancer-crew-app"
```

On Windows PowerShell use `kirocrew app install (Resolve-Path .\necromancer-crew-app)`. The CLI installs from a local path; the built output
(`dist/server.mjs`, `ui/dist/index.mjs`) is committed, so there is **no build step**.

Kiro Crew refuses to run the executable parts of any third-party app until the operator trusts it, and Necromancer has a backend process and an MCP
server. Do this once in the dashboard:

1. **Settings → Security → Third-party apps** → trust `necromancer` (or turn on "Trust every third-party app").
2. Enable it: `kirocrew app enable necromancer` (or the toggle on the app's page).

Then:

1. Open **Graveyard** in the sidebar. With nothing watched it shows a clearly labelled **demo graveyard**.
2. Start a chat with the **necromancer** agent and say: `Watch this project with Night Watch: /absolute/path/to/a/node/or/python/project`.
3. Ask it to run Night Watch now: `Run Night Watch.` (the schedule is on the **Schedule** page as `night-watch`, daily 03:00 Asia/Tokyo; change it there).
4. Try the resurrection on the included demo: copy `examples/haunted-app` somewhere, `git init` and commit it, run `npm ci`, then
   `Raise the dead: left-pad in /path/to/copy. Use the resurrection skill; do not push.`

You can also install from a registry-style source: add `{ "name": "necromancer", "repo": "https://github.com/tsumita2929/necromancer-crew-app", "branch": "main" }` to
`registries` in your Kiro Crew config; this repository then lists itself in `app-registry.json`.

### Try the MCP server without the dashboard

```bash
npm ci                                    # test and build tooling only; the app itself has no run-time dependencies
node scripts/mcp-call.mjs --list          # starts mcp/launch.py the way the platform does
NECROMANCER_BLOCK_HOSTS=api.github.com \
node scripts/mcp-call.mjs seance '{"ecosystem":"npm","name":"left-pad","path":"'"$PWD"'/examples/haunted-app"}'
```

`NECROMANCER_BLOCK_HOSTS` keeps listed hosts out of reach (the engine then reports the source as unavailable). `NECROMANCER_ENGINE=stub` selects an
offline stub engine with fixtures (used by the tests; every answer says `engine: "stub"`).

## Develop

```bash
npm ci && npm --prefix ui ci
npm run typecheck       # tsc --noEmit
npm test                # Vitest unit and fast-check property tests; offline (recorded responses)
npm run smoke           # starts the MCP server over stdio and calls it
npm run bundle          # rebuilds dist/server.mjs and ui/dist/index.mjs
```

Layout: `app.json` manifest · `agents/` · `skills/` · `mcp/launch.py` (starts the bundle) · `backend/server.py` (stdlib only; serves the Graveyard data,
verifies the gateway's HMAC) · `src/` (tools, Night Watch, store, séance tool) · `ui/` (React page) · `vendor/engine/` (a copy of the engine source) ·
`examples/haunted-app/` (the demo project) · `.kiro/` (specs, hooks, steering).

## The engine

`vendor/engine` is the verdict engine of the main repository (https://github.com/tsumita2929/necromancer, `packages/engine`), copied at export time and bundled into
`dist/server.mjs`, so the installed app needs no `node_modules`. It reads npm, PyPI, deps.dev, OSV, OpenSSF Scorecard and the e18e
module-replacements dataset, scans how a project uses a dependency, and generates the séance. Nothing runs against a private service; no secret is
needed.

## Built with Kiro

* **Spec-driven:** `.kiro/specs/crew-app`, `crew-live`, `crew-seance` (requirements with numbered EARS criteria, design, tasks). Test names cite the
  requirement they check.
* **Hooks:** `.kiro/hooks/crew-*.kiro.hook` keep the manifest's permissions minimal, guard the Night Watch rules, and remind to rebuild the bundles.
* **Steering:** `.kiro/steering/crew-app.md`.
* **Property-based testing:** the verdict-change detector ("never notifies when nothing got worse, always notifies when something did"), the partial-scan
  rule, and the séances themselves.
* **Custom agent, skill and MCP:** see above. The end-to-end runs were driven by fresh agents following the skill, and every skill and tool fix came from
  something those runs got wrong.

## History and provenance

The git history here is the history of the app's directory in the main repository, replayed with the original authors and dates (the first commit is on
2026-11-03, inside the submission period), followed by one commit that adds what a standalone repository needs: the built output, `vendor/engine`,
`examples/haunted-app`, this README, the licence, `.kiro/` and the portable test paths. Dated history of the specs and hooks is in the main repository.
Exported from main-repository commit `765c1edf58` (2026-11-04).

Spec files mention paths such as `apps/crew/src/tools.ts`; the prefix `apps/crew/` is this repository's root.

## Known limits

* The generic séance template (no curated recipe) is a skeleton; the substance is written by the agent and the comparisons stay skipped until it sets `READY`.
* "Never push" is a prompt rule; nothing technical blocks `git push` in the agent's shell.
* Tested on Linux. The code avoids POSIX-only calls (the launcher spawns Node instead of `exec` on Windows), but macOS and Windows runs are untested.
* The live dashboard checks (sidebar entry, schedule registration, agent loading its skill) depend on a Kiro Crew gateway.

## Licence

MIT. See `LICENSE`.
