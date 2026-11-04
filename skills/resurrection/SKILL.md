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
- Never migrate a package the registry does not know (`verdict: "not-found"`, `notFound: true`). Tell the person; see step 2.
- Never migrate or raise a living package because its **version** is deprecated or yanked (an `upgrade` entry on an `alive` verdict). Tell the person to upgrade; see step 2.
- Never use a low-confidence way out (`isSuggestion: true`, `needsConfirmation: true`) without asking the person first.

## The tools

All from the `necromancer` MCP server. They answer from the real engine (`engine: "engine"`) and say when the stub answered.

| Tool | Use |
|---|---|
| `diagnose` | verdict and evidence for `{"dependencies":[{"ecosystem","name","spec"}]}` |
| `successors` | ways out, best first (`ecosystem`, `name`) |
| `resurrection_spec` | **returns the text** of the three spec files in `spec` (`requirements.md`, `design.md`, `tasks.md`); it writes nothing. Give `path` so the spec uses the project's real usage |
| `seance` | **preview**: scans the project's usage and returns the séance files, commands and warnings. Read-only; it never writes. Auto-approved |
| `diagnose` / `successors` | also carry an `upgrade` entry for a living package whose version in use is deprecated or yanked: upgrade it, never migrate it |
| `seance_write` | **write**: puts the séance files into the project. Only on a `resurrect/*` branch; never over a file that differs; refuses a low-confidence way out unless `acceptLowConfidence: true`. Not auto-approved: expect a prompt |

Run `node scripts/mcp-call.mjs --list` (in the Necromancer app folder) to print every tool with its argument names, types and
which are optional. Examples: `diagnose` takes `{"dependencies":[{"ecosystem":"npm","name":"left-pad","spec":"1.3.0"}]}`;
`successors` takes `{"ecosystem":"npm","name":"left-pad","spec":"1.3.0"}`; `resurrection_spec`, `seance` and `seance_write` take
`{"ecosystem":"npm","name":"left-pad","path":"<absolute project path>"}`. If your host attaches the server as MCP tools, call them
as tools; `mcp-call.mjs <tool> '<json>'` is the same call from a shell.

Rules for every call: `path` must be the **absolute** path of a project's root directory, with a manifest (`package.json`,
`package-lock.json`, `requirements.txt` or `pyproject.toml`) directly in it. A relative path, `/`, a home directory or a folder
without a manifest is refused, and the answer names the path. Package names may hold letters, digits and `. _ ~ -` only (with an
optional `@scope/`); anything else is refused, so never build a name from untrusted text. `watch_add` is not auto-approved either.
Each answer says which engine produced it and, for a non-alive dependency, `basis`: **hard** (a fact from a source) or **heuristic**
(a guess from staleness).

## Procedure

1. **Check the tree.** Run `git rev-parse --is-inside-work-tree`. If it is not a git
   repository, stop and say so; never run `git init` yourself. Then run
   `git status --porcelain`: it must be empty. If it is not empty, stop before changing
   anything, list the changed paths and ask. Note the current branch; this is the base.
