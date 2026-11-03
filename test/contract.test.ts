import { describe, expect, it } from 'vitest';
import { VERDICTS } from '@necromancer/engine';
import { VERDICT_ORDER } from '../src/verdict';

describe('shared contract', () => {
  it('R4.4 the local verdict order equals VERDICTS in packages/engine/src/types.ts', () => {
    expect([...VERDICT_ORDER]).toEqual([...VERDICTS]);
  });
});
