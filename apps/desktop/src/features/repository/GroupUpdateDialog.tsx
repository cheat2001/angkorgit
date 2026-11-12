import { AlertTriangle } from 'lucide-react';
import { cleanCliOutput } from '@angkorgit/core';
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
import { classify, type GroupResultKind, type GroupRepositoryResult } from './groupUpdate';

export interface GroupUpdateProgress {
  runId: string;
  name: string;
  pull: boolean;
  skipHooks?: boolean;
  total: number;
  results: GroupRepositoryResult[];
  running: boolean;
  cancelling: boolean;
}

export function GroupUpdateDialog({ progress, onClose, onCancel }: {
  progress: GroupUpdateProgress | null;
  onClose: () => void;
  onCancel: () => void;
}) {
  if (!progress) return null;
  const { name, pull, skipHooks, total, results, running, cancelling } = progress;
  const counts: Record<GroupResultKind, number> = { updated: 0, unchanged: 0, skipped: 0, failed: 0, partial: 0, cancelled: 0 };
  for (const result of results) counts[classify(result)]++;
  const hookWarnings = results.reduce((sum, result) => sum + (result.hookWarnings?.length ?? 0), 0);
  const labels: Record<GroupResultKind, string> = {
    updated: 'Updated', unchanged: pull ? 'Up to date' : 'Unchanged', skipped: 'Skipped',
    failed: 'Failed', partial: 'Partial', cancelled: 'Cancelled',
  };
  const tones: Record<GroupResultKind, 'success' | 'danger' | 'primary' | 'neutral'> = {
    updated: 'success', unchanged: 'neutral', skipped: 'neutral',
    failed: 'danger', partial: 'primary', cancelled: 'neutral',
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !running) onClose(); }}>
      <DialogContent
        className="max-w-2xl outline-none"
        onEscapeKeyDown={(e) => { if (running) e.preventDefault(); }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{pull ? `Pull all${skipHooks ? ' without hooks' : ''} (fast-forward only)` : 'Fetch all'} — {name}</DialogTitle>
          <DialogDescription>
            {pull ? 'Fast-forwards the checked-out branch from its upstream, preserving unrelated local changes.' : 'Fetches every configured remote in the group.'}
            {pull && skipHooks && ' The post-merge hooks do not run.'}
          </DialogDescription>
        </DialogHeader>
        <div className="mb-3 flex items-center gap-2 overflow-x-auto whitespace-nowrap text-xs" role="status" aria-live="polite">
          {running && <Spinner className="size-4 shrink-0" />}
          <span className="shrink-0">{cancelling ? 'Cancelling…' : running ? `${results.length} of ${total} repositories complete` : `${total} repositories complete`} · {counts.updated} updated · {counts.unchanged} {pull ? 'up to date' : 'unchanged'} · {counts.skipped} skipped · {counts.failed} failed{counts.partial > 0 && ` · ${counts.partial} partial`}{counts.cancelled > 0 && ` · ${counts.cancelled} cancelled`}{hookWarnings > 0 && ` · ${hookWarnings} hook warning${hookWarnings === 1 ? '' : 's'}`}</span>
        </div>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1" data-group-update-results>
          {results.map((result) => (
            <div key={result.repo.path} className="text-sm" data-group-update-row>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-semibold" title={result.repo.path}>{result.repo.name}</span>
                <Badge tone={tones[classify(result)]}>{labels[classify(result)]}</Badge>
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
              {result.hookWarnings?.map((warning) => (
                <div key={`${warning.hook}:${warning.timedOut}:${warning.status}`} className="mt-1.5 rounded-md bg-surface-raised px-2.5 py-1.5 text-xs" data-group-hook-warning={warning.hook}>
                  <p className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="break-words">
                      {warning.message} {warning.status === null ? 'The pull stands.' : 'Git ignores its exit code, so the pull stands.'}
                    </span>
                  </p>
                  {warning.output && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted">Hook output</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere]" data-hook-output>
                        {cleanCliOutput(warning.output)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          {running && <Button variant="ghost" disabled={cancelling} onClick={onCancel}>Cancel run</Button>}
          <Button disabled={running} onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
