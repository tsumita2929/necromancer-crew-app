---
name: resurrection
description: "Raise a project off a dead dependency: write the Kiro spec, run the generated séance (a differential property-based test, old versus new on generated inputs), migrate task by task, and leave the result on a local branch. Never pushes."
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
- Never claim the migration is done while the séance fails.

## The tools

All from the `necromancer` MCP server. They answer from the real engine (`engine: "engine"`) and say when the stub answered.

| Tool | Use |
|---|---|
| `diagnose` | verdict and evidence for `{"dependencies":[{"ecosystem","name","spec"}]}` |
| `successors` | ways out, best first (`ecosystem`, `name`) |
| `resurrection_spec` | the three spec files; give `path` so the spec uses the project's real usage |
| `seance` | scans the project's usage, generates the séance, and with `write: true` writes it into the project. Only on a `resurrect/*` branch; never over a file that differs |

## Procedure

1. **Check the tree.** Run `git rev-parse --is-inside-work-tree`. If it is not a git
   repository, stop and say so; never run `git init` yourself. Then run
   `git status --porcelain`: it must be empty. If it is not empty, stop before changing
   anything, list the changed paths and ask. Note the current branch; this is the base.
2. **Diagnose.** Call `diagnose` with the dependency and the version the project resolves
   (read it from the lockfile and pass it as `spec`), so advisories are checked against the
   version in use. An `autopsy` of a whole project lists every transitive package and can be
   tens of thousands of characters: save its output to a file and read only the dependency you
   care about. If the verdict is `alive`, say so and stop. Read the evidence and the
   advisories aloud to the user in one short paragraph.
3. **Choose the way out.** Call `successors`. Prefer, in this order:
   - `native`: a built-in platform API (no dependency at all).
   - `package`: a maintained package.
   - `raise`: rebuild the small utility as a modern, dependency-free module the
     project owns, in `src/vendor/<name>` (or the language's equivalent).
   If `successors` is empty, no way out is known: take the `raise` path and say so. Tell the
   user which you chose and why. If two are plausible, ask.
4. **Create the branch.** `git switch -c resurrect/<dependency>`.
5. **Write the Kiro spec.** Call `resurrection_spec` with the chosen successor and `path`
   (the project directory). Write the three files to `.kiro/specs/migrate-off-<dependency>/`:
   `requirements.md`, `design.md`, `tasks.md`. Then make the spec concrete: list the real files
   and call sites that use the dependency. Keep the EARS numbering. The answer's `usage`
   shows what the scan saw; its `warnings` are explained under "Warnings" below.
6. **Run the generated séance first.** Call `seance` with `ecosystem`, `name`, `path` and
   `write: true`. Read the answer before anything else:
   - `usage.warnings`: act on each one (see "Warnings").
   - `template`: `curated` means the engine has a tested recipe for this pair; `generic` means it
     does not, and `comparisonsSkipped` is true (see "Generic template").
   - `knownDifferences`: what the old package, the naive swap and the generated replacement each
     answer. Read them to the user in one short paragraph: they are why a plain swap is unsafe.
   Then:
   1. Run each command in `install` (it adds the test tooling as dev dependencies; say so in the
      report) and then `run`. Copy the result line (tests passed, runs).
   2. Commit the generated files on the branch: `Add séance for <dependency>`.
   3. **Prove it can fail.** Replace the body of the generated `replacement` file with the naive
      swap the bundle describes (for example `String(str).padStart(len, ch)`), run again, and copy the
      shrunk counterexample that the séance prints. Then restore the file with
      `git checkout -- <file>` and run once more to see it pass. The counterexample is the evidence
      for the user that the plain swap would have changed behaviour.
   Do not write a comparison by hand where the bundle already has one.
7. **Decide, then migrate.** The bundle's replacement keeps the old package's answers. You may adopt
   it, or accept the successor's behaviour for a listed difference, but then say so explicitly:
   record the decision in `design.md` under "Known behavioural differences" and keep a test that
   asserts the accepted result and that the old package really differs. When a person is present
   and the choice changes what users see, ask. When the run is unattended, adopt the replacement
   that keeps the old answers unless the project's own tests need the successor's.
   - Put the replacement where the project's code can import it (`src/vendor/<name>.js` or the
     language's equivalent, converted to the project's module format) and make the séance test **that**
     file: change only the import line of the replacement in the séance. Never edit its comparisons.
   - For each task in `tasks.md`: change one module, run the project's tests and the séance, tick the
     task, commit with a short imperative subject (`Replace left-pad with leftPad in src/receipt.js`).
     Use the repository's own commit identity. Never change git configuration: if the repository has
     none, pass the identity for one command with `git -c user.name=... -c user.email=... commit`,
     using `Necromancer (agent)` and `necromancer@agent.invalid`.
