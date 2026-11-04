import type { FailureKind, HttpResult } from '../net/http.js';

/** What a source function returns. Never an exception. */
export type Fetched<T> = { ok: true; value: T } | { ok: false; kind: FailureKind; reason: string };

export function fail<T>(result: Extract<HttpResult, { ok: false }>): Fetched<T> {
  return { ok: false, kind: result.kind, reason: result.reason };
}

export function badShape<T>(what: string): Fetched<T> {
  return { ok: false, kind: 'unavailable', reason: `unexpected answer: ${what}` };
}