2. **Diagnose.** Call `diagnose` with the dependency and the version the project resolves
   (read it from the lockfile and pass it as `spec`), so advisories are checked against the
   version in use. An `autopsy` of a whole project lists every transitive package and can be
   tens of thousands of characters: save its output to a file and read only the dependency you
   care about. If the verdict is `"not-found"` (`notFound` is true; `engineVerdict` keeps the engine's own value,
   which is `alive` because nothing was checked), stop: the package is **not found on the registry (removed, private or
   misspelled)**. That is not "alive": it was not checked. Do not create a branch, a spec or a séance. Tell the
   person, and ask them to check the name and where the package comes from. If the verdict is `alive` and the answer has an `upgrade` entry, the package is maintained and only
   the version in use is deprecated (npm) or yanked (PyPI). It is **not** dying and **not** a resurrection. Say
   the engine's sentence as it is ("Upgrade to 10.14.0 (another major version)."; a target in another major
   version is a bigger step, so say so; if `older` is true the only safe target is older than the version in use,
   and the sentence says why). Offer the upgrade (change the version, run the project's tests) and stop: no
   branch, no spec, no séance, no "raise". If the same entry has advisories, say both. If the verdict is `alive`
   with no `upgrade` entry, say so and stop. Read the evidence and the
   advisories aloud (the answer lists one entry per vulnerability with its other ids in `also`; say the
   vulnerability once, not once per id; a `moved` note means the repository was renamed or moved, which
   is not an end of life, so follow it and do not call the package abandoned for that) to the user in one short paragraph, and say what the verdict rests on (`basis.label`
   in the `successors` answer). If the basis is **heuristic** (the abandoned rule: an old release or a quiet
   repository), say plainly that it is a guess and not a hard signal, check the evidence dates yourself, and
   when a person is present ask before you migrate. An unattended run may continue but must call the verdict
   "heuristic" in the report.
3. **Choose the way out.** Call `successors` (give `spec`, the version in use, so a deprecated version shows as an upgrade). Prefer, in this order:
   - `native`: a built-in platform API (no dependency at all).
   - `package`: a maintained package.
   - `raise`: rebuild the small utility as a modern, dependency-free module the
     project owns, in `src/vendor/<name>` (or the language's equivalent).
   If `successors` is empty, no way out is known: take the `raise` path and say so. Tell the
   user which you chose and why. If two are plausible, ask.
   A way out with `isSuggestion: true` is **low confidence**: a plausible fit with a different API or scope,
   not a drop-in. Never apply it unasked. When a person is present, show it as a suggestion, say how it
   differs, and ask whether to use it, to choose another, or to raise the utility instead. If every way out
   is low confidence, say that, and ask. An unattended run does not use one: it stops and reports the
   suggestions. Only after the person agrees pass `acceptLowConfidence: true` to `seance_write`.
4. **Scan before you branch.** Call `seance` (the preview; it changes nothing) and read
   `usage.warnings` (see "Warnings"). If one says to stop, stop here: no branch, no files. Otherwise
   create the branch: `git switch -c resurrect/<dependency>`.
5. **Write the Kiro spec.** Call `resurrection_spec` with `ecosystem`, `name`, the chosen `successor` and `path`
   (the project directory). It **returns text and writes no file**: the answer's `spec` object holds the three files
   as strings, keyed `requirements.md`, `design.md`, `tasks.md`. Write each one, unchanged to begin with, to
   `.kiro/specs/migrate-off-<dependency>/<file>` (with a file tool, not by retyping from memory). Then make the spec
   concrete: list the real files and call sites that use the dependency (the answer's `usage` shows what the scan
   saw; its `warnings` are explained under "Warnings" below). Keep the EARS numbering. Commit it:
   `Add migration spec for <dependency>`.
6. **Run the generated séance first.** Call `seance_write` with `ecosystem`, `name`, `path`
   (and `acceptLowConfidence: true` only if the person agreed). You are on the `resurrect/<dependency>` branch by now. Read the answer before anything else:
   - `usage.warnings`: act on each one (see "Warnings").
   - `template`: `curated` means the engine has a tested recipe for this pair; `generic` means it
     does not, and `comparisonsSkipped` is true (see "Generic template").
   - `versions` (and `versionNotTested`): which versions of the old package this séance was run against, and
     whether the version in use is one of them. If `versionNotTested` is true, **tell the person** in one
     sentence (use `versions.note`): the séance may fail, or pass, for reasons that are not the replacement's
     on that version, so read it before you trust it. If `versions.doesNotFit` names the version in use, the
     séance was run on it and did not fit; say why. In an unattended run, put the same sentence in the report.
     The generic template was run against no version; say that too.
   - `knownDifferences`: what the old package, the naive swap and the generated replacement each
     answer. Read them to the user in one short paragraph: they are why a plain swap is unsafe. (The
     text may show one space where the real answer is several: trust the test, not the prose.)
   - The séance file has a `projectCalls` list built from the scan. The scan only keeps calls whose
     arguments are literals, so it can be empty even when the scan counted calls. For each call site
     whose arguments you can state with certainty (read the call, and the project's tests for the values),
     add one argument list by hand and say so. If the arguments come from user input or are built at run
     time, leave the list empty and say in the report that the project's own calls are not replayed.
   Then:
   1. Run each command in `install` (it adds the test tooling as dev dependencies; say so in the
      report) and then `run`. Copy the result line (tests passed, runs). Read the answer's `notes`: the
      generated JavaScript séance runs under Vitest, which needs a recent Node. If the project's own test
      script is `node --test`, it would pick up the Vitest file and fail; change the project's script to
      name its own files (for example `"test": "node --test test/*.test.js"`; `node --test test/` fails on
      Node 22) and add `"seance": "vitest run seance"` (this is the only script you add; step 8 does not add another).
      Say both changes in the report. If `npm install` prints an audit line ("5 vulnerabilities"), copy it into the
      report as it is. Do not run `npm audit fix`, and do not change `engines` in `package.json` (Vitest needs Node
      22.12 or newer; say so if the project allows older Node).
   2. Commit the generated files on the branch: `Add séance for <dependency>`.
   3. **Prove it can fail.** Replace the body of the function in the generated `seance/<name>/replacement.mjs` with the naive
      swap the bundle describes (for example `String(str).padStart(len, ch)`), run again, and copy the
      shrunk counterexample that the séance prints. Then restore the file with
      `git checkout -- <file>` and run once more to see it pass. The counterexample is the evidence
      for the user that the plain swap would have changed behaviour.
   Do not write a comparison by hand where the bundle already has one.
7. **Decide, then migrate.** The bundle's replacement keeps the old package's answers. You may adopt
   it, or accept the successor's behaviour for a listed difference, but then say so explicitly:
   record the decision in `design.md` under "Known behavioural differences" and keep a test that
   asserts the accepted result and that the old package really differs. When a person is present
   and the choice changes what users see, ask. When the run is unattended there is no one to ask:
   adopt the replacement that keeps the old answers unless the project's own tests need the successor's,
   and put the question you would have asked in the report.
   - **Adopting the project-owned replacement changes the generated spec.** The spec for a native or package
     successor says (usually in R3.1) that the code SHALL call the successor (for example
     `String.prototype.padStart`). If you adopt the replacement instead, edit that requirement to say that the code calls the
     project-owned module (`src/vendor/<name>.js`), and add a paragraph "Departure from the generated spec" to `design.md`
     that names the requirement, what it said, what you did instead, and why (the séance's `knownDifferences`). A spec
     that contradicts the code is a defect. A native migration still puts its module in `src/vendor/<name>` when you adopt the replacement.
   - Put the replacement where the project's code can import it (`src/vendor/<name>.js` or the language's equivalent) and
     make the séance test **that** file. The only edits you may make to `seance/<name>/seance.test.mjs` are:
     (a) the `import` lines of the old package and of the replacement, and (b) the line that opens the main `describe`,
     when step 8 makes it skip. Never touch the generators, the comparisons, `numRuns` or the `projectCalls`
     (except to add examples, step 6). The bundle's `replacement.mjs` exports a named function
     (`export function leftPad`). Match the project's module system:
       - ES module project (`"type": "module"`): write `export function leftPad(...)` in `src/vendor/<name>.js`; the
         séance import line becomes `import { leftPad } from '../../src/vendor/<name>.js';`
       - CommonJS project: write `module.exports = leftPad; module.exports.leftPad = leftPad;` in `src/vendor/<name>.js`.
         A default import of a CommonJS file gives `module.exports`, which is the **function**, not an object with
         `leftPad`. So the one import line `import { leftPad } from './replacement.mjs';` becomes two lines:
         `import mod from '../../src/vendor/<name>.js';` and `const leftPad = mod.leftPad;`
     Then delete the stale `seance/<name>/replacement.mjs` (`git rm`) and fix the one sentence of
     `seance/<name>/README.md` that names it. The generated spec may name a `.ts` path; use the project's own
     language and say so in `design.md`.
   - For each task in `tasks.md`: change one module, run the project's tests and the séance, tick the
     task, commit with a short imperative subject (`Replace left-pad with leftPad in src/receipt.js`).
     Tasks that change no source (the spec, notes, ticking boxes) get a small commit of their own. Use the
     repository's own commit identity. Never change git configuration: if the repository has
     none, pass the identity for one command with `git -c user.name=... -c user.email=... commit`,
     using `Necromancer (agent)` and `necromancer@agent.invalid`.
8. **Keep a guard after the old package is gone.** The séance needs the old package as its oracle, and
   step 9 removes it. Before removing it, record the old package's answers for a fixed seed as a golden
   file and keep a replay test that checks the new code against it. This guard is written by hand;
   say so. It is three small files next to the séance in `seance/<name>/`, and none of them edits the séance's
   comparisons (templates in "Golden guard templates" at the end):
   - `codec.mjs`: turns `undefined`, `NaN`, `-0`, `Infinity` and holes into JSON and back.
   - `record.mjs`: **copies** the séance's generators (the `const` blocks between the line `// Generators` and the
     `projectCalls` line of `seance.test.mjs`, word for word, with a comment "copied from seance.test.mjs; keep in sync")
     and writes `golden.json` for a fixed seed (a few thousand cases; keep the file under 1 MB). It needs the old
     package: `npm install --no-save <old>@<version> && node seance/<name>/record.mjs`. Do not move the generators out
     of the séance and do not import them from it (importing a test file runs its tests).
   - `golden.test.mjs`: replays `golden.json` against the project-owned module. It works without the old package.
   Then make the live comparison skip when the old package is absent (the one allowed edit (b) of step 7): load the old
   package with a top-level `const old = await import('<old>').then((m) => m.default ?? m, () => null);` and open the
   main `describe` as `describe.skipIf(!old)(...)`. Do not add a second `package.json` script (step 6 added `seance`).
   Say in the report how to run the live comparison again (for example
   `npm install --no-save <old>@<version> && npm run seance`) and what the skipped count means.
9. **Remove the dead dependency** from the manifest and the lockfile using the project's package manager
   in offline-safe mode where possible. Run the project's tests and the séance once more.
10. **Report.** Give: the verdict and its basis (hard signal or heuristic), the branch name, the spec path, the séance result (runs, or the first
    counterexample), the mutant that failed and its counterexample, the project's test result, which
    comparisons you wrote by hand and why, and stale mentions of the dead dependency you left alone (a
    README line, for example). Give the review command `git diff <base>..resurrect/<dependency>`.
    Remind the user that nothing was pushed.

## Who "the person" is

A **person present** means someone is in the conversation and can answer now: ask. In an **unattended** run (Night
Watch, a scheduled task, a draft opened from the Graveyard page that nobody is watching) there is no one to ask: take
the conservative choice, stop where the rules say to stop, and write each question you would have asked into the
report, under a heading "Needs a person".

## Warnings from the scan (`usage.warnings`)

| Warning | What to do |
|---|---|
| `notUsed`: no file imports the dependency at run time | Look for a use the scan cannot see (a plugin loaded by name, a script, a config file). If there is none, stop before the branch: tell the user the dependency is unused, that removing it (`npm uninstall <name>`) is the fix, and that you did not remove it. Even when the user asked for a spec and a test, there is nothing to compare; say so. |
| `onlyInTests`: imported only in test files | Production code does not use it. Tell the user; you may migrate the tests (a small commit on the branch with the spec) or recommend removing the dependency, then stop. Do not invent a production migration. Say that you can generate the séance anyway if the user wants it. |
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

Report the first counterexample (the generated input, the old result, the new result). In a failure line
`expected A to deeply equal B`, **A is the replacement's (new) outcome and B is the old package's**, because the
comparison is `expect(outcome(replacement)).toEqual(outcome(old))`. Name them so in the report. Do not hide it by weakening
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

## Golden guard templates (step 8)

Replace `left-pad`, the argument arity and the import of the old package with the dependency in hand. Keep the names.

`seance/<name>/codec.mjs`:

```js
// JSON codec for values JSON cannot hold: undefined, NaN, -0, Infinity, -Infinity, holes.
export function encode(v) {
  if (v === undefined) return { $: 'undefined' };
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $: 'NaN' };
    if (v === Infinity) return { $: 'Infinity' };
    if (v === -Infinity) return { $: '-Infinity' };
    if (Object.is(v, -0)) return { $: '-0' };
    return v;
  }
  if (Array.isArray(v)) return Array.from({ length: v.length }, (_, i) => (i in v ? encode(v[i]) : { $: 'hole' }));
  if (v && typeof v === 'object') return { $obj: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) };
  return v;
}
export function decode(v) {
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    v.forEach((x, i) => { if (!(x && x.$ === 'hole')) out[i] = decode(x); });
    return out;
  }
  if (v && typeof v === 'object') {
    if ('$obj' in v) return Object.fromEntries(Object.entries(v.$obj).map(([k, x]) => [k, decode(x)]));
    switch (v.$) {
      case 'undefined': return undefined;
      case 'NaN': return NaN;
      case 'Infinity': return Infinity;
      case '-Infinity': return -Infinity;
      case '-0': return -0;
    }
  }
  return v;
}
```

`seance/<name>/record.mjs` (run once, with the old package installed):

```js
// Records the old package's answers for a fixed seed into golden.json.
//   npm install --no-save left-pad@1.3.0 && node seance/left-pad/record.mjs
import fs from 'node:fs';
import fc from 'fast-check';
import leftPadOld from 'left-pad';
import { encode } from './codec.mjs';

// ---- copied from seance.test.mjs; keep in sync (generators and the known-bug filter, word for word) ----
const str = fc.string({ maxLength: 8 }); // replace with the séance's own definitions
const len = fc.integer({ min: -5, max: 40 });
const fill = fc.oneof(fc.constant(undefined), fc.string({ maxLength: 3 }));
const oldBug = () => false;
// ---------------------------------------------------------------------------------------------------------

const SEED = 20261104;
const outcome = (args) => {
  try { return { ok: true, value: leftPadOld(...args) }; }
  catch (e) { return { ok: false, error: e && e.constructor ? e.constructor.name : typeof e }; }
};
const known = [['abc', 6, ''], ['abc', 6, 'xy']]; // inputs the report named
const cases = [...known, ...fc.sample(fc.tuple(str, len, fill), { seed: SEED, numRuns: 3000 })].filter((a) => !oldBug(...a));
const version = JSON.parse(fs.readFileSync(new URL('../../node_modules/left-pad/package.json', import.meta.url), 'utf8')).version;
const rows = cases.map((args) => JSON.stringify({ args: encode(args), result: encode(outcome(args)) }));
fs.writeFileSync(new URL('./golden.json', import.meta.url), `{"package":"left-pad","version":"${version}","seed":${SEED},"cases":[\n${rows.join(',\n')}\n]}\n`);
console.log('recorded', rows.length, 'cases from left-pad', version);
```

`seance/<name>/golden.test.mjs` (the guard that stays; it never needs the old package):

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import mod from '../../src/vendor/left-pad.js'; // ES module project: import { leftPad } from ...
import { decode, encode } from './codec.mjs';

const leftPad = mod.leftPad;
const golden = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const outcome = (args) => {
  try { return { ok: true, value: leftPad(...args) }; }
  catch (e) { return { ok: false, error: e && e.constructor ? e.constructor.name : typeof e }; }
};

describe(`golden replay: ${golden.package} ${golden.version}, seed ${golden.seed}`, () => {
  it('holds a useful number of cases', () => expect(golden.cases.length).toBeGreaterThan(1000));
  it('the replacement gives the recorded answer for every case', () => {
    for (const c of golden.cases) expect(encode(outcome(decode(c.args))), JSON.stringify(c.args)).toEqual(c.result);
  });
});
```

If the séance filters a known old-package bug with `oldBug`, pin the replacement's chosen answer for that input in
`golden.test.mjs` by hand (one `it`), and say so in `design.md`.
