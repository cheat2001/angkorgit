import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, GitBranch, Pencil, ZoomIn } from 'lucide-react';
import { Hint, cn } from '@angkorgit/design-system';
import { appVersion } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useSettings } from '@/features/settings/store';

/**
 * Slim footer: live repository facts on the left (branch, ahead/behind,
 * working-copy state), app controls on the right (zoom, version + update
 * check). Everything a glance should answer without opening a panel.
 */
export function StatusBar() {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const zoom = useSettings((s) => s.zoom);
  const zoomReset = useSettings((s) => s.zoomReset);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void appVersion().then(setVersion);
  }, []);

  const changes = status?.files.length ?? 0;
  const branch = repo?.isDetached ? `detached @ ${repo.headOid?.slice(0, 8) ?? '?'}` : repo?.headBranch;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border-subtle bg-surface px-3 text-[11px] text-muted">
      <span className="flex min-w-0 items-center gap-1.5">
        <GitBranch className="size-3 shrink-0" />
        <span className="max-w-56 truncate font-mono">{branch ?? '—'}</span>
      </span>
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="flex items-center gap-1.5">
          {status.ahead > 0 && (
            <Hint label={`${status.ahead} commit${status.ahead === 1 ? '' : 's'} to push`}>
              <span className="flex items-center gap-0.5 text-success">
                <ArrowUp className="size-3" />
                {status.ahead}
              </span>
            </Hint>
          )}
          {status.behind > 0 && (
            <Hint label={`${status.behind} commit${status.behind === 1 ? '' : 's'} to pull`}>
              <span className="flex items-center gap-0.5 text-info">
                <ArrowDown className="size-3" />
                {status.behind}
              </span>
            </Hint>
          )}
        </span>
      )}
      <span className={cn('flex items-center gap-1.5', changes > 0 && 'text-primary')}>
        {changes > 0 ? <Pencil className="size-3" /> : <Check className="size-3 text-success" />}
        {changes > 0 ? `${changes} change${changes === 1 ? '' : 's'}` : 'Clean'}
      </span>

      <span className="flex-1" />

      {Math.round(zoom * 100) !== 100 && (
        <Hint label="Reset zoom">
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1 hover:bg-surface-raised hover:text-foreground"
            onClick={zoomReset}
          >
            <ZoomIn className="size-3" />
            {Math.round(zoom * 100)}%
          </button>
        </Hint>
      )}
      <Hint label="Check for updates">
        <button
          type="button"
          className="rounded px-1 hover:bg-surface-raised hover:text-foreground"
          onClick={() =>
            void import('@/features/updater/check').then(({ checkForUpdates }) =>
              checkForUpdates({ silent: false }),
            )
          }
        >
          {version ? `v${version}` : 'AngKorGit'}
        </button>
      </Hint>
    </footer>
  );
}
