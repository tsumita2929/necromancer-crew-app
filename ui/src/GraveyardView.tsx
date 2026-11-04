import type { ReactNode } from 'react';
import { useState } from 'react';
import { Badge, Card, CardTitle, StatCard } from '@kirocrew/app-sdk/ui';
import type { Graveyard, GraveyardProject, Tombstone } from '../../src/graveyard';
import { VERDICT_MARK, VERDICT_ORDER } from '../../src/verdict';
import type { Verdict } from '@necromancer/engine';

type BadgeVariant = 'ok' | 'err' | 'warn' | 'aim' | 'muted';

/** Colour is a second channel only: every verdict also carries a symbol and a word (R2.3). */
const VARIANT: Record<Verdict, BadgeVariant> = {
  alive: 'ok',
  dying: 'warn',
  dead: 'err',
  ghost: 'muted',
  zombie: 'err',
};

const STYLE = `
.necro-fade { animation: necro-in .35s ease-out both; }
@keyframes necro-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .necro-fade { animation: none; } }
.necro-btn { border: 1px solid var(--border, #444); border-radius: 9999px; padding: 4px 12px; font-size: 12px;
  background: transparent; color: inherit; cursor: pointer; }
.necro-btn:hover:not(:disabled) { background: var(--bg-hover, rgba(127,127,127,.15)); }
.necro-btn:disabled { opacity: .5; cursor: default; }
.necro-btn:focus-visible, .necro-head:focus-visible { outline: 2px solid var(--accent, #7c3aed); outline-offset: 2px; }
.necro-head { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: block; }
`;

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const mark = VERDICT_MARK[verdict];
  return (
    <Badge variant={VARIANT[verdict]} title={`Verdict: ${mark.label}`}>
      <span aria-hidden="true">{mark.symbol}</span>
      <span>{mark.label}</span>
    </Badge>
  );
}

export const BASIS_TEXT = {
  hard: 'Hard signal: a fact from a source (deprecated, archived, advisory, yanked or gone).',
  heuristic: 'Heuristic: a guess from staleness (an old release or a quiet repository), not a hard signal.',
} as const;

/** Says in words whether a verdict rests on a fact or on a guess. A heuristic verdict is labelled with a badge as well. */
function BasisLine({ basis }: { basis: 'hard' | 'heuristic' }) {
  return (
    <p className="text-xs text-muted mt-1 flex flex-wrap items-center gap-1.5" data-testid={`basis-${basis}`}>
      {basis === 'heuristic' && <Badge variant="muted">Heuristic</Badge>}
      <span>{BASIS_TEXT[basis]}</span>
    </p>
  );
}

function when(iso?: string): string {
  if (!iso) return 'never scanned';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown time' : d.toLocaleString();
}

/** "GHSA-x (also CVE-y, PYSEC-z)": one entry per vulnerability, with the other ids of the same one. */
export function advisoryLine(list: Tombstone['advisoryList']): string {
  const shown = list.slice(0, 3).map((a) => (a.also.length > 0 ? `${a.id} (also ${a.also.slice(0, 4).join(', ')}${a.also.length > 4 ? ', ...' : ''})` : a.id));
  return shown.join('; ') + (list.length > 3 ? `; and ${list.length - 3} more` : '');
}

function TombstoneRow({
  t,
  onRaise,
}: {
  t: Tombstone;
  onRaise: (t: Tombstone) => void;
}) {
  return (
    <li className="necro-fade py-3 border-t border-border first:border-t-0" data-testid="tombstone" data-kind={t.kind}>
      <div className="flex flex-wrap items-center gap-2">
        {t.kind === 'not-found' ? (
          <Badge variant="warn" title="The registry does not know this package">
            <span aria-hidden="true">?</span>
            <span>Not found</span>
          </Badge>
        ) : (
          <VerdictBadge verdict={t.verdict} />
        )}
        {t.upgrade && (
          <Badge variant="aim" title="The version in use is deprecated or yanked; the package itself is maintained">
            <span aria-hidden="true">↑</span>
            <span>Upgrade</span>
          </Badge>
        )}
        <span className="font-mono text-sm font-semibold">{t.name}</span>
        {t.spec && <span className="font-mono text-xs text-muted">{t.spec}</span>}
        <span className="text-xs text-muted">{t.ecosystem}</span>
        <span className="flex-1" />
        {t.kind === 'verdict' && (
          <button
            type="button"
            className="necro-btn"
            onClick={() => onRaise(t)}
            aria-label={`Raise the dead: ${t.name}. Opens a chat draft with the Necromancer agent.`}
          >
            Raise the dead
          </button>
        )}
      </div>
      <p className="text-sm mt-1.5 italic">&ldquo;{t.epitaph}&rdquo;</p>
      {t.kind === 'not-found' && (
        <p className="text-xs text-muted mt-1" data-testid="not-found-note">
          Nothing to migrate: check the name, or whether the package is private. It is not counted as alive.
        </p>
      )}
      {t.upgrade && (
        <p className="text-xs text-muted mt-1" data-testid="upgrade-note">
          The version in use is {t.upgrade.kind}; the package is still maintained. {t.upgrade.text} Nothing to migrate.
        </p>
      )}
      {t.basis && <BasisLine basis={t.basis} />}
      {t.moved && (
        <p className="text-xs text-muted mt-1" data-testid="moved-note">
          Repository moved: {t.moved}
        </p>
      )}
      {t.advisoryList.length > 0 && (
        <p className="text-xs text-muted mt-1" data-testid="advisories">
          Known {t.advisoryList.length === 1 ? 'vulnerability' : 'vulnerabilities'}: {advisoryLine(t.advisoryList)}
        </p>
      )}
      {t.kind === 'verdict' &&
        (t.successor ? (
          <p className="text-xs text-muted mt-1" data-testid={t.suggestion ? 'successor-suggestion' : 'successor'}>
            {t.suggestion ? (
              <>
                <Badge variant="aim">Suggestion</Badge>{' '}
              </>
            ) : (
              'Way out: '
            )}
            <span className="font-mono">{t.successor.name}</span> ({t.successor.kind}). {t.successor.reason}
            {t.suggestion && ` ${t.successorAdvice ?? ''}`}
          </p>
        ) : (
          <p className="text-xs text-muted mt-1">No successor is known.</p>
        ))}
    </li>
  );
}

