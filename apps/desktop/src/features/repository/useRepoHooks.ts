import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoHooks } from '@angkorgit/core';
import { ipc } from '@/core/ipc';
import { useRepo } from './store';

const NONE: RepoHooks = { found: [], inWorktree: false };

export function useRepoHooks(path: string | null | undefined): RepoHooks & { refresh: () => void } {
  const statusVersion = useRepo((s) => s.statusVersion);
  const [checks, setChecks] = useState(0);
  const [found, setFound] = useState<{ path: string; hooks: RepoHooks } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void ipc
      .repoHooks(path)
      .then((hooks) => {
        if (!cancelled) setFound({ path, hooks });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, statusVersion, checks]);
  const refresh = useCallback(() => setChecks((n) => n + 1), []);
  const hooks = found && found.path === path ? found.hooks : NONE;
  return useMemo(() => ({ ...hooks, refresh }), [hooks, refresh]);
}
