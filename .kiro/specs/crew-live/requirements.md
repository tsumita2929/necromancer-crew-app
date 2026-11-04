# Requirements: Crew app on the real engine, and one end-to-end resurrection

Round 2 of the Kiro Crew app (`apps/crew`). Round 1 (`.kiro/specs/crew-app/`) built the
app on a stub engine. This round makes the real engine the default and proves the
whole chain on a believable project: the demo video ends on this run.

Vocabulary: the *engine* is `packages/engine`. The *haunted app* is `demo/haunted-app`,
a small Node project that really uses dead dependencies. A *séance* is a differential
property-based test: the dead package and its replacement get the same generated inputs
and must agree. A *copy* is a throwaway git repository made from the haunted app in the
scratch space.

## R1. Real engine by default

**User story:** As a developer, I want the tools to answer from the real engine, so that
verdicts are evidence and not fixtures.

1. THE MCP server SHALL answer `autopsy`, `diagnose`, `successors` and `resurrection_spec`
   from the real engine unless the environment says `NECROMANCER_ENGINE=stub`.
2. EVERY tool answer and every Night Watch result SHALL carry `engine: "engine"` or
   `engine: "stub"`, naming the implementation that produced it.
3. IF the real engine cannot be created THEN the server SHALL fall back to the stub, SHALL say
   `engine: "stub"` and SHALL include a `note` that names the cause.
4. THE installed app SHALL contain the engine in its own bundle, so that it needs no
   `node_modules` next to it.
5. THE tests SHALL NOT use the network: they inject recorded responses or the stub.
6. FOR the haunted app, THE verdicts SHALL equal the verdicts the engine's own tests record
   for the same packages and versions.

## R2. Haunted app

**User story:** As a viewer of the demo, I want a project that looks like real work and is
really haunted, so that the resurrection is believable.

1. THE haunted app SHALL be a small Node project that uses `left-pad` and `request`
   in ways a real project would, and SHALL say in its README that it is haunted on purpose.
2. THE haunted app SHALL have its own tests, and they SHALL pass before any migration.
3. THE haunted app SHALL carry a lockfile, so the engine sees resolved versions.
4. THE haunted app SHALL NOT be a git repository inside the Necromancer repository's history
   of branches: all migration work happens in a copy.

## R3. End-to-end resurrection

**User story:** As a developer, I want to hand a dead dependency to the Necromancer and
get back a reviewed-ready local branch.

1. THE run SHALL follow the Necromancer agent prompt and the resurrection skill as written.
2. THE run SHALL go: autopsy, pick a dead dependency, `successors`, `resurrection_spec`, write
   `.kiro/specs/<name>/` in the copy, write the séance, migrate task by task, run the project
   tests and the séance, commit on a local branch `resurrect/<dependency>`.
3. THE final branch SHALL NOT contain the dead dependency in its manifest or lockfile, and
   SHALL contain the spec and the séance.
4. THE séance SHALL cover the API surface the project actually uses, and SHALL be run against
   old-versus-old first to prove the harness sound.
5. IF the séance finds a difference between the dead package and its successor THEN the run
   SHALL record the shrunk counterexample, and the migration SHALL handle it explicitly
   (change the replacement, or narrow and document the contract) and record the decision in
   `design.md` under "Known behavioural differences".
6. THE séance SHALL be able to fail: a deliberately wrong replacement SHALL make it fail with
   a shrunk counterexample.
7. THE run SHALL NOT push, add a remote, or touch the Necromancer repository's history.

## R4. Night Watch on the real engine

1. WHEN Night Watch runs on the real engine against recorded responses THEN the first scan
   SHALL be a baseline with no notification.
2. WHEN a dependency then gets worse in the recorded responses THEN the next scan SHALL give
   exactly one notification, and the scan after that SHALL give none.

## R5. Nearby inputs

1. WHEN a dependency has no known successor THEN `successors` SHALL say so and the skill SHALL
   take the raise path (rebuild as project-owned code).
2. WHEN `resurrection_spec` is given a successor the diagnosis does not list THEN it SHALL refuse
   and name the valid successors.
3. WHEN the copy has uncommitted changes THEN the agent SHALL stop before changing anything and
   say so; the changes SHALL be untouched afterwards.
4. WHEN the directory is not a git repository THEN the agent SHALL stop and say so, and SHALL NOT
   run `git init` on its own.
5. WHEN the engine fails to load THEN the app SHALL fall back to the stub, labelled (R1.3).
