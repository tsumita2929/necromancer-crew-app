// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { AGENT, GRAVEYARD_PATH } from '../ui/src/App';
import { demoState } from '../src/demo';
import { buildGraveyard } from '../src/graveyard';
import { createStubEngine } from '../src/stub-engine';
import type { WatchState } from '../src/state';
import { host } from './stubs/sdk';

beforeEach(() => {
  host.active = true;
  host.openChat = vi.fn();
});
afterEach(cleanup);

async function realState(): Promise<WatchState> {
  const report = await createStubEngine().autopsy({
    subject: 'local:/work/shop',
    files: [
      {
        kind: 'package.json',
        path: 'package.json',
        content: JSON.stringify({ dependencies: { request: '2', express: '4', 'left-pad': '1' } }),
      },
    ],
  });
  return {
    version: 1,
    projects: {
      abc123: { id: 'abc123', path: '/work/shop', addedAt: '2026-11-01T00:00:00Z', status: 'ok', snapshot: {}, report },
    },
  };
}

describe('Graveyard page (R2)', () => {
  it('R2.1/R2.2 lists a watched project with counts, worst dependency first, epitaph and successor', async () => {
    const state = await realState();
    host.get = vi.fn(async () => ({ state, problem: null }));
    render(<App />);
    const project = await screen.findByTestId('project');
    expect(host.get).toHaveBeenCalledWith(GRAVEYARD_PATH);
    expect(within(project).getByText('/work/shop')).toBeTruthy();
    const rows = within(project).getAllByTestId('tombstone');
    expect(rows.map((r) => within(r).getByText(/^(request|left-pad)$/).textContent)).toEqual(['request', 'left-pad']);
    expect(rows[0]?.textContent).toContain('GHSA-p8p7-x288-28g6');
    expect(rows[0]?.textContent).toContain('Way out: fetch (native)');
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });

  it('R2.3 every verdict is text and a symbol, never colour alone', async () => {
    host.get = vi.fn(async () => ({ state: await realState(), problem: null }));
    render(<App />);
    await screen.findByTestId('project');
    const totals = screen.getAllByTestId('stat').map((s) => s.textContent);
    expect(totals).toEqual(['✓ Alive 1', '◐ Dying 0', '✝ Dead 1', '◌ Ghost 0', '☣ Zombie 1']);
  });

  it('R2.4 with nothing watched it says so and shows a labelled demo graveyard', async () => {
    host.get = vi.fn(async () => ({ state: { version: 1, projects: {} }, problem: null }));
    render(<App />);
    const banner = await screen.findByTestId('demo-banner');
    expect(banner.textContent).toContain('Demo data.');
    expect(banner.textContent).toContain('Nothing is watched yet');
    expect(screen.getAllByTestId('project')).toHaveLength(2);
  });

  it('R2.5 when the backend is unreachable it shows an error notice and the labelled demo, not user data', async () => {
    host.get = vi.fn(async () => {
      throw new Error('API 502: no reachable backend');
    });
    render(<App />);
    const alert = await screen.findByTestId('error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('API 502');
    expect(screen.getByTestId('demo-banner').textContent).toContain('These projects are examples, not yours.');
  });

  it('R2.5 a state-file problem reported by the backend is shown too', async () => {
    host.get = vi.fn(async () => ({ state: { version: 1, projects: {} }, problem: 'State file could not be read: ValueError' }));
    render(<App />);
    expect((await screen.findByTestId('error')).textContent).toContain('could not be read');
  });

  it('R2.6 "Raise the dead" opens an unsent draft with the Necromancer agent naming project and dependency', async () => {
    host.get = vi.fn(async () => ({ state: await realState(), problem: null }));
    render(<App />);
    await screen.findByTestId('project');
    const first = document.querySelector<HTMLButtonElement>('button[aria-label^="Raise the dead: request"]')!;
    fireEvent.click(first);
    expect(host.openChat).toHaveBeenCalledTimes(1);
    const opts = (host.openChat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.agent).toBe(AGENT);
    expect(opts.autoSend).toBe(false);
    expect(opts.message).toContain('/work/shop');
    expect(opts.message).toContain('request is zombie');
    expect(opts.message).toContain('do not push');
  });

  it('R2.7 a project header is a real button with aria-expanded that toggles its panel', async () => {
    host.get = vi.fn(async () => ({ state: { version: 1, projects: {} }, problem: null }));
    render(<App />);
    await screen.findByTestId('demo-banner');
    const headers = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    expect(headers().map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'false']); // first starts open
    expect(headers().every((h) => h.type === 'button' && h.getAttribute('aria-controls'))).toBe(true);
    fireEvent.click(headers()[1]!);
    expect(headers().map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
    expect(document.getElementById(headers()[1]!.getAttribute('aria-controls')!)?.hidden).toBe(false);
  });

  it('R2.7 respects prefers-reduced-motion in its stylesheet', async () => {
    host.get = vi.fn(async () => ({ state: { version: 1, projects: {} }, problem: null }));
    const { container } = render(<App />);
    await screen.findByTestId('demo-banner');
    expect(container.querySelector('style')?.textContent).toMatch(/prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none/);
  });

  it('a hidden page does not poll', async () => {
    vi.useFakeTimers();
    host.active = false;
    host.get = vi.fn(async () => ({ state: { version: 1, projects: {} }, problem: null }));
    render(<App />);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(host.get).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('buildGraveyard (pure view model)', () => {
  it('sorts tombstones worst first and ignores alive dependencies', () => {
    const shop = buildGraveyard(demoState()).projects.find((p) => p.id === 'demo-web-shop');
    expect(shop?.tombstones.map((t) => `${t.name}:${t.verdict}`)).toEqual(['request:zombie', 'left-pad:dead', 'moment:dying']);
  });

  it('uses the worst verdict when one dependency is declared twice', () => {
    const state = demoState();
    const p = Object.values(state.projects)[0]!;
    const dup = p.report!.diagnoses.find((d) => d.dependency.name === 'request')!;
    p.report!.diagnoses.push({ ...dup, verdict: 'alive', evidence: [] });
    const counts = buildGraveyard(state).projects.find((x) => x.id === p.id)!.counts;
    expect(counts).toEqual({ alive: 1, dying: 1, dead: 1, ghost: 0, zombie: 1 });
  });

  it('gives every tombstone an epitaph even without evidence', () => {
    const state = demoState();
    const p = Object.values(state.projects)[0]!;
    p.report!.diagnoses[1]!.evidence = [];
    const t = buildGraveyard(state).projects.find((x) => x.id === p.id)!.tombstones.find((x) => x.name === 'request')!;
    expect(t.epitaph).toMatch(/no recorded evidence/);
  });
});

describe('basis on the page (item 1)', () => {
  it('a heuristic verdict is labelled with a badge and in words; a hard one is labelled in words; the legend says how many are heuristic', async () => {
    host.get = vi.fn(async () => ({ state: { version: 1, projects: {} }, problem: null }));
    render(<App />);
    await screen.findByTestId('demo-banner');
    // The demo graveyard has `moment` (heuristic) and hard-signal tombstones.
    const heuristic = [...document.querySelectorAll('[data-testid="basis-heuristic"]')];
    const hard = [...document.querySelectorAll('[data-testid="basis-hard"]')];
    expect(heuristic.length).toBeGreaterThan(0);
    expect(hard.length).toBeGreaterThan(0);
    for (const el of heuristic) {
      expect(el.textContent).toContain('Heuristic');
      expect(el.textContent).toContain('a guess from staleness');
      expect(el.textContent).toContain('not a hard signal');
      expect(el.querySelector('[data-variant="muted"]')?.textContent).toBe('Heuristic');
    }
    for (const el of hard) {
      expect(el.textContent).toContain('Hard signal');
      expect(el.querySelector('[data-variant]')).toBeNull();
    }
    expect(screen.getByTestId('basis-legend').textContent).toMatch(/1 of the verdicts below are heuristic/);
  });

  it('the view model counts heuristic tombstones and carries the basis of each', () => {
    const projects = buildGraveyard(demoState()).projects;
    const shop = projects.find((p) => p.id === 'demo-web-shop')!;
    expect(shop.heuristicCount).toBe(1);
    expect(shop.tombstones.find((t) => t.name === 'moment')?.basis).toBe('heuristic');
    expect(shop.tombstones.find((t) => t.name === 'request')?.basis).toBe('hard');
  });

  it('a verdict whose basis the engine did not give carries no basis label (nothing is invented)', () => {
    const state = demoState();
    const p = Object.values(state.projects)[0]!;
    for (const d of p.report!.diagnoses) delete (d as { basis?: string }).basis;
    const view = buildGraveyard(state).projects.find((x) => x.id === p.id)!;
    expect(view.tombstones.every((t) => t.basis === undefined)).toBe(true);
    expect(view.heuristicCount).toBe(0);
  });
});