8. **Keep a guard after the old package is gone.** The séance needs the old package as its oracle, and
   step 9 removes it. Before removing it, record the old package's answers for a fixed seed as a golden
   file (JSON; use a codec for `undefined`, `NaN`, `-0`) and keep a replay test that checks the new code
   against it. Keep the live old-versus-new comparison, but make it skip when the package is absent. Add
   a `package.json` script for the séance (for example `"seance": "vitest run seance"`) next to the
   project's own test script, since the project's runner may not pick up the Vitest file. Say in the
   report how to run the live comparison again (for example
   `npm install --no-save <old>@<version> && npm run seance`).
9. **Remove the dead dependency** from the manifest and the lockfile using the project's package manager
   in offline-safe mode where possible. Run the project's tests and the séance once more.
10. **Report.** Give: the branch name, the spec path, the séance result (runs, or the first
    counterexample), the mutant that failed and its counterexample, the project's test result, which
    comparisons you wrote by hand and why, and stale mentions of the dead dependency you left alone (a
    README line, for example). Give the review command `git diff <base>..resurrect/<dependency>`.
    Remind the user that nothing was pushed.

## Warnings from the scan (`usage.warnings`)

| Warning | What to do |
|---|---|
| `notUsed`: no file imports the dependency at run time | Look for a use the scan cannot see (a plugin loaded by name, a script, a config file). If there is none, tell the user the dependency is unused and that removing it is the fix; stop before migrating. |
| `onlyInTests`: imported only in test files | Production code does not use it. Tell the user; migrate the tests or remove the dependency, then stop. Do not invent a production migration. |
| `neverCalled`: imported, no call | There is nothing to compare. Say so and ask. |
| `unreadable`: files could not be read | The calls in them are not in the séance's examples. Open each file by hand, list the calls, and add them as examples to the séance (the `projectCalls` list). |
| computed dynamic imports | Look at them by hand and say which dependency they load. |

## Generic template (`template: "generic"`)

No curated recipe exists, so the bundle is a skeleton: the old package, a replacement module, one generator per used
member, the project's own calls as examples. Its comparisons are **skipped** until the replacement module sets
`READY`. This is where you write by hand, and only here:

1. Write the replacement (or choose the successor package and wrap it in the replacement module).
2. Replace each `TODO(necromancer)` marker: the generator for the real argument type, the normalisation of results.
   Draw every option as widely as the project lets a caller set it (a free string, not one character).
3. Set `READY` and run. Run old versus old first with the same generators; it must pass.
4. Prove it can fail with a deliberately wrong replacement, as in step 6.
5. Treat each counterexample as a real difference (see "If the séance fails"). Say in the report that the comparison
   was written by hand, and list what it does not cover.

## If the séance fails

Report the first counterexample (the generated input, the old result, the new result). Do not hide it by weakening
the generator. Then handle it explicitly, in one of two ways: adjust the replacement to match the old behaviour (a
wrapper that normalises the input), or accept the difference and say so. Either way record the decision in `design.md`
under "Known behavioural differences". Under `node --test` every `.js` file under `test/` runs as a test: keep data files
`.json`. Make the failure message survive the runner: fast-check keeps the property's own message in `error.cause`; some
runners print only "Counterexample", so fold `cause.message` into the thrown error.

## Shapes of séance, by kind of successor

- **native**: old function vs the platform call, over arguments drawn as widely as the project allows. A narrow generator
  (one-character fill) would pass and hide the real differences. A native call is rarely a bare drop-in: put a tiny
  project-owned wrapper in front of it when the séance shows a difference.
- **package**: old call vs new call through a thin adapter that lives in the test only. Normalise only differences the
  project does not observe.
- **raise**: old package vs the project-owned module over the same generators. The owned module has no dependency of its
  own. The module must exist before old-versus-new can run, so add it, unwired, in the séance commit.
