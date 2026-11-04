# Requirements: Necromancer Kiro Crew app

The Kiro Crew app (`apps/crew`) keeps watch over the dependencies of the user's
projects, wakes the user when one gets worse, and prepares the migration.
It is the "Best Kiro Crew App" entry, so every requirement below names something a
Kiro Crew user can see, use or schedule.

Vocabulary: a *verdict* is one of `alive < dying < dead < ghost < zombie`
(`packages/engine/src/types.ts`). A *watched project* is a local directory the
user asked Night Watch to keep checking. A *snapshot* is the last verdict stored for
each dependency of a watched project.

## R1. Install and load

**User story:** As a Kiro Crew owner, I want to install the app and see exactly what
it asks for, so that I can decide whether to trust it.

1. WHEN the owner runs `kirocrew app install <absolute path>` THEN the system SHALL
   accept the manifest without validation errors.
2. THE manifest SHALL declare only the permissions the app uses: `api` paths for
   its own backend, the `notification` event, `mcpTools` for notification delivery,
   and `cron`. It SHALL NOT declare `network`, `spawn`, `sessionApproval`,
   `memory` or `storage`.
3. WHILE the app is not trusted by the owner, THE app SHALL stay disabled, and
   no part of the app SHALL change the trust settings itself.
4. WHEN the owner has trusted and enabled the app THEN the sidebar SHALL show a
   "Graveyard" entry that opens the page.
5. WHEN the Necromancer agent starts THEN it SHALL have the `resurrection` skill and
   the app's MCP server available.

## R2. Graveyard page

**User story:** As a developer, I want to see my watched projects and their dead
dependencies as a graveyard, so that I know where the risk is without reading JSON.

1. WHEN the page opens THEN it SHALL list every watched project with a count per
   verdict.
2. WHEN a project is expanded THEN the page SHALL list its non-alive dependencies,
   worst first, each with its verdict, its epitaph (the highest-priority evidence
   message) and its best successor.
3. WHERE a verdict is shown THEN the page SHALL show it as text and a symbol as well
   as colour, so that colour is never the only carrier.
4. WHEN no project is watched THEN the page SHALL say so and show how to add one,
   and SHALL show the demo graveyard so the layout can be seen.
5. WHEN the backend is unreachable THEN the page SHALL show an error notice and the
   demo graveyard, and SHALL NOT present demo data as the user's data (the demo is
   labelled).
6. WHEN the user presses "Raise the dead" on a dependency THEN the page SHALL open a
   chat with the Necromancer agent, with a draft message naming the project and the
   dependency, unsent.
7. THE page SHALL be operable by keyboard alone and SHALL honour
   `prefers-reduced-motion`.

## R3. Watchlist

**User story:** As a developer, I want to tell Night Watch which projects to
keep an eye on, and to stop.

1. WHEN `watch_add` is called with an existing directory THEN the system SHALL store
   it once, keyed by its resolved absolute path, and return its id.
2. WHEN `watch_add` is called with a path that does not exist or is not a directory
   THEN the system SHALL refuse with a clear message and store nothing.
3. WHEN `watch_add` is called twice for the same path THEN the watchlist SHALL hold
   one entry.
4. WHEN `watch_remove` is called THEN the project and its snapshot SHALL be deleted;
   an unknown id SHALL give a clear "not watched" message, not an error.
5. THE watchlist SHALL survive a restart: it is stored as JSON under the app's data
   directory and written atomically.
6. IF the stored file is unreadable or corrupt THEN the system SHALL keep the broken
   file aside, start with an empty watchlist and say so.

## R4. Night Watch

**User story:** As a developer, I want to be woken only when something got worse,
so that I trust the alert when it arrives.

1. WHEN Night Watch runs THEN it SHALL re-scan every watched project and compare each
   dependency's new verdict with its snapshot.
2. IF no dependency's verdict is worse than its snapshot THEN the system SHALL
   produce no notification.
3. IF at least one dependency's verdict is worse than its snapshot THEN the system
   SHALL produce exactly one notification per worsened dependency, naming the
   project, the dependency, the old and new verdict and the first evidence line.
4. THE comparison SHALL use the order `alive < dying < dead < ghost < zombie`.
   Equal or better verdicts SHALL never notify.
5. WHEN a project is scanned for the first time THEN Night Watch SHALL store the
   snapshot as a baseline and SHALL NOT notify.
6. WHEN a dependency is new since the last snapshot THEN it SHALL be compared with
   `alive`.
7. WHEN a notification has been produced for a verdict THEN the snapshot SHALL be
   updated to it, so that the next run with the same verdict is silent.
8. IF a scan reports an unavailable source THEN Night Watch SHALL NOT lower any
   stored verdict because of that scan (missing evidence is not recovery), and SHALL
   list the unavailable sources in its result.
9. IF a watched project's path no longer exists THEN Night Watch SHALL skip it,
   keep its snapshot, report it in the result, and produce one "project missing"
   notification on the first run it is missing, not on every run.
10. IF one project fails to scan THEN the others SHALL still be scanned and the
    failure SHALL appear in the result.
11. IF the watchlist is empty THEN the run SHALL return an empty result and no
    notification.
