import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, GitBranch, GitPullRequest, Pencil, ZoomIn } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Hint,
  cn,
} from '@angkorgit/design-system';
import { appVersion, openExternal } from '@/core/ipc';
import { useForge } from '@/features/forge/store';
import { useRepo } from '@/features/repository/store';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';
import { capCount, currentPullRequestUrl } from '@/shared/utils';

const ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

export function StatusBar() {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const remotes = useRepo((s) => s.remotes);
  const zoom = useSettings((s) => s.zoom);
  const setZoom = useSettings((s) => s.setZoom);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void appVersion().then(setVersion);
  }, []);

  const changes = status?.files.length ?? 0;
  const branch = repo?.isDetached ? `detached @ ${repo.headOid?.slice(0, 8) ?? '?'}` : repo?.headBranch;
  const forgeRemote = useForge((s) => s.remote);
  const forgeRemoteUrl = useForge((s) => s.remoteUrl);
  const prUrl = currentPullRequestUrl(repo, forgeRemoteUrl ?? remotes[0]?.url);
  const forgeAccount = useForge((s) => s.hasAccount);
  const openDialog = useUi((s) => s.openDialog);
  const createInApp = !!forgeRemote && forgeAccount;
  const prNoun = forgeRemote?.kind === 'gitlab' ? 'merge request' : 'pull request';

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
                {capCount(status.ahead)}
              </span>
            </Hint>
          )}
          {status.behind > 0 && (
            <Hint label={`${status.behind} commit${status.behind === 1 ? '' : 's'} to pull`}>
              <span className="flex items-center gap-0.5 text-info">
                <ArrowDown className="size-3" />
                {capCount(status.behind)}
              </span>
            </Hint>
          )}
        </span>
      )}
      <span className={cn('flex items-center gap-1.5', changes > 0 && 'text-primary')}>
        {changes > 0 ? <Pencil className="size-3" /> : <Check className="size-3 text-success" />}
        {changes > 0 ? `${changes} change${changes === 1 ? '' : 's'}` : 'Clean'}
      </span>
      {prUrl && (
        <Hint
          label={
            createInApp
              ? `Create a ${prNoun} for ${repo?.headBranch} without leaving AngKorGit`
              : `Open a pre-filled pull request page for ${repo?.headBranch}`
          }
        >
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1 hover:bg-surface-raised hover:text-foreground"
            onClick={() =>
              createInApp ? openDialog('createPullRequest') : void openExternal(prUrl)
            }
          >
            <GitPullRequest className="size-3" />
            Create {prNoun}
          </button>
        </Hint>
      )}

      <span className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1 hover:bg-surface-raised hover:text-foreground"
            aria-label="UI zoom"
          >
            <ZoomIn className="size-3" />
            {Math.round(zoom * 100)}%
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          {ZOOM_LEVELS.map((level) => (
            <DropdownMenuItem key={level} onClick={() => setZoom(level / 100)}>
              <Check className={cn('size-3.5', Math.round(zoom * 100) !== level && 'invisible')} />
              {level}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
