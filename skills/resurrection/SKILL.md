---
name: resurrection
description: "Raise a project off a dead dependency: write the Kiro spec, write a differential property-based test (old versus new on generated inputs), migrate task by task, and leave the result on a local branch. Never pushes."
---

# Resurrection

Use this when the user asks to raise, replace or migrate off a dead dependency in a
local repository. Night Watch alerts and the Graveyard page's "Raise the dead"
button both lead here.

## Hard rules

- Never push. Never add or change a remote. Never change git configuration.
- Work only on a new local branch `resurrect/<dependency>` (lower case, `/` and
  `@` of scoped names replaced by `-`).
- Stop and ask if the working tree has uncommitted changes.
- Never run code from the dead package's install scripts. Read it as text.
- Never claim the migration is done while the differential test fails.

## Procedure

1. **Check the tree.** Run `git rev-parse --is-inside-work-tree`. If it is not a git
   repository, stop and say so; never run `git init` yourself. Then run
   `git status --porcelain`: it must be empty. If it is not empty, stop before changing
   anything, list the changed paths and ask. Note the current branch; this is the base.
2. **Diagnose.** Call `diagnose` with `{"dependencies":[{"ecosystem":"npm","name":"<name>","spec":"<version the project resolves>"}]}`
   (`successors` and `resurrection_spec` take `ecosystem` and `name` directly). Read the
   resolved version from the lockfile and pass it as `spec`, so advisories are checked
   against the version in use. An `autopsy` of a whole project lists every transitive
   package and can be tens of thousands of characters: save its output to a file and read
   only the dependency you care about (for example with `jq` or `grep`).
   If the verdict is `alive`, say so and stop. Read the evidence and the advisories
   aloud to the user in one short paragraph.
3. **Choose the way out.** Call `successors`. Prefer, in this order:
   - `native`: a built-in platform API (no dependency at all).
   - `package`: a maintained package.
   - `raise`: rebuild the small utility as a modern, dependency-free module the
     project owns, in `src/vendor/<name>` (or the language's equivalent).
   Tell the user which you chose and why. If two are plausible, ask.
   If `successors` is empty, no way out is known: take the `raise` path. Say so, then call
   `resurrection_spec` with `ecosystem` and `name` and no `successor` (or `"raise"`); the
   tool then writes a raise spec. For a `raise` successor the successor name equals the
   dependency name; name the séance `<dependency> vs the owned module`. A `raise` module
   must exist before old-versus-new can run, so add it first, unwired, in the séance commit.
   A `native` successor is rarely a bare drop-in. If the séance (step 6) shows a
   difference the project can observe, put a tiny project-owned wrapper (for example
   `src/pad.js`) in front of the platform call, and say so in `design.md`.
4. **Create the branch.** `git switch -c resurrect/<dependency>`.
5. **Write the Kiro spec.** Call `resurrection_spec` with the chosen successor.
   Write the three files to `.kiro/specs/migrate-off-<dependency>/`:
   `requirements.md`, `design.md`, `tasks.md`. Then read the repository and make
   the spec concrete: list the real files and call sites that use the dependency
   (`grep` for the import and `require` forms). Keep the EARS numbering.
6. **Write the séance** (differential property-based test) *before* migrating:
   - Install nothing new beyond the project's own test tooling. JavaScript and
     TypeScript: `fast-check` with the project's runner. Python: `hypothesis`.
     If the project has none, add it as a dev dependency and say so.
   - The test asks the old and the new implementation the same generated question
     and fails on any difference. Cover only the API surface the project actually
     uses (from step 5), not the whole package.
   - Generate inputs from the real domain of each call site (strings, numbers,
     options objects), including edge cases: empty, very long, unicode, negative,
     `undefined`, `null`. Draw every option exactly as widely as the project lets a
     caller set it. If an option is user-configurable, it is a free string, not a
     single character: a generator that assumes the common case hides the real
     differences (this is how an empty and a multi-character padding fill were found).
   - The failure message must survive the test runner. fast-check keeps the property's
     own message in `error.cause`; some runners (`node:test`) print only
     "Counterexample". Fold `cause.message` into the thrown error so the shrunk input
     and both answers are printed.
   - Match the project's runner (`node:test`, Vitest, Jest, pytest). Under
     `node --test`, every `.js` file under `test/` runs as a test: keep data files as `.json`.
   - Compare results with a deep equality; compare thrown error *kinds*, not
     messages.
   - Name the test `séance: <dependency> vs <successor>` and put it next to the
     project's other tests.
   - Run the old implementation against itself (old vs old) with the same generators.
     It must pass; this proves the harness sound. Then prove it can fail: change the
     replacement on purpose, run, copy the shrunk counterexample, and revert.
7. **Migrate task by task.** For each task in `tasks.md`: change one module, run
   the project's tests and the séance, tick the task, commit with a short
   imperative subject (`Replace left-pad with padStart in src/format.ts`).
   Use the repository's own commit identity. Never change git configuration: if the
   repository has none, pass the identity for one command with
   `git -c user.name=... -c user.email=... commit`, using `Necromancer (agent)` and
   `necromancer@agent.invalid`.
8. **Keep a guard after the old package is gone.** The séance needs the old package
   as its oracle, and step 9 removes it. Before removing it, record the old
   package's answers for a fixed seed as a golden file (JSON) and keep a replay test
   that checks the new code against it. Keep the live old-versus-new comparison, but
   make it skip when the package is absent. Say in the report how to run it again
   (for example `npm install --no-save <old>@<version> && npm test`).
9. **Remove the dead dependency** from the manifest and the lockfile using the
   project's package manager in offline-safe mode where possible. Run everything
   once more.
10. **Report.** Also list stale mentions of the dead dependency you left alone (a README
   line, for example). Give: the branch name, the spec path, the séance result (number of
   generated cases, or the first counterexample), the test suite result, and the
   exact command the user can run to review: `git diff <base>..resurrect/<dependency>`.
   Remind the user that nothing was pushed.

## If the séance fails

Report the first counterexample (the generated input, the old result, the new
result). Do not hide it by weakening the generator. Then handle it explicitly, in one of
two ways: adjust the replacement to match the old behaviour (a wrapper that
normalises the input), or accept the difference and say so. Either way record the
decision in `design.md` under "Known behavioural differences", and keep a test that
asserts the accepted result and that the old package really differs.
When a person is present and the choice changes what users see, ask which way to go and
leave the task unticked until they answer. When the run is unattended, take the
smaller change (accept the successor's behaviour where it keeps the project's own
tests green, otherwise match the old behaviour), record the reasoning, and mark the
difference clearly in the report.

## Shapes of séance, by kind of successor

- **native**: old function vs the platform call, e.g. `leftPad(s, n, c)` vs
  `s.padStart(n, c)` over arbitrary `s` and `n` in `[-5, 200]`, and `c` drawn as widely
  as the project allows (empty, one character, several characters, `null`, a number). A
  one-character `c` alone would pass and hide the real differences.
- **package**: old call vs new call through a thin adapter that lives in the
  test only. Normalise only differences the project does not observe.
- **raise**: old package vs the project-owned module over the same generators.
  The owned module must have no dependency of its own.
