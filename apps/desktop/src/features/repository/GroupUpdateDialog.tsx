import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@angkorgit/design-system';
import { shortenHome } from '@/shared/utils';
import type { GroupRepositoryResult } from './groupUpdate';

export interface GroupUpdateProgress {
  name: string;
  pull: boolean;
  total: number;
  results: GroupRepositoryResult[];
  running: boolean;
}

export function GroupUpdateDialog({ progress, onClose }: {
  progress: GroupUpdateProgress | null;
  onClose: () => void;
}) {
  if (!progress) return null;
  const { name, pull, total, results, running } = progress;
  const moved = results.filter((r) => r.changes.length > 0).length;
  const unchanged = results.filter(
    (r) => (r.status === 'ok' || r.status === 'up_to_date') && r.changes.length === 0,
  ).length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !running) onClose(); }}>
      <DialogContent
        className="max-w-2xl"
        onEscapeKeyDown={(e) => { if (running) e.preventDefault(); }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{pull ? 'Pull all (fast-forward only)' : 'Fetch all'} — {name}</DialogTitle>
          <DialogDescription>
            {pull ? 'Pulls the checked-out branch from its upstream. Repositories with local changes are skipped.' : 'Fetches every configured remote in the group.'}
          </DialogDescription>
        </DialogHeader>
        <div className="mb-3 flex items-center gap-2 text-sm" role="status" aria-live="polite">
          {running && <Spinner className="size-4" />}
          <span>{running ? `${results.length} of ${total} repositories complete` : `${total} repositories complete`} · {moved} updated · {unchanged} {pull ? 'up to date' : 'unchanged'} · {skipped} skipped · {failed} failed</span>
        </div>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1" data-group-update-results>
          {results.map((result) => (
            <div key={result.repo.path} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-semibold" title={result.repo.path}>{result.repo.name}</span>
                <Badge>{result.status === 'failed' ? 'Failed' : result.status === 'skipped' ? 'Skipped' : result.changes.length > 0 ? 'Updated' : pull ? 'Up to date' : 'Fetched'}</Badge>
              </div>
              <p className="break-all text-xs text-muted">{shortenHome(result.repo.path)}</p>
              <p className="mt-1 break-words">{result.message}</p>
              {result.changes.map((change) => (
                <p key={change.name} className="mt-1 break-all font-mono text-xs text-muted">
                  {change.name.replace(/^refs\/(remotes|heads|tags)\//, '')}: {change.oldOid?.slice(0, 7) ?? 'new'} → {change.newOid?.slice(0, 7) ?? 'deleted'}
                  {change.commits !== null && ` (${change.commits} commit${change.commits === 1 ? '' : 's'})`}
                </p>
              ))}
              {!pull && result.status === 'ok' && result.changes.length === 0 && <p className="text-xs text-muted">No refs moved.</p>}
            </div>
          ))}
        </div>
        <DialogFooter><Button disabled={running} onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