function ProjectCard({
  p,
  startOpen,
  onRaise,
}: {
  p: GraveyardProject;
  startOpen: boolean;
  onRaise: (p: GraveyardProject, t: Tombstone) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const panelId = `necro-panel-${p.id}`;
  return (
    <Card className="mb-3" data-testid="project">
      <button
        type="button"
        className="necro-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <CardTitle className="font-mono !m-0 break-all">{p.path}</CardTitle>
          <span className="flex-1" />
          {VERDICT_ORDER.filter((v) => p.counts[v] > 0).map((v) => (
            <span key={v} className="inline-flex items-center gap-1">
              <VerdictBadge verdict={v} />
              <span className="font-mono text-xs" aria-label={`${p.counts[v]} ${v}`}>
                {p.counts[v]}
              </span>
            </span>
          ))}
          {p.notFound > 0 && (
            <span className="inline-flex items-center gap-1" data-testid="project-not-found">
              <Badge variant="warn">
                <span aria-hidden="true">?</span>
                <span>Not found</span>
              </Badge>
              <span className="font-mono text-xs" aria-label={`${p.notFound} not found`}>
                {p.notFound}
              </span>
            </span>
          )}
        </div>
        <div className="text-xs text-muted mt-1">
          Last scan: {when(p.lastScanAt)}
          {p.baselineOnly && p.status === 'ok' ? ' · waiting for the first Night Watch run' : ''}
        </div>
      </button>
      <div id={panelId} hidden={!open}>
        {p.status !== 'ok' && (
          <p className="text-sm mt-2" role="status">
            <Badge variant="warn">{p.status === 'missing' ? 'Missing' : 'Error'}</Badge>{' '}
            {p.message ?? 'This project could not be scanned.'}
          </p>
        )}
        {p.unavailable.length > 0 && (
          <p className="text-xs text-muted mt-2" role="status">
            Partial scan: could not reach {p.unavailable.join(', ')}. Verdicts may be milder than the truth.
          </p>
        )}
        {p.tombstones.length === 0 ? (
          <p className="text-sm mt-2">
            <span aria-hidden="true">✓ </span>No dead dependencies here.
          </p>
        ) : (
          <ul className="mt-2 list-none p-0">
            {p.tombstones.map((t) => (
              <TombstoneRow key={t.key} t={t} onRaise={(tomb) => onRaise(p, tomb)} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export interface GraveyardViewProps {
  graveyard: Graveyard;
  demo: boolean;
  loading?: boolean;
  /** Plain-English reason the real data could not be shown. */
  error?: string | null;
  onRaise: (p: GraveyardProject, t: Tombstone) => void;
  onAskToWatch: () => void;
}

export function GraveyardView({ graveyard, demo, loading, error, onRaise, onAskToWatch }: GraveyardViewProps) {
  const banner: ReactNode = (
    <>
      {error && (
        <div role="alert" className="mb-3 p-3 rounded border border-border text-sm" data-testid="error">
          Could not load your graveyard: {error}. Showing the demo graveyard below.
        </div>
      )}
      {demo && (
        <div className="mb-3 p-3 rounded border border-border text-sm" role="note" data-testid="demo-banner">
          <strong>Demo data.</strong> {error ? '' : 'Nothing is watched yet. '}These projects are examples, not yours.
          Ask the Necromancer agent to watch a project and Night Watch will fill this page.{' '}
          <button type="button" className="necro-btn ml-1" onClick={onAskToWatch}>
            Ask the Necromancer to watch a project
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="px-4 md:px-6 pb-8 overflow-y-auto flex-1 min-h-0">
      <style>{STYLE}</style>
      {banner}
      <div
        className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] mb-6"
        role="group"
        aria-label="Totals by verdict"
      >
        {VERDICT_ORDER.map((v) => (
          <StatCard
            key={v}
            label={`${VERDICT_MARK[v].symbol} ${VERDICT_MARK[v].label}`}
            value={loading ? '…' : graveyard.totals[v]}
            accent={v === 'zombie' || v === 'dead'}
          />
        ))}
        <StatCard label="? Not found" value={loading ? '…' : graveyard.notFound} />
      </div>
      <p className="text-xs text-muted mb-4" data-testid="basis-legend">
        Each verdict says what it rests on. A <strong>hard signal</strong> is a fact from a source. A <strong>heuristic</strong> is a
        guess from staleness and is labelled; treat it as a hint to look, not as proof.
        {graveyard.projects.some((p) => p.heuristicCount > 0) &&
          ` ${graveyard.projects.reduce((n, p) => n + p.heuristicCount, 0)} of the verdicts below are heuristic.`}
      </p>
      {graveyard.projects.map((p, i) => (
        <ProjectCard key={p.id} p={p} startOpen={i === 0} onRaise={onRaise} />
      ))}
    </div>
  );
}
