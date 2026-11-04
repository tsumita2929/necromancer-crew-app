# Tasks: Crew app on the real engine, and one end-to-end resurrection

- [x] 1. Write requirements.md, design.md, tasks.md
- [x] 2. Real engine by default, bundled (R1.1 to R1.4)
  - [x] 2.1 `src/real-engine.ts`, `selectEngine(env, factory)`, bundle check
  - [x] 2.2 Tests: default is the engine, stub on request, fallback labelled with a note
- [x] 3. Recorded-response tests on the real engine (R1.5, R1.6, R4)
  - [x] 3.1 `test/recorded/` and a replaying fetch
  - [x] 3.2 Verdicts for the haunted app equal the engine's recorded verdicts
  - [x] 3.3 Night Watch: baseline, then one dependency worse, exactly one notification
- [x] 4. Haunted app with passing tests, lockfile and README (R2)
- [x] 5. Skill and prompt: branch name `resurrect/<dependency>` (R3.1)
- [x] 6. End-to-end run on a scratch copy (R3)
  - [x] 6.1 left-pad to `padStart`, with séance, including old-versus-old and a wrong replacement
  - [x] 6.2 request to `fetch`, with séance
  - [x] 6.3 Record counterexamples and how the migration handles them
- [x] 7. Nearby inputs (R5): no successor, unlisted successor, dirty tree, no git repository, engine load failure
- [x] 8. Fix the skill and prompt for whatever the run showed
- [x] 9. Checked: the app is not installed; live checks listed as waiting on the owner
- [x] 10. Write `docs/verification/crew-live.md`
