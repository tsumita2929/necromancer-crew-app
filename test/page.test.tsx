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
    expect(totals).toEqual(['✓ Alive 1', '◐ Dying 0', '✝ Dead 1', '◌ Ghost 0', '☣ Zombie 1', '? Not found 0']);
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

describe('notFound, confidence, merged advisories and moved repositories on the page (round 4b)', () => {
  const dep = (name: string, verdict: string, extra: Record<string, unknown> = {}) => ({
    dependency: { ecosystem: 'npm', name, spec: '1.0.0', direct: true, scope: 'main', declaredIn: 'package.json' },
    verdict,
    evidence: [],
    advisories: [],
    successors: [],
    ...extra,
  });
  function stateOf(diagnoses: unknown[]): WatchState {
    return {
      version: 1,
      projects: {
        p1: {
          id: 'p1',
          path: '/work/p1',
          addedAt: '2026-11-01T00:00:00Z',
          status: 'ok',
          snapshot: {},
          report: { subject: 'x', scannedAt: '2026-11-03T00:00:00Z', manifests: [], diagnoses, problems: [], unavailable: [], summary: {} },
        },
      },
    } as unknown as WatchState;
  }
  async function show(diagnoses: unknown[]) {
    host.get = vi.fn(async () => ({ state: stateOf(diagnoses), problem: null }));
    render(<App />);
    return screen.findByTestId('project');
  }

  it('a package the registry does not know says so, is not counted as alive and has no "Raise the dead" button', async () => {
    const project = await show([dep('ghost-pkg', 'alive', { notFound: true }), dep('old', 'dead')]);
    const rows = within(project).getAllByTestId('tombstone');
    const nf = rows.find((r) => r.getAttribute('data-kind') === 'not-found')!;
    expect(nf.textContent).toContain('Not found');
    expect(nf.textContent).toMatch(/not found on the registry \(removed, private or misspelled\)/i);
    expect(within(nf).getByTestId('not-found-note').textContent).toMatch(/Nothing to migrate/);
    expect(within(nf).queryByRole('button')).toBeNull();
    expect(within(rows.find((r) => r.getAttribute('data-kind') === 'verdict')!).getByRole('button')).toBeTruthy();
    const totals = screen.getAllByTestId('stat').map((s) => s.textContent);
    expect(totals).toEqual(['✓ Alive 0', '◐ Dying 0', '✝ Dead 1', '◌ Ghost 0', '☣ Zombie 0', '? Not found 1']);
    expect(within(project).getByTestId('project-not-found').textContent).toContain('1');
  });

  it('a project where every dependency is not found shows no "No dead dependencies" all-clear', async () => {
    const project = await show([dep('a', 'alive', { notFound: true }), dep('b', 'alive', { notFound: true })]);
    expect(within(project).getAllByTestId('tombstone')).toHaveLength(2);
    expect(project.textContent).not.toContain('No dead dependencies here');
    expect(screen.getAllByTestId('stat')[0]?.textContent).toBe('✓ Alive 0');
  });

  it('a low-confidence way out reads as a suggestion, a high one as a way out', async () => {
    const low = { name: 'padder-lite', ecosystem: 'npm', kind: 'package', reason: 'a plausible fit', source: 'curated', confidence: 'low' };
    const high = { name: 'fetch', ecosystem: 'npm', kind: 'native', reason: 'built in', source: 'curated', confidence: 'high' };
    const project = await show([dep('lowdep', 'dead', { successors: [low] }), dep('highdep', 'dead', { successors: [high] })]);
    const suggestion = within(project).getByTestId('successor-suggestion');
    expect(suggestion.textContent).toContain('Suggestion');
    expect(suggestion.textContent).toContain('padder-lite');
    expect(suggestion.textContent).toMatch(/low confidence/);
    expect(suggestion.textContent).toMatch(/Ask the person/);
    expect(within(project).getByTestId('successor').textContent).toContain('Way out: fetch (native)');
  });

  it('merged advisories show one id with its other ids', async () => {
    const project = await show([dep('django', 'zombie', { advisories: ['GHSA-1', 'GHSA-2'], advisoryAliases: { 'GHSA-1': ['CVE-2020-1', 'PYSEC-2020-1'] } })]);
    const text = within(project).getByTestId('advisories').textContent!;
    expect(text).toContain('GHSA-1 (also CVE-2020-1, PYSEC-2020-1)');
    expect(text).toContain('GHSA-2');
    expect(text).not.toContain('CVE-2020-1, PYSEC-2020-1, GHSA');
  });

  it('a moved repository reads as a note, on a maintained package, with no verdict badge count and no raise button', async () => {
    const moved = [{ code: 'repo-moved', message: 'The repository was renamed to new-org/codemirror.', source: 'github', url: 'https://github.com/new-org/codemirror' }];
    const project = await show([dep('codemirror', 'alive', { evidence: moved })]);
    const row = within(project).getByTestId('tombstone');
    expect(row.getAttribute('data-kind')).toBe('notice');
    expect(within(row).getByTestId('moved-note').textContent).toMatch(/renamed to new-org\/codemirror/);
    expect(within(row).queryByRole('button')).toBeNull();
    expect(screen.getAllByTestId('stat')[0]?.textContent).toBe('✓ Alive 1');
  });
});

