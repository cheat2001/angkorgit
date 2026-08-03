import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Columns2, FileText, Minus, Plus, Rows3, WholeWord, X } from 'lucide-react';
import type { FileDiff } from '@angkorgit/core';
import { Badge, Button, Hint, Kbd, Separator, Spinner, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi, type CenterDiffTarget } from '@/features/ui/store';
import { DiffViewer } from './DiffViewer';

/**
 * Full-width diff view shown over the commit graph (GitKraken-style).
 * Working-copy diffs keep their stage/unstage hunk actions; Esc closes.
 */
export function DiffPanel({ target }: { target: CenterDiffTarget }) {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const { closeCenterDiff, diffView, setDiffView, wordDiff, setWordDiff, fullFileDiff, setFullFileDiff } = useUi();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);

  const path = repo?.path ?? '';
  const isWorkingCopy = target.oid === undefined;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    // "Whole file" = diff with effectively unlimited context lines.
    const context = fullFileDiff ? 10_000_000 : undefined;
    const load = async (): Promise<FileDiff | null> => {
      if (target.oid) {
        const diffs = await ipc.diffCommit(path, target.oid, context);
        return diffs.find((d) => d.path === target.path) ?? null;
      }
      return ipc.diffFile(path, target.path, target.staged ?? false, context);
    };
    void load()
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(`Could not load diff: ${(error as { message?: string }).message ?? error}`);
          setDiff(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // re-fetch working-copy diffs whenever status changes (hunk staged, etc.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, target.path, target.oid, target.staged, fullFileDiff, isWorkingCopy ? status : null]);

  const runStage = async (op: () => Promise<unknown>, label: string) => {
    try {
      await op();
      await refreshStatus();
    } catch (error) {
      toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  return (
    <motion.section
      className="flex h-full flex-col bg-background"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      aria-label={`Diff for ${target.path}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3">
        <Hint
          label={
            <span className="flex items-center gap-1">
              Back to graph <Kbd>Esc</Kbd>
            </span>
          }
        >
          <Button variant="ghost" size="icon-sm" aria-label="Close diff" onClick={closeCenterDiff}>
            <X className="size-4" />
          </Button>
        </Hint>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{target.path}</span>
        {target.oid ? (
          <Badge tone="neutral" className="font-mono">
            {target.oid.slice(0, 8)}
          </Badge>
        ) : (
          <Badge tone={target.staged ? 'success' : 'info'}>{target.staged ? 'staged' : 'unstaged'}</Badge>
        )}
        {diff && !diff.isBinary && !diff.isImage && (
          <span className="shrink-0 text-xs">
            <span className="text-success">+{diff.additions}</span>{' '}
            <span className="text-danger">−{diff.deletions}</span>
          </span>
        )}
        <Separator orientation="vertical" className="mx-1 h-4" />
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
        <Hint label={fullFileDiff ? 'Whole file shown — click for changes only' : 'Show whole file'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle whole file view"
            className={cn(fullFileDiff && 'bg-surface-raised text-primary')}
            onClick={() => setFullFileDiff(!fullFileDiff)}
          >
            <FileText className="size-3.5" />
          </Button>
        </Hint>
        {isWorkingCopy && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            {target.staged ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runStage(() => ipc.unstageFile(path, target.path), 'Unstage')}
              >
                <Minus className="size-3" /> Unstage file
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runStage(() => ipc.stageFile(path, target.path), 'Stage')}
              >
                <Plus className="size-3" /> Stage file
              </Button>
            )}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : diff ? (
          <DiffViewer
            diff={diff}
            hunkActions={
              // Hunk indices refer to the compact (3-line-context) diff the
              // engine stages against, so per-hunk staging is hidden in
              // whole-file mode — use "Stage file" instead.
              isWorkingCopy && !fullFileDiff
                ? (hunkIndex) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() =>
                        void runStage(
                          () =>
                            target.staged
                              ? ipc.unstageHunk(path, target.path, hunkIndex)
                              : ipc.stageHunk(path, target.path, hunkIndex),
                          'Hunk operation',
                        )
                      }
                    >
                      {target.staged ? (
                        <>
                          <Minus className="size-3" /> Unstage hunk
                        </>
                      ) : (
                        <>
                          <Plus className="size-3" /> Stage hunk
                        </>
                      )}
                    </Button>
                  )
                : undefined
            }
          />
        ) : (
          <p className="py-16 text-center text-sm text-faint">No diff to show — the change may already be staged or resolved.</p>
        )}
      </div>
    </motion.section>
  );
}
