# Design: the generated séance in the Crew app

## Flow

```
agent ── seance_write {path, name} ─▶ MCP server
                                              │ diagnose ─▶ chooseSuccessor
                                              │ readSourceFiles(path)   (no symlinks, skip list, size cap)
                                              │ engine.scanUsage(files, target)
                                              │ engine.seance(diagnosis, successor, usage) ─▶ SeanceBundle
                                              │ summarizeUsage ─▶ warnings
                                              └ writeBundle (resurrect/* branch only, no overwrite)
agent runs bundle.install, then bundle.run  ─▶ the generated séance
```

No engine change. `scanUsage` and `seance` are the optional members of `Engine` in `types.ts`; the stub does
not have them, so the tool answers that the stub cannot generate a séance.

## Modules

| File | Job |
|---|---|
| `src/project-files.ts` | `readSourceFiles(root)`: JS/TS/Python files, depth 8, 2000 files, 2 MB each, no symlinks, lists unreadable files. `isTestPath`. |
| `src/seance-tool.ts` | `summarizeUsage` (warnings), `isSafeBundlePath`, `writeBundle` (branch rule, conflicts, symlink escape). |
| `src/tools.ts` | The `seance` tool; `resurrection_spec` takes an optional `path`; `chooseSuccessor` is shared. |

## Decisions

- **A separate tool, not only an option on `resurrection_spec`.** The spec is three Markdown files the agent writes
  once; the séance is a set of runnable files with commands and a safety rule on writing. Different outputs and
  different risk, so different tools. `resurrection_spec` also takes `path`, so the spec describes the real usage.
- **Write only on `resurrect/*`.** The skill creates the branch first, so the generated files are part of the
  branch's history and the base branch stays clean. The tool enforces it instead of trusting the prompt.
- **Never overwrite.** A re-run is idempotent (same content is reported as unchanged); a differing file is the
  user's work and stops the write for all files.
- **Warnings instead of silence.** Each unusual scan result (unused, never called, tests only, unreadable files,
  computed dynamic imports) becomes a sentence the agent must act on, written into `usage.warnings`.
- **`seance` directories are skipped by the scan,** because a bundle written by an earlier run imports the old
  package on purpose.
- **Runner.** The generated JavaScript séance uses Vitest and fast-check; the agent installs them with the
  `install` commands from the answer. If the project uses another runner, the agent keeps the generated séance as
  is (a separate command) and says so.

## Error handling

| Input | Behaviour |
|---|---|
| Not a git repository / wrong branch | `write` refused, nothing written |
| Existing file differs | refused, nothing written |
| Hostile bundle path or symlinked parent | refused, nothing written |
| Unreadable or binary file | listed, rest scanned |
| No curated recipe | generic template, `comparisonsSkipped: true`, note |
| Stub engine | error: cannot scan or generate |

## Tests

`test/seance-tool.test.ts` runs the real engine's scanner and generator with a fixed diagnosis (no network) for
every case above. The end-to-end proof is a fresh subagent run recorded in `docs/verification/crew-seance.md`.
