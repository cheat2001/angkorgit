import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Columns2, Copy, FileText, History, Rows3, WholeWord, WrapText, X } from 'lucide-react';
import type { CommitInfo, FileDiff } from '@angkorgit/core';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Hint,
  Kbd,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { Avatar } from '@/components/Avatar';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { timeAgo } from '@/shared/utils';
import { DiffViewer } from '@/features/diff/DiffViewer';
import { DiffMinimap } from '@/features/diff/DiffMinimap';
import { useDiffFind } from '@/features/diff/diffSearch';
import type { LineMenuInfo } from '@/features/diff/VirtualDiff';

export function FileHistoryPanel({ file }: { file: string }) {
  const repo = useRepo((s) => s.repo);
  const {
    closeFileHistory,
    diffView,
    setDiffView,
    wordDiff,
    setWordDiff,
    wrapLines,
    setWrapLines,
    fullFileDiff,
    setFullFileDiff,
  } = useUi();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { findBar, search } = useDiffFind(
    diff && !diff.isBinary && !diff.isImage ? diff : null,
    scrollRef,
  );
  const [lineMenu, setLineMenu] = useState<{
    x: number;
    y: number;
    info: LineMenuInfo;
    selection: string;
  } | null>(null);

  const path = repo?.path ?? '';

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setCommits(null);
    setSelected(null);
    void ipc
      .fileHistory(path, file, 200)
      .then((page) => {
        if (cancelled) return;
        setCommits(page.commits);
        setHasMore(page.hasMore);
        setSelected(page.commits[0]?.oid ?? null);
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

  useEffect(() => {
    if (!path || !selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    const context = fullFileDiff ? 10_000_000 : undefined;
    void ipc
      .diffCommit(path, selected, context)
      .then((diffs) => {
        if (cancelled) return;
        setDiff(diffs.find((d) => d.path === file) ?? null);
        scrollRef.current?.scrollTo({ top: 0 });
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(`Could not load diff: ${(error as { message?: string }).message ?? error}`);
        setDiff(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, selected, file, fullFileDiff]);

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
        {diff && !diff.isBinary && !diff.isImage && (
          <span className="shrink-0 text-xs">
            <span className="text-success">+{diff.additions}</span>{' '}
            <span className="text-danger">−{diff.deletions}</span>
          </span>
        )}
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
        <Hint label={wrapLines ? 'Lines wrapped — click for horizontal scroll' : 'Wrap long lines'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle line wrapping"
            className={cn(wrapLines && 'bg-surface-raised text-primary')}
            onClick={() => setWrapLines(!wrapLines)}
          >
            <WrapText className="size-3.5" />
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
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface">
          {commits === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : commits.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-faint">
              No commits touch this file on the current branch.
            </p>
          ) : (
            <ul>
              {commits.map((commit) => (
                <li key={commit.oid}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left',
                      selected === commit.oid
                        ? 'border-l-2 border-l-primary bg-surface-raised'
                        : 'border-l-2 border-l-transparent hover:bg-surface-raised/60',
                    )}
                    onClick={() => setSelected(commit.oid)}
                  >
                    <Avatar name={commit.author.name} email={commit.author.email} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">{commit.summary}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {commit.author.name} · {timeAgo(commit.author.time)}
                      </span>
                    </span>
                    <Badge tone="neutral" className="shrink-0 font-mono text-[10px]">
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

        <div className="relative flex min-h-0 min-w-0 flex-1">
          {findBar}
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {diffLoading ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : diff ? (
              <DiffViewer
                diff={diff}
                scrollRef={scrollRef}
                search={search}
                onLineContextMenu={(e, info) => {
                  e.preventDefault();
                  setLineMenu({
                    x: e.clientX,
                    y: e.clientY,
                    info,
                    selection: window.getSelection()?.toString() ?? '',
                  });
                }}
              />
            ) : (
              <p className="py-16 text-center text-sm text-faint">
                {selected
                  ? 'No changes for this file in that commit (it may have been renamed).'
                  : 'Select a commit to see its changes.'}
              </p>
            )}
          </div>
          {diff && !diffLoading && (
            <DiffMinimap diff={diff} view={diffView} scrollRef={scrollRef} />
          )}
        </div>
      </div>

      {lineMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setLineMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: lineMenu.x, top: lineMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            {lineMenu.selection && (
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(lineMenu.selection);
                  toast.success('Copied');
                }}
              >
                <Copy /> Copy
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(lineMenu.info.line.content);
                toast.success('Line copied');
              }}
            >
              <Copy /> Copy line
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </motion.section>
  );
}
