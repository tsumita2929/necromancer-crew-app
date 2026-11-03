import { useAppApi, useAppInfo, useChatLauncher } from '@kirocrew/app-sdk';
import { PageHeader } from '@kirocrew/app-sdk/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { demoState } from '../../src/demo';
import { buildGraveyard } from '../../src/graveyard';
import type { WatchState } from '../../src/state';
import { GraveyardView } from './GraveyardView';

/** Proxy path to backend/server.py. Must match permissions.api in app.json. */
export const GRAVEYARD_PATH = '/apps/necromancer/api/graveyard';
/** The agent in agents/necromancer.json. */
export const AGENT = 'necromancer';
const POLL_MS = 60_000;

interface GraveyardResponse {
  state: WatchState;
  problem: string | null;
}

export default function Necromancer() {
  const api = useAppApi();
  const { active } = useAppInfo();
  const { openChat } = useChatLauncher();
  const [state, setState] = useState<WatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Keep the client in a ref so `load` stays stable whether or not the host
  // returns the same object on every render; otherwise the effect below would
  // restart (and refetch) on each render.
  const apiRef = useRef(api);
  apiRef.current = api;

  const load = useCallback(async () => {
    try {
      const res = await apiRef.current.get<GraveyardResponse>(GRAVEYARD_PATH);
      setState(res.state);
      setError(res.problem);
    } catch (err) {
      setState(null);
      setError((err as Error).message || 'the app backend did not answer');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // A hidden page must not keep polling (undefined means visible).
    if (active === false) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load, active]);

  const watched = state !== null && Object.keys(state.projects).length > 0;
  const demo = !loading && !watched;
  const graveyard = useMemo(() => buildGraveyard(watched && state ? state : demoState()), [watched, state]);

  return (
    <>
      <PageHeader
        title="Graveyard"
        subtitle="Dead dependencies in the projects Night Watch guards."
        actions={
          <button
            type="button"
            className="necro-btn"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      <GraveyardView
        graveyard={graveyard}
        demo={demo}
        loading={loading}
        error={error}
        onAskToWatch={() =>
          // An unsent draft: the user reads it, adds the path and sends it.
          openChat({
            agent: AGENT,
            autoSend: false,
            message: 'Watch this project with Night Watch: /absolute/path/to/your/project',
          })
        }
        onRaise={(p, t) =>
          openChat({
            agent: AGENT,
            autoSend: false,
            message:
              `Raise the dead: in ${p.path}, ${t.name} is ${t.verdict}. ` +
              `Use the resurrection skill to write the Kiro spec and the differential test, ` +
              `migrate on a local branch, and do not push.`,
          })
        }
      />
    </>
  );
}
