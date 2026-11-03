import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Verdict } from '@necromancer/engine';
import { detectWorse, mergeSnapshot } from '../src/nightwatch';
import type { Snapshot } from '../src/state';
import { VERDICT_ORDER, rank } from '../src/verdict';

const verdict = fc.constantFrom<Verdict>(...VERDICT_ORDER);
// A small pool, so that two snapshots share keys often and every branch is reached.
const key = fc.constantFrom('npm:a', 'npm:b', 'npm:c', 'npm:d', 'pypi:a', 'pypi:b');
const snapshot = fc.dictionary(key, verdict, { maxKeys: 6 });
const pair = fc.tuple(snapshot, snapshot);

/** A snapshot that is never worse than `base` on any key, and may add alive keys. */
const notWorseThan = (base: Snapshot) =>
  fc
    .tuple(
      fc.array(fc.integer({ min: 0, max: 4 }), { minLength: Object.keys(base).length, maxLength: Object.keys(base).length }),
      fc.array(key, { maxLength: 4 }),
    )
    .map(([drops, extra]) => {
      const out: Snapshot = {};
      Object.entries(base).forEach(([k, v], i) => {
        out[k] = VERDICT_ORDER[Math.max(0, rank(v) - (drops[i] ?? 0))] as Verdict;
      });
      for (const k of extra) if (out[k] === undefined && base[k] === undefined) out[k] = 'alive';
      return out;
    });

describe('Night Watch properties', () => {
  it('R4.2 never notifies when nothing got worse', () => {
    fc.assert(
      fc.property(snapshot.chain((prev) => fc.tuple(fc.constant(prev), notWorseThan(prev))), ([prev, cur]) => {
        expect(detectWorse(prev, cur)).toEqual([]);
      }),
    );
  });

  it('R4.3 notifies once per worsened dependency, and only for those', () => {
    fc.assert(
      fc.property(pair, ([prev, cur]) => {
        const expected = Object.keys(cur)
          .filter((k) => rank(cur[k] as Verdict) > rank(prev[k] ?? 'alive'))
          .sort();
        const got = detectWorse(prev, cur);
        expect(got.map((w) => w.key).sort()).toEqual(expected);
        expect(new Set(got.map((w) => w.key)).size).toBe(got.length);
        for (const w of got) {
          expect(w.from).toBe(prev[w.key] ?? 'alive');
          expect(w.to).toBe(cur[w.key]);
        }
      }),
    );
  });

  it('R4.3 making exactly one dependency worse yields exactly one notification', () => {
    fc.assert(
      fc.property(
        snapshot.filter((s) => Object.keys(s).some((k) => rank(s[k] as Verdict) < 4)),
        fc.nat(),
        fc.integer({ min: 1, max: 4 }),
        (prev, pick, steps) => {
          const candidates = Object.keys(prev).filter((k) => rank(prev[k] as Verdict) < 4);
          const target = candidates[pick % candidates.length] as string;
          const cur: Snapshot = { ...prev };
          cur[target] = VERDICT_ORDER[Math.min(4, rank(prev[target] as Verdict) + steps)] as Verdict;
          expect(detectWorse(prev, cur).map((w) => w.key)).toEqual([target]);
        },
      ),
    );
  });

  it('R4.5 a first scan (no previous snapshot) never notifies', () => {
    fc.assert(fc.property(snapshot, (cur) => {
      expect(detectWorse(undefined, cur)).toEqual([]);
    }));
  });

  it('R4.7 the same state twice is silent: comparing a snapshot with itself notifies nothing', () => {
    fc.assert(fc.property(snapshot, (s) => {
      expect(detectWorse(s, s)).toEqual([]);
    }));
  });

  it('R4.7 after storing a scan, the same scan again is silent', () => {
    fc.assert(
      fc.property(snapshot, snapshot, fc.boolean(), (prev, cur, partial) => {
        const stored = mergeSnapshot(prev, cur, partial);
        expect(detectWorse(stored, cur)).toEqual([]);
      }),
    );
  });

  it('R4.8 a partial scan never lowers a stored verdict', () => {
    fc.assert(
      fc.property(pair, ([prev, cur]) => {
        const merged = mergeSnapshot(prev, cur, true);
        expect(Object.keys(merged).sort()).toEqual(Object.keys(cur).sort());
        for (const k of Object.keys(merged)) {
          expect(rank(merged[k] as Verdict)).toBeGreaterThanOrEqual(rank(prev[k] ?? 'alive'));
          expect(rank(merged[k] as Verdict)).toBeGreaterThanOrEqual(rank(cur[k] as Verdict));
        }
      }),
    );
  });

  it('R4.8 a complete scan stores exactly what it saw', () => {
    fc.assert(fc.property(pair, ([prev, cur]) => {
      expect(mergeSnapshot(prev, cur, false)).toEqual(cur);
    }));
  });

  it('R4.4 the verdict order is total and strictly increasing', () => {
    fc.assert(
      fc.property(verdict, verdict, (a, b) => {
        expect(rank(a) < rank(b) || rank(a) > rank(b) || a === b).toBe(true);
        expect(detectWorse({ k: a }, { k: b }).length === 1).toBe(rank(b) > rank(a));
      }),
    );
  });
});
