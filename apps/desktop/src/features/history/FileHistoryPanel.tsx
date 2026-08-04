import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { History, X } from 'lucide-react';
import type { CommitInfo } from '@angkorgit/core';
import { Badge, Button, Hint, Kbd, Spinner } from '@angkorgit/design-system';
import { Avatar } from '@/components/Avatar';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { timeAgo } from '@/shared/utils';

/**
 * Center-area view listing every commit that changed one file — the
 * "who touched this?" answer. Clicking a commit opens its diff for the file.
 */
export function FileHistoryPanel({ file }: { file: string }) {
  const repo = useRepo((s) => s.repo);
  const { closeFileHistory, openCenterDiff } = useUi();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const path = repo?.path ?? '';

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setCommits(null);
    void ipc
      .fileHistory(path, file, 200)
      .then((page) => {
        if (cancelled) return;
        setCommits(page.commits);
        setHasMore(page.hasMore);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(`File history failed: ${(error as { message?: string }).message ?? error}`);
        setCommits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path, file]);

  return (
    <motion.section
      className="flex h-full flex-col bg-background"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      aria-label={`History of ${file}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3">
        <Hint
          label={
            <span className="flex items-center gap-1">
              Back to graph <Kbd>Esc</Kbd>
            </span>
          }
        >
          <Button variant="ghost" size="icon-sm" aria-label="Close file history" onClick={closeFileHistory}>
            <X className="size-4" />
          </Button>
        </Hint>
        <History className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file}</span>
        {commits && (
          <span className="shrink-0 text-xs text-muted">
            {commits.length}
            {hasMore ? '+' : ''} commit{commits.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {commits === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : commits.length === 0 ? (
          <p className="py-16 text-center text-sm text-faint">
            No commits touch this file on the current branch.
          </p>
        ) : (
          <ul>
            {commits.map((commit) => (
              <li key={commit.oid}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-left hover:bg-surface-raised/60"
                  onClick={() => openCenterDiff({ path: file, oid: commit.oid })}
                >
                  <Avatar name={commit.author.name} email={commit.author.email} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{commit.summary}</span>
                    <span className="block truncate text-xs text-muted">
                      {commit.author.name} · {timeAgo(commit.author.time)}
                    </span>
                  </span>
                  <Badge tone="neutral" className="shrink-0 font-mono">
                    {commit.shortOid}
                  </Badge>
                </button>
              </li>
            ))}
            {hasMore && (
              <li className="py-3 text-center text-xs text-faint">
                Showing the 200 most recent changes.
              </li>
            )}
          </ul>
        )}
      </div>
    </motion.section>
  );
}
