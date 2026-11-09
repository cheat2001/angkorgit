import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { CommitFileInfo, CommitInfo } from '@angkorgit/core';
import { FolderOpen, FolderTree, List, Search, X } from 'lucide-react';
import { Hint, Button, cn } from '@angkorgit/design-system';
import { useGraph } from '@/features/graph/store';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { ipc } from '@/core/ipc';
import { WorkingCopyPanel } from '@/features/commit/WorkingCopyPanel';
import { CommitDetails } from './CommitDetails';

export function Inspector() {
  const selectedOid = useGraph((s) => s.selectedOid);
  const compare = useGraph((s) => s.compare);
  const repoPath = useRepo((s) => s.repo?.path);
  const fileView = useUi((s) => s.fileView);
  const setFileView = useUi((s) => s.setFileView);

  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [diffs, setDiffs] = useState<CommitFileInfo[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [diffsError, setDiffsError] = useState<string | null>(null);
  const [retrySeq, setRetrySeq] = useState(0);
  const [compareFrom, setCompareFrom] = useState<CommitInfo | null>(null);

  useEffect(() => {
    const { centerDiff, closeCenterDiff } = useUi.getState();
    const shownOid = compare?.to ?? selectedOid;
    if (centerDiff?.oid && (centerDiff.oid !== shownOid || (centerDiff.base ?? null) !== (compare?.from ?? null))) {
      closeCenterDiff();
    }

    if (compare && repoPath) {
      const known = (oid: string) => useGraph.getState().commits.find((c) => c.oid === oid) ?? null;
      const load = (oid: string) => {
        const local = known(oid);
        return local ? Promise.resolve(local) : ipc.commitInfo(repoPath, oid);
      };
      setCommit(known(compare.to));
      setCompareFrom(known(compare.from));
      setDiffs([]);
      setCommitError(null);
      setDiffsError(null);
      setLoadingDiffs(true);
      let cancelled = false;
      void Promise.all([load(compare.from), load(compare.to)])
        .then(([from, to]) => {
          if (cancelled) return;
          setCompareFrom(from);
          setCommit(to);
        })
        .catch((error) => {
          if (!cancelled) setCommitError(String((error as { message?: string }).message ?? error));
        });
      void ipc
        .commitFiles(repoPath, compare.to, compare.from)
        .then((result) => {
          if (!cancelled) setDiffs(result);
        })
        .catch((error) => {
          if (!cancelled) setDiffsError(String((error as { message?: string }).message ?? error));
        })
        .finally(() => {
          if (!cancelled) setLoadingDiffs(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setCompareFrom(null);

    if (!selectedOid || !repoPath) {
      setCommit(null);
      setDiffs([]);
      setCommitError(null);
      setDiffsError(null);
      return;
    }
    const local = useGraph.getState().commits.find((c) => c.oid === selectedOid) ?? null;
    setCommit(local);
    setDiffs([]);
    setCommitError(null);
    setDiffsError(null);
    setLoadingDiffs(true);
    let cancelled = false;
    if (!local) {
      void ipc
        .commitInfo(repoPath, selectedOid)
        .then((info) => {
          if (!cancelled) setCommit(info);
        })
        .catch((error) => {
          if (cancelled) return;
          const message = String((error as { message?: string }).message ?? error);
          toast.error(`Could not load commit: ${message}`);
          setCommitError(message);
        });
    }
    const stash = useRepo.getState().stashes.find((s) => s.oid === selectedOid);
    void (stash ? ipc.stashFiles(repoPath, stash.index) : ipc.commitFiles(repoPath, selectedOid))
      .then((result) => {
        if (!cancelled) setDiffs(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setDiffsError(String((error as { message?: string }).message ?? error));
      })
      .finally(() => {
        if (!cancelled) setLoadingDiffs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOid, compare, repoPath, retrySeq]);

  const retry = () => setRetrySeq((n) => n + 1);
  const fileFilterOpen = useUi((s) => s.fileFilterOpen);
  const setFileFilterOpen = useUi((s) => s.setFileFilterOpen);
  const isStash = useRepo((s) => !compare && !!selectedOid && s.stashes.some((entry) => entry.oid === selectedOid));

  return (
    <aside className="flex h-full flex-col bg-surface" aria-label="Inspector">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {compare ? 'Compare' : commit || commitError ? (isStash ? 'Stash' : 'Commit') : 'Working copy'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Hint label={fileFilterOpen ? 'Hide file filter' : 'Filter files'}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={fileFilterOpen ? 'Hide file filter' : 'Filter files'}
              aria-pressed={fileFilterOpen}
              className={cn(fileFilterOpen && 'bg-surface-raised text-foreground')}
              onClick={() => setFileFilterOpen(!fileFilterOpen)}
            >
              <Search className="size-3.5" />
            </Button>
          </Hint>
          <span className="mx-1 h-4 w-px bg-border-subtle" />
          <Hint label="Flat list">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Flat file list"
              aria-pressed={fileView === 'list'}
              className={cn(fileView === 'list' && 'bg-surface-raised text-foreground')}
              onClick={() => setFileView('list')}
            >
              <List className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="Folder tree">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Folder tree"
              aria-pressed={fileView === 'tree'}
              className={cn(fileView === 'tree' && 'bg-surface-raised text-foreground')}
              onClick={() => setFileView('tree')}
            >
              <FolderTree className="size-3.5" />
            </Button>
          </Hint>
          <Hint label={commit || commitError ? 'All files at this commit' : 'All files in the working copy'}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="All files"
              aria-pressed={fileView === 'all'}
              className={cn(fileView === 'all' && 'bg-surface-raised text-foreground')}
              onClick={() => setFileView('all')}
            >
              <FolderOpen className="size-3.5" />
            </Button>
          </Hint>
          {(commit || commitError) && (
            <>
              <span className="mx-1 h-4 w-px bg-border-subtle" />
              <Hint label="Back to working copy">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Back to working copy"
                  onClick={() => {
                    useUi.getState().closeCenterDiff();
                    useGraph.getState().select(null);
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </Hint>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {commit ? (
          <CommitDetails
            key={compare ? `${compare.from}..${compare.to}` : commit.oid}
            commit={commit}
            compareFrom={compare ? compareFrom : undefined}
            diffs={diffs}
            loading={loadingDiffs}
            error={diffsError}
            onRetry={retry}
          />
        ) : commitError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-xs text-danger [overflow-wrap:anywhere]">
              Could not load commit: {commitError}
            </p>
            <Button variant="ghost" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : (
          <WorkingCopyPanel />
        )}
      </div>
    </aside>
  );
}