describe('the upgrade notice on the page (round 4c)', () => {
  const dep = (name: string, verdict: string, extra: Record<string, unknown> = {}) => ({
    dependency: { ecosystem: 'npm', name, spec: '8.57.1', direct: true, scope: 'main', declaredIn: 'package.json' },
    verdict,
    evidence: [],
    advisories: [],
    successors: [],
    ...extra,
  });
  const deprecated = { code: 'version-deprecated', message: 'The version in use (8.57.1) is deprecated.', source: 'npm' };
  async function show(diagnoses: unknown[]) {
    const state = {
      version: 1,
      projects: {
        p1: {
          id: 'p1',
          path: '/work/p1',
          addedAt: '2026-11-01T00:00:00Z',
          status: 'ok',
          snapshot: {},
          report: { subject: 'x', scannedAt: '2026-11-03T00:00:00Z', manifests: [], diagnoses, problems: [], unavailable: [], summary: {} },
        },
      },
    } as unknown as WatchState;
    host.get = vi.fn(async () => ({ state, problem: null }));
    render(<App />);
    return screen.findByTestId('project');
  }

  it('an alive package with a deprecated version shows an Upgrade badge and the target, is counted alive, and has no raise button', async () => {
    const project = await show([dep('eslint', 'alive', { evidence: [deprecated], upgradeTo: { version: '10.14.0', sameMajor: false } })]);
    const row = within(project).getByTestId('tombstone');
    expect(row.getAttribute('data-kind')).toBe('notice');
    expect(row.textContent).toContain('Upgrade');
    const note = within(row).getByTestId('upgrade-note').textContent!;
    expect(note).toContain('Upgrade to 10.14.0 (another major version).');
    expect(note).toMatch(/deprecated; the package is still maintained/);
    expect(note).toContain('Nothing to migrate');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).queryByText(/Dying/)).toBeNull();
    const totals = screen.getAllByTestId('stat').map((s) => s.textContent);
    expect(totals).toEqual(['✓ Alive 1', '◐ Dying 0', '✝ Dead 0', '◌ Ghost 0', '☣ Zombie 0', '? Not found 0']);
  });

  it('an older target and a yanked version read in words', async () => {
    const yanked = { code: 'version-yanked', message: 'yanked', source: 'pypi' };
    const project = await show([
      dep('codemirror', 'alive', { evidence: [deprecated], upgradeTo: { version: '6.0.2', sameMajor: true, older: true } }),
      dep('flask', 'alive', { evidence: [yanked], upgradeTo: { version: '2.0.1', sameMajor: true } }),
    ]);
    const notes = within(project).getAllByTestId('upgrade-note').map((n) => n.textContent!);
    expect(notes.some((n) => /Use 6\.0\.2 .*older than the version in use/.test(n))).toBe(true);
    expect(notes.some((n) => /is yanked; the package is still maintained\. Upgrade to 2\.0\.1/.test(n))).toBe(true);
  });

  it('an upgrade notice with an advisory shows both lines on one row', async () => {
    const project = await show([
      dep('glob', 'alive', { evidence: [deprecated], upgradeTo: { version: '14.0.3', sameMajor: false }, advisories: ['GHSA-1'], advisoryAliases: { 'GHSA-1': ['CVE-1'] } }),
    ]);
    const row = within(project).getByTestId('tombstone');
    expect(within(row).getByTestId('upgrade-note').textContent).toContain('Upgrade to 14.0.3');
    expect(within(row).getByTestId('advisories').textContent).toContain('GHSA-1 (also CVE-1)');
  });
});
