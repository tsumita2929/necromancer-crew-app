---
inclusion: always
---

# Necromancer Crew app: working rules

This repository is a Kiro Crew app (`app.json` at the root). Read `README.md` first.

- **Spec first.** Features start in `.kiro/specs/<feature>/` (requirements with numbered EARS criteria, design, tasks) and tasks are ticked as they land.
  Test names start with the requirement they check (`R4.2 never notifies when nothing got worse`).
- **Minimal permissions.** `app.json` asks only for what the code uses (`api: /apps/necromancer/api`, `cron`). Adding `network`, `spawn`, `storage`
  or `mcpTools` needs a named line of code that uses it. The hook `crew-manifest-permissions` checks this.
- **No run-time dependencies.** The installed app is `dist/server.mjs` (MCP server, engine bundled), `ui/dist/index.mjs` (page) and a stdlib Python backend.
  Rebuild with `npm run bundle` and commit the output; the platform does not build a locally installed app.
- **Decisions are code, not a model's opinion.** Night Watch's "got worse" rule is a pure function with property tests. The agent relays results.
- **The agent never pushes.** No `git push`, no remote, no git configuration change, local branch `resurrect/<dependency>` only, stop on a dirty tree or a
  non-git folder. The skill and the agent prompt say the same; keep them in step.
- **Honesty about the engine.** Every tool answer says which engine produced it (`engine` or `stub`). A fallback is labelled with the cause.
- **No GitHub API calls from tests.** Tests replay recorded responses (`test/recorded`). Live runs may set `NECROMANCER_BLOCK_HOSTS=api.github.com`.
- English for code, comments and docs. No secrets. Node 22.12+ for development, Python 3 for the launcher and backend.
