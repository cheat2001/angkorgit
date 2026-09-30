import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Columns2, Copy, FileCheck, FileText, GitCommitHorizontal, History, MousePointerClick, Pencil, Rows3, TextSelect, UserRoundSearch, WholeWord, WrapText, X } from 'lucide-react';
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
import { SettingEmpty } from '@/features/settings/SettingCard';
import { basename } from '@/shared/utils';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { timeAgo } from '@/shared/utils';
import { captureSelectionRanges, useKeepSelection } from '@/shared/useKeepSelection';
import { DiffViewer } from '@/features/diff/DiffViewer';
import { changeBlocks, DiffMinimap } from '@/features/diff/DiffMinimap';
import { ChangeNavButtons, useChangeJump } from '@/features/diff/changeNav';
import { BlameView } from '@/features/blame/BlameView';
import { useDiffFind } from '@/features/diff/diffSearch';
import { useDiffSelectAll } from '@/features/diff/diffCopy';
import { diffSelectionText } from '@/features/diff/diffSelection';
import type { LineMenuInfo } from '@/features/diff/VirtualDiff';

const HISTORY_PAGE = 500;
const COMMIT_ROW_ESTIMATE = 54;
const WORKING_COPY = 'working-copy';

function VirtualCommitList({
  commits,
  scrollRef,
  renderRow,
}: {
  commits: CommitInfo[];
  scrollRef: React.RefObject<HTMLDivElement>;
  renderRow: (commit: CommitInfo) => React.ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COMMIT_ROW_ESTIMATE,
    getItemKey: (index) => commits[index].oid,
    overscan: 12,
  });
  return (
    <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <li
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${item.start}px)` }}
        >
          {renderRow(commits[item.index])}
        </li>
      ))}
    </ul>
  );
}

export function FileHistoryPanel({ file }: { file: string }) {
  const repo = useRepo((s) => s.repo);
  const closeFileHistory = useUi((s) => s.closeFileHistory);
  const preset = useUi((s) => s.fileHistoryPreset);
  const [pane, setPane] = useState<'diff' | 'blame'>(() => useUi.getState().fileHistoryPreset?.pane ?? 'diff');
  const pendingRev = useRef<string | null>(null);
  const diffView = useUi((s) => s.diffView);
  const setDiffView = useUi((s) => s.setDiffView);
  const wordDiff = useUi((s) => s.wordDiff);
  const setWordDiff = useUi((s) => s.setWordDiff);
  const ignoreWhitespace = useUi((s) => s.ignoreWhitespace);
  const wrapLines = useUi((s) => s.wrapLines);
  const setWrapLines = useUi((s) => s.setWrapLines);
  const fullFileDiff = useUi((s) => s.fullFileDiff);
  const setFullFileDiff = useUi((s) => s.setFullFileDiff);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const historySeq = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const textDiff = diff && !diff.isBinary && !diff.isImage ? diff : null;
  const blocks = useMemo(() => (textDiff ? changeBlocks(textDiff, diffView) : []), [textDiff, diffView]);
  const jumpChange = useChangeJump(blocks, scrollRef);
  const { findBar, search } = useDiffFind(textDiff, scrollRef);
  const { selectAllOverlay, selectSide } = useDiffSelectAll(textDiff, scrollRef);
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number; commit: CommitInfo } | null>(null);
  const openCommit = (commit: CommitInfo) => {
    const path = repo?.path;
    if (!path) return;
    closeFileHistory();
    void useGraph
      .getState()
      .revealCommit(path, commit.oid)
      .then((found) => {
        if (!found) toast.error(`${commit.shortOid} is not in the current graph`);
      });
  };
  const openCommitOid = (oid: string) => {
    const path = repo?.path;
    if (!path) return;
    closeFileHistory();
    void useGraph
      .getState()
      .revealCommit(path, oid)
      .then((found) => {
        if (!found) toast.error(`${oid.slice(0, 7)} is not in the current graph`);
      });
  };
  const [lineMenu, setLineMenu] = useState<{
    x: number;
    y: number;
    info: LineMenuInfo;
    selection: string;
    ranges: Range[];
  } | null>(null);
  useKeepSelection(lineMenu?.ranges ?? null);

  const path = repo?.path ?? '';

  useEffect(() => {
    if (!preset) return;
    const rev = preset.rev ?? WORKING_COPY;
    pendingRev.current = rev;
    setPane(preset.pane);
    setSelected(rev);
    useUi.getState().clearFileHistoryPreset();
  }, [preset]);

  useEffect(() => {
    if (!path) return;
    const seq = ++historySeq.current;
    setCommits(null);
    setHistoryError(null);
    setSelected(null);
    setHasMore(false);
    setLoadingMore(false);
    void ipc
      .fileHistory(path, file, HISTORY_PAGE)
      .then((page) => {
        if (seq !== historySeq.current) return;
        setCommits(page.commits);
        setHasMore(page.hasMore);
        setSelected(pendingRev.current ?? page.commits[0]?.oid ?? null);
        pendingRev.current = null;
      })
      .catch((error) => {
        if (seq !== historySeq.current) return;
        setHistoryError((error as { message?: string }).message ?? String(error));
      });
    return () => {
      historySeq.current++;
    };
  }, [path, file, historyAttempt]);

  const loadOlder = () => {
    if (!path || !commits || loadingMore) return;
    const seq = historySeq.current;
    setLoadingMore(true);
    void ipc
      .fileHistory(path, file, HISTORY_PAGE, commits.length)
      .then((page) => {
        if (seq !== historySeq.current) return;
        setCommits([...commits, ...page.commits]);
        setHasMore(page.hasMore);
      })
      .catch((error) => {
        if (seq !== historySeq.current) return;
        toast.error(`File history failed: ${(error as { message?: string }).message ?? error}`);
      })
      .finally(() => {
        if (seq === historySeq.current) setLoadingMore(false);
      });
  };

  useEffect(() => {
    if (!path || !selected || pane === 'blame') {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    const context = fullFileDiff ? 10_000_000 : undefined;
    const request =
      selected === WORKING_COPY
        ? ipc.diffFile(path, file, false, context, ignoreWhitespace).then((d) => (d.hunks.length > 0 ? d : null))
        : ipc
            .diffCommit(path, selected, context, ignoreWhitespace)
            .then((diffs) => diffs.find((d) => d.path === file) ?? null);
    void request
      .then((found) => {
        if (cancelled) return;
        setDiff(found);
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
  }, [path, selected, file, fullFileDiff, ignoreWhitespace, pane]);

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
        <div className="flex items-center rounded-md border border-border-subtle p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2', pane === 'diff' && 'bg-surface-raised text-foreground')}
            aria-pressed={pane === 'diff'}
            aria-label="Diff view"
            onClick={() => setPane('diff')}
          >
            Diff
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2', pane === 'blame' && 'bg-surface-raised text-foreground')}
            aria-pressed={pane === 'blame'}
            aria-label="Blame view"
            onClick={() => setPane('blame')}
          >
            <UserRoundSearch className="size-3.5" />
            Blame
          </Button>
        </div>
        {pane === 'diff' && (
          <>
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
        <ChangeNavButtons blocks={blocks} onJump={jumpChange} />
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={listScrollRef} className="w-72 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface">
          {historyError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="text-sm text-danger">Could not load file history: {historyError}</p>
              <Button variant="ghost" size="sm" onClick={() => setHistoryAttempt((n) => n + 1)}>
                Retry
              </Button>
            </div>
          ) : commits === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : commits.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-faint">
              No commits touch this file on the current branch.
            </p>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                data-working-copy-row
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left',
                  selected === WORKING_COPY
                    ? 'border-l-2 border-l-primary bg-surface-raised'
                    : 'border-l-2 border-l-transparent hover:bg-surface-raised/60',
                )}
                onClick={() => setSelected(WORKING_COPY)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(WORKING_COPY);
                  }
                }}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Pencil className="size-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground">Working copy</span>
                  <span className="block truncate text-[11px] text-muted">The file as it is on disk right now</span>
                </span>
              </div>
              <VirtualCommitList
                commits={commits}
                scrollRef={listScrollRef}
                renderRow={(commit) => (
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'group flex w-full cursor-pointer items-start gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left',
                      selected === commit.oid
                        ? 'border-l-2 border-l-primary bg-surface-raised'
                        : 'border-l-2 border-l-transparent hover:bg-surface-raised/60',
                    )}
                    onClick={() => setSelected(commit.oid)}
                    onDoubleClick={() => openCommit(commit)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(commit.oid);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCommitMenu({ x: e.clientX, y: e.clientY, commit });
                    }}
                  >
                    <Avatar name={commit.author.name} email={commit.author.email} oid={commit.oid} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">{commit.summary}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {commit.author.name} · {timeAgo(commit.author.time)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone="neutral" className="font-mono text-[10px]">
                        {commit.shortOid}
                      </Badge>
                      <Hint label="Open this commit in the graph with all its files">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Open commit ${commit.shortOid}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCommit(commit);
                          }}
                        >
                          <GitCommitHorizontal className="size-3.5" />
                        </Button>
                      </Hint>
                    </span>
                  </div>
                )}
              />
              {hasMore && (
                <div className="py-2 text-center">
                  <Button variant="ghost" size="sm" disabled={loadingMore} onClick={loadOlder}>
                    {loadingMore ? <Spinner className="size-3.5" /> : 'Show older changes'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1">
          {findBar}
          {selectAllOverlay}
          {pane === 'blame' ? (
            <BlameView
              file={file}
              rev={selected === WORKING_COPY ? null : selected}
              onOpenCommit={openCommitOid}
              onBlameAt={setSelected}
              onResolvedRev={setSelected}
            />
          ) : (
            <>
          <div ref={scrollRef} data-history-diff-scroller className="min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                    selection: diffSelectionText(scrollRef.current) ?? window.getSelection()?.toString() ?? '',
                    ranges: captureSelectionRanges(),
                  });
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <div className="w-full max-w-sm">
                  {selected === WORKING_COPY ? (
                    <SettingEmpty
                      icon={<FileCheck className="size-4" />}
                      title="No uncommitted changes"
                      description={`${basename(file)} on disk matches the last commit.`}
                    />
                  ) : selected ? (
                    <SettingEmpty
                      icon={<FileText className="size-4" />}
                      title="Nothing changed in this commit"
                      description={`This commit did not touch ${basename(file)}. It may have been renamed here, or the change lives in another file.`}
                    />
                  ) : (
                    <SettingEmpty
                      icon={<MousePointerClick className="size-4" />}
                      title="Pick a commit"
                      description="Select a commit on the left to see what it changed in this file."
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          {diff && !diffLoading && (
            <DiffMinimap diff={diff} view={diffView} scrollRef={scrollRef} />
          )}
            </>
          )}
        </div>
      </div>

      {commitMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setCommitMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: commitMenu.x, top: commitMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuItem onClick={() => openCommit(commitMenu.commit)}>
              <GitCommitHorizontal /> Open commit with all its files
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(commitMenu.commit.oid);
                toast.success('Hash copied');
              }}
            >
              <Copy /> Copy hash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {lineMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setLineMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: lineMenu.x, top: lineMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" onCloseAutoFocus={(e) => e.preventDefault()}>
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
            <DropdownMenuItem
              onClick={() => selectSide(lineMenu.info.side ?? 'new')}
            >
              <TextSelect /> Select all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </motion.section>
  );
}
