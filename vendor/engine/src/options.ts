/** Tuning that goes beyond the shared EngineOptions. All fields are optional. */
export interface EngineTuning {
  /** Parallel requests. Default 8. */
  concurrency?: number;
  /** Per-request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Wait before the single retry, in milliseconds. Default 400. */
  retryDelayMs?: number;
  /** GitHub API calls allowed per engine instance. Default 20 (the limit is 60 per hour). */
  githubBudget?: number;
  /** Dependencies diagnosed per autopsy; direct ones first. Default 400. */
  maxDependencies?: number;
  /** Check that successors named in deprecation messages exist. Default true. */
  verifySuccessors?: boolean;
  /** Injectable wait, so tests need no real time. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolvedTuning {
  concurrency: number;
  timeoutMs: number;
  retryDelayMs: number;
  githubBudget: number;
  maxDependencies: number;
  verifySuccessors: boolean;
  sleep: (ms: number) => Promise<void>;
}

type TimerGlobals = {
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/** Timers without DOM or Node types, so the engine stays isomorphic. */
export const timers: TimerGlobals = globalThis as unknown as TimerGlobals;

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function resolveTuning(tuning: EngineTuning | undefined): ResolvedTuning {
  const t = tuning ?? {};
  return {
    concurrency: Math.max(1, Math.floor(positive(t.concurrency, 8))),
    timeoutMs: positive(t.timeoutMs, 15_000),
    retryDelayMs: positive(t.retryDelayMs, 400),
    githubBudget: Math.floor(positive(t.githubBudget, 20)),
    maxDependencies: Math.floor(positive(t.maxDependencies, 400)),
    verifySuccessors: t.verifySuccessors !== false,
    sleep:
      t.sleep ??
      ((ms) =>
        new Promise<void>((resolve) => {
          if (timers.setTimeout) timers.setTimeout(resolve, ms);
          else resolve();
        })),
  };
}
