import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { CommitFileInfo, CommitInfo } from '@angkorgit/core';
import { ChevronsDownUp, ChevronsUpDown, FolderTree, List, X } from 'lucide-react';
import { Hint, Button, cn } from '@angkorgit/design-system';
import { useGraph } from '@/features/graph/store';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { ipc } from '@/core/ipc';
import { WorkingCopyPanel } from '@/features/commit/WorkingCopyPanel';
import { CommitDetails } from './CommitDetails';

export function Inspector() {
  const selectedOid = useGraph((s) => s.selectedOid);
  const repoPath = useRepo((s) => s.repo?.path);
  const fileTree = useUi((s) => s.fileTree);
  const setFileTree = useUi((s) => s.setFileTree);

  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [diffs, setDiffs] = useState<CommitFileInfo[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [diffsError, setDiffsError] = useState<string | null>(null);
  const [retrySeq, setRetrySeq] = useState(0);

  useEffect(() => {
    const { centerDiff, closeCenterDiff } = useUi.getState();
    if (centerDiff?.oid && centerDiff.oid !== selectedOid) closeCenterDiff();

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
    void ipc
      .commitFiles(repoPath, selectedOid)
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
  }, [selectedOid, repoPath, retrySeq]);

  const retry = () => setRetrySeq((n) => n + 1);

  return (
    <aside className="flex h-full flex-col bg-surface" aria-label="Inspector">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {commit || commitError ? 'Commit' : 'Working copy'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Hint label="Flat list">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Flat file list"
              className={cn(!fileTree && 'bg-surface-raised text-foreground')}
              onClick={() => setFileTree(false)}
            >
              <List className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="Folder tree">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Folder tree"
              className={cn(fileTree && 'bg-surface-raised text-foreground')}
              onClick={() => setFileTree(true)}
            >
              <FolderTree className="size-3.5" />
            </Button>
          </Hint>
          {fileTree && (
            <>
              <span className="mx-1 h-4 w-px bg-border-subtle" />
              <Hint label="Expand all folders">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand all folders"
                  onClick={() => useUi.getState().foldFileTree('expand')}
                >
                  <ChevronsUpDown className="size-3.5" />
                </Button>
              </Hint>
              <Hint label="Collapse all folders">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse all folders"
                  onClick={() => useUi.getState().foldFileTree('collapse')}
                >
                  <ChevronsDownUp className="size-3.5" />
                </Button>
              </Hint>
            </>
          )}
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
            key={commit.oid}
            commit={commit}
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
