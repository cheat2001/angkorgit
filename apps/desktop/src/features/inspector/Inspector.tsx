import { useEffect, useState } from 'react';
import type { CommitInfo, FileDiff } from '@angkorgit/core';
import { Columns2, Rows3, WholeWord } from 'lucide-react';
import { Hint, Button, Separator, cn } from '@angkorgit/design-system';
import { useGraph } from '@/features/graph/store';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { ipc } from '@/core/ipc';
import { WorkingCopyPanel } from '@/features/commit/WorkingCopyPanel';
import { CommitDetails } from './CommitDetails';

export function Inspector() {
  const selectedOid = useGraph((s) => s.selectedOid);
  const commits = useGraph((s) => s.commits);
  const repo = useRepo((s) => s.repo);
  const { diffView, setDiffView, wordDiff, setWordDiff } = useUi();

  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);

  useEffect(() => {
    const { centerDiff, closeCenterDiff } = useUi.getState();
    if (centerDiff?.oid && centerDiff.oid !== selectedOid) closeCenterDiff();

    if (!selectedOid || !repo) {
      setCommit(null);
      setDiffs([]);
      return;
    }
    const local = commits.find((c) => c.oid === selectedOid) ?? null;
    setCommit(local);
    setLoadingDiffs(true);
    let cancelled = false;
    void ipc
      .diffCommit(repo.path, selectedOid)
      .then((result) => {
        if (!cancelled) setDiffs(result);
      })
      .catch(() => {
        if (!cancelled) setDiffs([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDiffs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOid, commits, repo]);

  return (
    <aside className="flex h-full flex-col bg-surface" aria-label="Inspector">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {commit ? 'Commit' : 'Working copy'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Hint label="Inline diff">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Inline diff"
              className={cn(diffView === 'inline' && 'bg-surface-raised text-foreground')}
              onClick={() => setDiffView('inline')}
            >
              <Rows3 className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="Side-by-side diff">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Side-by-side diff"
              className={cn(diffView === 'split' && 'bg-surface-raised text-foreground')}
              onClick={() => setDiffView('split')}
            >
              <Columns2 className="size-3.5" />
            </Button>
          </Hint>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <Hint label={wordDiff ? 'Word diff on' : 'Word diff off'}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle word diff"
              className={cn(wordDiff && 'bg-surface-raised text-primary')}
              onClick={() => setWordDiff(!wordDiff)}
            >
              <WholeWord className="size-3.5" />
            </Button>
          </Hint>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {commit ? (
          <CommitDetails commit={commit} diffs={diffs} loading={loadingDiffs} />
        ) : (
          <WorkingCopyPanel />
        )}
      </div>
    </aside>
  );
}
