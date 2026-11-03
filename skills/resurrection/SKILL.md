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
2. **Diagnose.** Call the `diagnose` tool with the dependency (ecosystem and name).
   If the verdict is `alive`, say so and stop. Read the evidence and the advisories
   aloud to the user in one short paragraph.
3. **Choose the way out.** Call `successors`. Prefer, in this order:
   - `native`: a built-in platform API (no dependency at all).
   - `package`: a maintained package.
   - `raise`: rebuild the small utility as a modern, dependency-free module the
     project owns, in `src/vendor/<name>` (or the language's equivalent).
   Tell the user which you chose and why. If two are plausible, ask.
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
     `undefined`.
   - Compare results with a deep equality; compare thrown error *kinds*, not
     messages.
   - Name the test `séance: <dependency> vs <successor>` and put it next to the
     project's other tests.
   - Run it against the *old* code twice (old vs old). It must pass; this proves
     the harness itself is sound.
7. **Migrate task by task.** For each task in `tasks.md`: change one module, run
   the project's tests and the séance, tick the task, commit with a short
   imperative subject (`Replace left-pad with padStart in src/format.ts`).
   Use the repository's own commit identity settings; do not change them.
8. **Remove the dead dependency** from the manifest and the lockfile using the
   project's package manager in offline-safe mode where possible. Run everything
   once more.
9. **Report.** Give: the branch name, the spec path, the séance result (number of
   generated cases, or the first counterexample), the test suite result, and the
   exact command the user can run to review: `git diff <base>..resurrect/<dependency>`.
   Remind the user that nothing was pushed.

## If the séance fails

Report the first counterexample (the generated input, the old result, the new
result). Do not hide it by weakening the test. Offer two choices: adjust the
replacement to match the old behaviour, or accept the difference explicitly and
record it in `design.md` under "Known behavioural differences". Leave the task
unticked until the user decides.

## Shapes of séance, by kind of successor

- **native**: old function vs the platform call, e.g. `leftPad(s, n, c)` vs
  `s.padStart(n, c)` over arbitrary `s`, `n` in `[-5, 200]` and one-character `c`.
- **package**: old call vs new call through a thin adapter that lives in the
  test only. Normalise only differences the project does not observe.
- **raise**: old package vs the project-owned module over the same generators.
  The owned module must have no dependency of its own.