12. THE job SHALL be declared in the manifest with a daily default schedule, a
    time zone, `silent: true` and no persistent session.

## R5. MCP server

**User story:** As an agent, I want the engine's tools over MCP, so that I can
diagnose and plan with the same code the web app uses.

1. THE MCP server SHALL list the tools `autopsy`, `diagnose`, `successors`,
   `resurrection_spec`, `watch_add`, `watch_list`, `watch_remove`, `nightwatch_run`
   and `graveyard`, each with a description and a JSON schema.
2. WHEN `autopsy`, `diagnose`, `successors` or `resurrection_spec` is called THEN the
   server SHALL answer through the `Engine` interface of the shared contract.
3. WHILE the real engine is not available THEN the server SHALL answer from a stub
   that returns fixtures behind the same interface, and every answer SHALL say which
   engine produced it (`engine: "stub"`).
4. IF a tool receives invalid input THEN the server SHALL return a tool error with a
   message, not crash and not return partial data.
5. WHEN `resurrection_spec` names a successor the diagnosis does not list THEN the
   server SHALL refuse with the list of valid successors.
6. THE server SHALL read local files only inside a path the caller names, SHALL read
   only the four manifest kinds, and SHALL NOT write outside the app's data directory.

## R6. Necromancer agent and resurrection skill

**User story:** As a developer, I want the agent to prepare the migration off a dead
dependency on a local branch, so that I review a diff instead of doing the work.

1. WHEN the agent is asked to raise a dependency in a local repository THEN it SHALL
   first call `diagnose`, and SHALL confirm the dependency is not alive.
2. THE agent SHALL write the Kiro spec (`requirements.md`, `design.md`, `tasks.md`)
   under `.kiro/specs/` of that repository from `resurrection_spec`.
3. THE agent SHALL write a differential property-based test that runs the old and
   the new implementation on the same generated inputs and fails on any difference,
   over the API surface the project uses.
4. THE agent SHALL perform the migration task by task, run the project's tests, and
   commit on a new local branch named `resurrect/<dependency>`.
5. THE agent SHALL NEVER push, add a remote, change git configuration, or touch a
   branch other than the one it created.
6. IF the working tree has uncommitted changes THEN the agent SHALL stop and ask.
7. IF the differential test fails THEN the agent SHALL report the first
   counterexample and SHALL NOT mark the migration done.

## R7. Safety and privacy

1. THE app SHALL make no network request itself (`permissions.network` is absent);
   the real engine's reads of public data are made by the engine, behind the
   injected `fetch`.
2. THE app SHALL contain no secret, and SHALL NOT write any credential.
3. THE only side effects of Night Watch SHALL be the snapshot file and notifications.

## Round 4b amendments (final engine)

- R9.1 WHEN the engine reports `notFound`, THE tools, the Graveyard page and Night Watch SHALL say "not found on the registry (removed, private or misspelled)", SHALL NOT count the package as alive, and the migration tools SHALL refuse it and tell the agent to tell the person.
- R9.2 WHEN a way out has `confidence: low`, THE tools and the page SHALL show it as a suggestion, and `seance_write` SHALL refuse it unless `acceptLowConfidence` is true. The agent SHALL ask the person first.
- R9.3 THE tools and the page SHALL show one id per vulnerability with its other ids (`advisoryAliases`).
- R9.4 WHEN the engine finds the evidence `repo-moved`, THE tools and the page SHALL show it as a note, not as an end of life.
- R9.5 THE `seance` tool SHALL be a read-only preview that never writes and is auto-approved. THE `seance_write` tool SHALL write only on a `resurrect/<dependency>` branch, SHALL NOT be auto-approved, and SHALL keep every write guard.

## Round 4c amendments (upgrade notice, séance versions)

- R10.1 WHEN the engine gives an alive verdict with the evidence `version-deprecated` or `version-yanked`, THE tools, the Graveyard page and Night Watch SHALL show "Upgrade to <version>" (with "another major version" when `sameMajor` is false, and the engine's sentence when `older` is true), SHALL NOT show it as dying, and SHALL NOT offer to migrate it. THE migration tools SHALL refuse it and say to upgrade.
- R10.2 WHEN a version becomes deprecated or yanked, Night Watch SHALL send one `upgrade` notification, and none for a notice that was already known, for a baseline run, or after a partial scan.
- R10.3 THE `seance` and `seance_write` answers SHALL carry the bundle's `oldVersions` as `versions`, and `versionNotTested` SHALL be true unless the version in use is covered. THE agent SHALL tell the person when it is true.

## Round 5 amendments (QA round 4)

- R11.1 WHEN the engine reports `notFound`, EVERY tool answer SHALL give the verdict `"not-found"` (never `"alive"`), SHALL keep the engine's value under `engineVerdict`, and SHALL NOT count the package as alive in a summary; so a client that reads only `verdict` is never told such a package is alive.
- R11.2 THE `resurrection_spec` description SHALL say that it returns the text and writes no file, and `mcp-call.mjs --list` SHALL print the argument shape of every tool.
- R11.3 THE resurrection skill SHALL tell the agent how to write the spec files, how to adapt a CommonJS or ES-module replacement import, how to record a golden file without editing the séance's comparisons, and how to record a departure from the generated spec.
