import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Columns2, Copy, FileText, Minus, Plus, Rows3, Trash2, WholeWord, WrapText, X } from 'lucide-react';
import type { FileDiff } from '@angkorgit/core';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Kbd,
  Separator,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { confirmDialog } from '@/components/confirm';
import type { LineMenuInfo } from './VirtualDiff';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi, type CenterDiffTarget } from '@/features/ui/store';
import { DiffViewer } from './DiffViewer';
import { changeBlocks, DiffMinimap, scrollToFraction } from './DiffMinimap';

export function DiffPanel({ target }: { target: CenterDiffTarget }) {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const {
    closeCenterDiff,
    openCenterDiff,
    diffView,
    setDiffView,
    wordDiff,
    setWordDiff,
    fullFileDiff,
    setFullFileDiff,
    wrapLines,
    setWrapLines,
  } = useUi();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedKey = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number; info: LineMenuInfo } | null>(null);

  const path = repo?.path ?? '';
  const isWorkingCopy = target.oid === undefined;

  useEffect(() => {
    if (!isWorkingCopy || !status) return;
    const entry = status.files.find((f) => f.path === target.path);
    const stillHasThisSide = target.staged ? !!entry?.staged : !!entry?.unstaged;
    if (stillHasThisSide) return;
    const hasOtherSide = target.staged ? !!entry?.unstaged : !!entry?.staged;
    if (hasOtherSide) openCenterDiff({ path: target.path, staged: !target.staged });
    else closeCenterDiff();
  }, [status, isWorkingCopy, target.path, target.staged, openCenterDiff, closeCenterDiff]);

  const blocks = useMemo(
    () => (diff && !diff.isBinary && !diff.isImage ? changeBlocks(diff, diffView) : []),
    [diff, diffView],
  );

  const jumpChange = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el || blocks.length === 0 || el.scrollHeight === 0) return;
    const current = (el.scrollTop + el.clientHeight * 0.35) / el.scrollHeight;
    const epsilon = 0.002;
    const next =
      direction === 1
        ? (blocks.find((b) => b.fraction > current + epsilon) ?? blocks[0])
        : ([...blocks].reverse().find((b) => b.fraction < current - epsilon) ??
          blocks[blocks.length - 1]);
    scrollToFraction(el, next.fraction);
  };

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const key = `${path}|${target.path}|${target.oid ?? ''}|${target.staged ?? false}|${fullFileDiff}`;
    if (loadedKey.current !== key) setLoading(true);
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
        if (!cancelled) {
          setDiff(result);
          loadedKey.current = key;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(`Could not load diff: ${(error as { message?: string }).message ?? error}`);
          setDiff(null);
          loadedKey.current = key;
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
        {blocks.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Hint label="Previous change">
              <Button variant="ghost" size="icon-sm" aria-label="Previous change" onClick={() => jumpChange(-1)}>
                <ChevronUp className="size-4" />
              </Button>
            </Hint>
            <Hint label="Next change">
              <Button variant="ghost" size="icon-sm" aria-label="Next change" onClick={() => jumpChange(1)}>
                <ChevronDown className="size-4" />
              </Button>
            </Hint>
            <span className="text-[10px] text-faint">
              {blocks.length} change{blocks.length === 1 ? '' : 's'}
            </span>
          </>
        )}
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

      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : diff ? (
            <DiffViewer
            diff={diff}
            scrollRef={scrollRef}
            onLineContextMenu={
              isWorkingCopy
                ? (e, info) => {
                    e.preventDefault();
                    setLineMenu({ x: e.clientX, y: e.clientY, info });
                  }
                : undefined
            }
            hunkActions={
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
            <p className="py-16 text-center text-sm text-faint">
              No diff to show — the change may already be staged or resolved.
            </p>
          )}
        </div>
        {diff && !loading && <DiffMinimap diff={diff} view={diffView} scrollRef={scrollRef} />}
      </div>

      {lineMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setLineMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: lineMenu.x, top: lineMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            {lineMenu.info.line.kind !== 'context' && (
              <>
                {target.staged ? (
                  <DropdownMenuItem
                    onClick={() =>
                      void runStage(
                        () =>
                          ipc.unstageLine(
                            path,
                            target.path,
                            lineMenu.info.line.kind,
                            (lineMenu.info.line.kind === 'addition'
                              ? lineMenu.info.line.newLineNo
                              : lineMenu.info.line.oldLineNo) ?? 0,
                          ),
                        'Unstage line',
                      )
                    }
                  >
                    <Minus /> Unstage this line
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        void runStage(
                          () =>
                            ipc.stageLine(
                              path,
                              target.path,
                              lineMenu.info.line.kind,
                              (lineMenu.info.line.kind === 'addition'
                                ? lineMenu.info.line.newLineNo
                                : lineMenu.info.line.oldLineNo) ?? 0,
                            ),
                          'Stage line',
                        )
                      }
                    >
                      <Plus /> Stage this line
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      destructive
                      onClick={() => {
                        const info = lineMenu.info;
                        void confirmDialog({
                          title: 'Discard this line?',
                          description:
                            'The change on this line will be reverted in your working tree (modified lines are restored to their original text). This cannot be undone.',
                          confirmLabel: 'Discard line',
                          destructive: true,
                        }).then((ok) => {
                          if (ok)
                            void runStage(
                              () =>
                                ipc.discardLine(
                                  path,
                                  target.path,
                                  info.line.kind,
                                  (info.line.kind === 'addition' ? info.line.newLineNo : info.line.oldLineNo) ?? 0,
                                ),
                              'Discard line',
                            );
                        });
                      }}
                    >
                      <Trash2 /> Discard this line…
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
              </>
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
