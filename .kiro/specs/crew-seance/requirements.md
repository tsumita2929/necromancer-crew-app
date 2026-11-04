# Requirements: the generated séance drives the resurrection in the Crew app

Round 3 of `apps/crew`. The engine now scans how a project uses a dependency (`scanUsage`),
generates a differential property-based test for the chosen successor (`generateSeance`), and
describes it in the spec (`resurrectionSpec(d, s, { usage })`). This round gives the Necromancer
agent those abilities and makes it run the generated séance first.

Vocabulary: the *bundle* is the engine's `SeanceBundle` (test, replacement module, README, install
and run commands, what it compares, known differences). A *generic* bundle is the template used when
no curated recipe exists; its comparisons stay skipped until the replacement sets `READY`.

## R1. The `seance` tool

**User story:** As the Necromancer agent, I want one call that scans the project, generates the
séance for the chosen successor and writes it into the project, so that I run a tested comparison
first and write comparisons by hand only where one is missing.

1. WHEN `seance` is called with a project directory, an ecosystem, a name and no successor THEN it
   SHALL diagnose the dependency, choose the best listed successor (or `raise` when none is known),
   scan the project's JavaScript, TypeScript and Python files with the engine's `scanUsage`, and
   return the bundle's recipe, template kind, install and run commands, compared and ignored parts,
   known differences, members and the file list.
2. WHEN the recipe is curated THEN the answer SHALL say `template: "curated"`. WHEN it is the generic
   template THEN it SHALL say `template: "generic"` and `comparisonsSkipped: true` and SHALL explain
   that the comparisons stay skipped until `READY` is set.
3. WHEN `write` is true THEN the tool SHALL write the files into the project, and only while the
   project's current git branch is named `resurrect/<something>`.
4. IF the project is not a git repository, or is on any other branch, THEN `write` SHALL be refused and
   nothing SHALL be written.
5. IF a target file exists with different content, or is not a regular file, THEN the tool SHALL refuse
   and write none of the files. IF it exists with the same content THEN it SHALL be reported as
   unchanged.
6. THE tool SHALL refuse any file path that is absolute, contains `..`, an empty segment, a backslash or
   a `.git` segment, and any path whose nearest existing parent resolves outside the project.
7. THE scan SHALL NOT follow symbolic links, SHALL skip `node_modules`, `.git`, build output, virtual
   environments and earlier `seance` directories, and SHALL NOT modify any file.
8. WHEN the dependency is alive, the directory does not exist, or the engine is the stub (which cannot
   scan or generate) THEN the tool SHALL return an error with a plain-English message.

## R2. Honest usage reports

1. WHEN no source file imports the dependency at run time THEN the answer SHALL say so in `usage.warnings`
   and `usage.notUsed` SHALL be true.
2. WHEN the dependency is imported but no member is called THEN `usage.neverCalled` SHALL be true, with a
   warning.
3. WHEN every file that imports the dependency is a test file THEN `usage.onlyInTests` SHALL be true, with
   a warning.
4. WHEN files cannot be read (permission, binary data, too large) THEN they SHALL be listed in
   `usage.unreadable`, the rest SHALL still be scanned, and a warning SHALL say that calls in them are not
   in the séance's examples.
5. WHEN a dynamic import has a computed specifier THEN the count SHALL be reported and a warning given.

## R3. Spec with usage

1. WHEN `resurrection_spec` is given `path` THEN it SHALL scan the project and pass the usage to the
   engine's `resurrectionSpec`, and SHALL return the usage summary beside the three spec files.
2. WHEN `path` is not given THEN its behaviour SHALL be as before.

## R4. Agent and skill

1. THE skill SHALL tell the agent to call `seance_write` on the resurrection branch, run the
   `install` and `run` commands from the answer, and treat the generated séance as the first comparison.
2. THE skill SHALL tell the agent to write comparisons by hand only (a) where the bundle says a comparison is
   skipped (generic template, `TODO(necromancer)` markers) or (b) for project calls the bundle does not
   cover, and to say which.
3. THE skill SHALL tell the agent what to do for each warning in R2 (unused dependency, only in tests,
   unreadable files).
4. THE skill SHALL keep the rules: never push, local branch `resurrect/<dependency>` only, stop on a dirty
   tree or a non-git directory.
5. THE agent prompt SHALL list the `seance` tool.

## R5. Proof

1. A fresh subagent following the updated skill SHALL resurrect `left-pad` in a fresh copy of the haunted
   app using the generated séance; the séance SHALL find the empty-fill and multi-character-fill
   differences; the branch's tests SHALL pass; a deliberate mutant of the replacement SHALL fail.
2. The nearby inputs `request` to `fetch` (generic template), `is-odd` (raise), a dependency with no calls, a
   dependency imported only in a test file, and a project file the scan cannot read SHALL each be exercised
   and reported.
