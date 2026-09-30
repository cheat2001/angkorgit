import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Columns2, Copy, FileText, History, Minus, Plus, Rows3, SearchCheck, SlidersHorizontal, Space, Sparkles, TextSelect, Trash2, UserRoundSearch, WholeWord, WrapText, X } from 'lucide-react';
import type { CommitFileInfo, FileDiff } from '@angkorgit/core';
import { aiCapabilities, hasCommittedHistory, hasReviewableText, hashText, locateDiffLine, patchTextOf, PROJECT_REVIEW_FILE } from '@angkorgit/core';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Kbd,
  Logo,
  Separator,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { confirmDialog } from '@/components/confirm';
import type { LineMenuInfo } from './VirtualDiff';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useSettings } from '@/features/settings/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { DiffAiStrip } from './DiffAiStrip';
import { EXPLAIN_WAIT_MESSAGES, REVIEW_WAIT_MESSAGES } from '@/features/ai/waitMessages';
import { fileAiKeyFor, useAiWork, type FileAiKind } from '@/features/ai/workStore';
import { useShortcuts } from '@/shared/useShortcuts';
import { captureSelectionRanges, useKeepSelection } from '@/shared/useKeepSelection';
import { useUi, type CenterDiffTarget } from '@/features/ui/store';
import { DiffViewer } from './DiffViewer';
import { wrapUnavailable, type SearchRanges } from './diffShared';
import { scrollDiffToLine, useDiffFind } from './diffSearch';
import { useDiffSelectAll } from './diffCopy';
import { diffSelectionText } from './diffSelection';
import { changeBlocks, DiffMinimap, scrollToFraction } from './DiffMinimap';
import { ChangeNavButtons, useChangeJump } from './changeNav';

const LOCATE_HIGHLIGHT_MS = 2500;
const COMPACT_HEADER_WIDTH = 960;

function useCompactHeader(ref: React.RefObject<HTMLElement>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCompact(el.clientWidth < COMPACT_HEADER_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}

const FILE_AI_TITLES: Record<FileAiKind, string> = {
  explain: 'AI explanation',
  review: 'AI review',
};

function fileAiIcon(kind: FileAiKind, className: string) {
  return kind === 'review' ? <SearchCheck className={className} /> : <Sparkles className={className} />;
}

export function DiffPanel({ target }: { target: CenterDiffTarget }) {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const statusVersion = useRepo((s) => s.statusVersion);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);
  const openCenterDiff = useUi((s) => s.openCenterDiff);
  const openFileHistory = useUi((s) => s.openFileHistory);
  const openBlame = useUi((s) => s.openBlame);
  const diffView = useUi((s) => s.diffView);
  const setDiffView = useUi((s) => s.setDiffView);
  const wordDiff = useUi((s) => s.wordDiff);
  const setWordDiff = useUi((s) => s.setWordDiff);
  const ignoreWhitespace = useUi((s) => s.ignoreWhitespace);
  const setIgnoreWhitespace = useUi((s) => s.setIgnoreWhitespace);
  const fullFileDiff = useUi((s) => s.fullFileDiff);
  const setFullFileDiff = useUi((s) => s.setFullFileDiff);
  const wrapLines = useUi((s) => s.wrapLines);
  const setWrapLines = useUi((s) => s.setWrapLines);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadedKey = useRef<string | null>(null);
  const requestSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const compact = useCompactHeader(headerRef);
  const [lineMenu, setLineMenu] = useState<{
    x: number;
    y: number;
    info: LineMenuInfo;
    selection: string;
    ranges: Range[];
  } | null>(null);
  useKeepSelection(lineMenu?.ranges ?? null);
  const textDiff = diff && !diff.isBinary && !diff.isImage ? diff : null;
  const { findBar, search } = useDiffFind(textDiff, scrollRef);
  const [located, setLocated] = useState<SearchRanges | undefined>(undefined);
  const locateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlight = search ?? located;
  const { selectAllOverlay, selectSide } = useDiffSelectAll(textDiff, scrollRef);

  const path = repo?.path ?? '';
  const isWorkingCopy = target.oid === undefined;
  const aiKey = fileAiKeyFor(path, target);
  const aiResult = useAiWork((s) => s.fileAi[aiKey] ?? null);
  const aiBusyKind = useAiWork((s) => s.fileAiBusy[aiKey] ?? null);
  const diffRef = useRef<FileDiff | null>(null);
  diffRef.current = diff;

  const fetchDiff = async (contextLines?: number, ignore = ignoreWhitespace): Promise<FileDiff | null> => {
    if (target.unchanged) return ipc.fileContents(path, target.path, target.oid ?? null);
    if (target.oid) {
      const result = await ipc.commitFileDiff(
        path,
        target.oid,
        target.path,
        target.oldPath ?? null,
        contextLines,
        ignore,
      );
      const untouched =
        result.hunks.length === 0 &&
        result.additions === 0 &&
        result.deletions === 0 &&
        !result.isBinary &&
        !result.isImage;
      return untouched ? null : result;
    }
    return ipc.diffFile(path, target.path, target.staged ?? false, contextLines, ignore);
  };
  const [commitFileList, setCommitFileList] = useState<CommitFileInfo[]>([]);
  const commitFiles = useMemo(() => commitFileList.map((f) => f.path), [commitFileList]);

  useEffect(() => {
    if (!path || !target.oid) {
      setCommitFileList([]);
      return;
    }
    let cancelled = false;
    void ipc
      .commitFiles(path, target.oid)
      .then((files) => {
        if (!cancelled) setCommitFileList(files);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, target.oid]);

  const workingSiblings = useMemo(
    () =>
      isWorkingCopy && status
        ? status.files
            .filter((f) => (target.staged ? f.staged : f.unstaged))
            .map((f) => f.path)
        : [],
    [isWorkingCopy, status, target.staged],
  );
  const siblings = isWorkingCopy ? workingSiblings : commitFiles;
  const fileIndex = siblings.indexOf(target.path);

  const goFile = (direction: 1 | -1) => {
    if (fileIndex < 0) return;
    const next = siblings[fileIndex + direction];
    if (!next) return;
    if (target.oid) {
      openCenterDiff({
        path: next,
        oid: target.oid,
        oldPath: commitFileList.find((f) => f.path === next)?.oldPath ?? null,
      });
    } else {
      const staged = target.staged ?? false;
      useUi.getState().selectFile({ path: next, staged });
      openCenterDiff({ path: next, staged });
    }
  };

  const goFileRef = useRef(goFile);
  goFileRef.current = goFile;
  useShortcuts(
    useMemo(
      () => [
        { combo: '[', handler: () => goFileRef.current(-1), skipInInput: true },
        { combo: ']', handler: () => goFileRef.current(1), skipInInput: true },
      ],
      [],
    ),
  );

  useEffect(() => {
    if (!isWorkingCopy || !status) return;
    const entry = status.files.find((f) => f.path === target.path);
    if (target.unchanged) {
      if (entry && (entry.unstaged || entry.staged)) openCenterDiff({ path: target.path, staged: !entry.unstaged });
      return;
    }
    const stillHasThisSide = target.staged ? !!entry?.staged : !!entry?.unstaged;
    if (stillHasThisSide) return;
    const hasOtherSide = target.staged ? !!entry?.unstaged : !!entry?.staged;
    if (hasOtherSide) openCenterDiff({ path: target.path, staged: !target.staged });
    else closeCenterDiff();
  }, [status, isWorkingCopy, target.path, target.staged, target.unchanged, openCenterDiff, closeCenterDiff]);

  const blocks = useMemo(
    () => (diff && !diff.isBinary && !diff.isImage ? changeBlocks(diff, diffView) : []),
    [diff, diffView],
  );

  const autoJumpKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!diff || loading) return;
    const key = `${path}|${target.path}|${target.oid ?? ''}|${target.staged ?? false}`;
    if (autoJumpKey.current === key) return;
    const el = scrollRef.current;
    if (!el) return;
    autoJumpKey.current = key;
    const apply = () => {
      if (blocks.length > 0) scrollToFraction(el, blocks[0].fraction, 'auto');
      else el.scrollTo({ top: 0 });
    };
    apply();
    const applied = el.scrollTop;
    requestAnimationFrame(() => {
      if (autoJumpKey.current === key && applied > 0 && el.scrollTop === 0) apply();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, loading, blocks]);

  const jumpChange = useChangeJump(blocks, scrollRef);

  const statusEntry = isWorkingCopy
    ? status?.files.find((f) => f.path === target.path)
    : undefined;
  const statusSignature = isWorkingCopy
    ? `${statusEntry?.staged ?? ''}|${statusEntry?.unstaged ?? ''}|${statusVersion}`
    : '';
  const blameable = !isWorkingCopy || !statusEntry || hasCommittedHistory(statusEntry);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const seq = ++requestSeq.current;
    const key = `${path}|${target.path}|${target.oid ?? ''}|${target.staged ?? false}|${target.unchanged ?? false}|${fullFileDiff}|${ignoreWhitespace}|${reloadToken}`;
    if (loadedKey.current !== key) setLoading(true);
    void fetchDiff(fullFileDiff ? 10_000_000 : undefined)
      .then((result) => {
        if (!cancelled && seq === requestSeq.current) {
          setDiff(result);
          setLoadError(null);
          loadedKey.current = key;
        }
      })
      .catch((error) => {
        if (!cancelled && seq === requestSeq.current) {
          setLoadError(String((error as { message?: string }).message ?? error));
          setDiff(null);
          loadedKey.current = key;
        }
      })
      .finally(() => {
        if (!cancelled && seq === requestSeq.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, target.path, target.oid, target.staged, target.unchanged, fullFileDiff, ignoreWhitespace, reloadToken, statusSignature]);

  useEffect(
    () => () => {
      const work = useAiWork.getState();
      work.stopFileAi(aiKey);
      work.setFileAi(aiKey, null);
    },
    [aiKey],
  );

  const compactPatchHash = !fullFileDiff && !loading && hasReviewableText(diff) ? hashText(patchTextOf(diff)) : null;

  useEffect(() => {
    if (!aiResult || compactPatchHash === null) return;
    if (aiResult.patchHash !== compactPatchHash) useAiWork.getState().setFileAi(aiKey, null);
  }, [aiResult, compactPatchHash, aiKey]);

  const aiAvailable = !loading && !target.unchanged && hasReviewableText(diff);

  const runFileAi = async (kind: FileAiKind) => {
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    const key = aiKey;
    const file = target.path;
    const run = useAiWork.getState().startFileAi(key, kind);
    const stillRunning = () => useAiWork.getState().isFileAiRun(key, run);
    try {
      const source = !fullFileDiff && !ignoreWhitespace && diff ? diff : await fetchDiff(undefined, false);
      if (!stillRunning()) return;
      if (!hasReviewableText(source)) {
        toast.info('This file has no text changes to send');
        return;
      }
      const patch = patchTextOf(source);
      const location: aiCapabilities.FileChangeLocation = target.oid
        ? {
            kind: 'commit',
            oid: target.oid,
            summary: await ipc
              .commitInfo(path, target.oid)
              .then((info) => info.summary)
              .catch(() => ''),
          }
        : { kind: 'working-copy', staged: target.staged ?? false };
      if (!stillRunning()) return;
      const changeContext = { file, location, otherFiles: siblings };
      let text: string;
      if (kind === 'review') {
        const projectInstructions = await ipc.readFile(path, PROJECT_REVIEW_FILE).catch((error) => {
          if (stillRunning() && (error as { code?: string } | null)?.code !== 'not_found') {
            toast.warning(`Could not read ${PROJECT_REVIEW_FILE} — reviewing without project conventions`);
          }
          return '';
        });
        text = await aiCapabilities.reviewFileChanges(getAiProvider(), patch, {
          ...changeContext,
          instructions: useSettings.getState().aiStyle.review.instructions,
          projectInstructions,
        });
      } else {
        text = await aiCapabilities.explainFileChanges(getAiProvider(), patch, changeContext);
      }
      if (!stillRunning()) return;
      if (!text) {
        toast.error('The AI provider returned an empty answer — try again or check the model in Settings');
        return;
      }
      const current = diffRef.current;
      if (!fullFileDiff && hasReviewableText(current) && hashText(patchTextOf(current)) !== hashText(patch)) {
        toast.info(`${file} changed while the AI was working — run it again`);
        return;
      }
      useAiWork.getState().setFileAi(key, { kind, patchHash: hashText(patch), text });
    } catch (error) {
      if (stillRunning()) {
        toast.error(`AI request failed: ${(error as { message?: string } | null)?.message ?? String(error)}`);
      }
    } finally {
      useAiWork.getState().endFileAi(key, run);
    }
  };

  const shownAiKind = aiBusyKind ?? aiResult?.kind ?? null;

  const locateSnippet = (snippet: string) => {
    const el = scrollRef.current;
    if (!diff || !el) return;
    const hit = locateDiffLine(diff, snippet);
    if (!hit) {
      toast.info('That line is not part of this diff');
      return;
    }
    setLocated(new Map([[hit.line, [{ start: hit.start, end: hit.end, current: true }]]]));
    scrollDiffToLine(el, diff, hit.line, diffView === 'split', wrapLines);
    if (locateTimer.current) clearTimeout(locateTimer.current);
    locateTimer.current = setTimeout(() => setLocated(undefined), LOCATE_HIGHLIGHT_MS);
  };

  useEffect(() => {
    setLocated(undefined);
    return () => {
      if (locateTimer.current) clearTimeout(locateTimer.current);
    };
  }, [diff]);

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
      <div
        ref={headerRef}
        data-diff-header={compact ? 'compact' : 'full'}
        className="flex h-10 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border-subtle bg-surface px-3"
      >
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
        {target.oid && (
          <Badge tone="neutral" className="font-mono">
            {target.oid.slice(0, 8)}
          </Badge>
        )}
        {target.unchanged ? (
          <Badge tone="neutral">unchanged</Badge>
        ) : (
          !target.oid && (
            <Badge tone={target.staged ? 'success' : 'info'}>{target.staged ? 'staged' : 'unstaged'}</Badge>
          )
        )}
        {diff && !diff.isBinary && !diff.isImage && !target.unchanged && (
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
        <DropdownMenu>
          <Hint
            label={
              ignoreWhitespace
                ? 'Ignoring whitespace. Hunk and line stage stay off — these hunks are not the patch git would apply.'
                : 'View options'
            }
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="View options"
                className={cn((wordDiff || wrapLines || fullFileDiff || ignoreWhitespace) && 'text-primary')}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>View options</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={wordDiff} onCheckedChange={(v) => setWordDiff(v === true)}>
              <WholeWord /> Word diff
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={ignoreWhitespace} onCheckedChange={(v) => setIgnoreWhitespace(v === true)}>
              <Space /> Ignore whitespace
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={wrapLines}
              disabled={!!textDiff && wrapUnavailable(textDiff)}
              onCheckedChange={(v) => setWrapLines(v === true)}
            >
              <WrapText /> Wrap long lines
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={fullFileDiff} onCheckedChange={(v) => setFullFileDiff(v === true)}>
              <FileText /> Show whole file
            </DropdownMenuCheckboxItem>
            {ignoreWhitespace && (
              <p className="max-w-56 px-2 pb-1.5 pt-1 text-[11px] leading-snug text-faint">
                Hunk and line stage stay off. These hunks are not the patch git would apply.
              </p>
            )}
            {textDiff && wrapUnavailable(textDiff) && (
              <p className="max-w-56 px-2 pb-1.5 pt-1 text-[11px] leading-snug text-faint">
                Wrapping stays off for large files so scrolling keeps up.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Hint label="File history">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="File history"
            onClick={() => openFileHistory(target.path)}
          >
            <History className="size-3.5" />
          </Button>
        </Hint>
        <Hint
          label={
            !blameable
              ? 'Nothing to blame yet — this file has no commits'
              : target.oid
                ? 'Blame at this commit'
                : 'Blame'
          }
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Blame"
            disabled={!blameable}
            onClick={() => openBlame(target.path, target.oid ?? null)}
          >
            <UserRoundSearch className="size-3.5" />
          </Button>
        </Hint>
        <DropdownMenu>
          <Hint
            label={
              aiBusyKind
                ? aiBusyKind === 'review'
                  ? 'Reviewing with AI…'
                  : 'Explaining with AI…'
                : aiAvailable
                  ? 'Explain or review with AI'
                  : 'No text changes to explain or review'
            }
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="AI actions"
                disabled={!aiAvailable || !!aiBusyKind}
                className={cn(aiResult && !aiBusyKind && 'text-primary')}
              >
                {aiBusyKind ? (
                  <Logo size={14} animated="loop" className="logo-draw-loop" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void runFileAi('explain')}>
              <Sparkles /> Explain changes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void runFileAi('review')}>
              <SearchCheck /> Review changes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChangeNavButtons blocks={blocks} onJump={jumpChange} showCount={!compact} />
        {siblings.length > 1 && fileIndex >= 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Hint
              label={
                <span className="flex items-center gap-1">
                  Previous file <Kbd>[</Kbd>
                </span>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous file"
                disabled={fileIndex <= 0}
                onClick={() => goFile(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
            </Hint>
            <span className={cn('text-[10px] tabular-nums text-faint', compact && 'sr-only')}>
              {fileIndex + 1} of {siblings.length}
            </span>
            <Hint
              label={
                <span className="flex items-center gap-1">
                  Next file <Kbd>]</Kbd>
                </span>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next file"
                disabled={fileIndex >= siblings.length - 1}
                onClick={() => goFile(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </Hint>
          </>
        )}
        {isWorkingCopy && !target.unchanged && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            {target.staged ? (
              <Hint label="Unstage file">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Unstage file"
                  onClick={() => void runStage(() => ipc.unstageFile(path, target.path), 'Unstage')}
                >
                  <Minus className="size-3" /> {!compact && 'Unstage file'}
                </Button>
              </Hint>
            ) : (
              <Hint label="Stage file">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Stage file"
                  onClick={() => void runStage(() => ipc.stageFile(path, target.path), 'Stage')}
                >
                  <Plus className="size-3" /> {!compact && 'Stage file'}
                </Button>
              </Hint>
            )}
          </>
        )}
      </div>

      {shownAiKind && (
        <DiffAiStrip
          title={FILE_AI_TITLES[shownAiKind]}
          icon={fileAiIcon(shownAiKind, 'size-3.5')}
          busy={!!aiBusyKind}
          waitMessages={shownAiKind === 'review' ? REVIEW_WAIT_MESSAGES : EXPLAIN_WAIT_MESSAGES}
          text={aiResult?.text ?? null}
          diff={textDiff}
          onStop={() => useAiWork.getState().stopFileAi(aiKey)}
          onDismiss={() => useAiWork.getState().setFileAi(aiKey, null)}
          onLocate={locateSnippet}
        />
      )}

      <div className="relative flex min-h-0 flex-1">
        {findBar}
        {selectAllOverlay}
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
              <p className="max-w-md text-center text-sm text-danger [overflow-wrap:anywhere]">
                Could not load the diff: {loadError}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setReloadToken((t) => t + 1)}>
                Retry
              </Button>
            </div>
          ) : diff &&
            target.unchanged &&
            !diff.isBinary &&
            !diff.isImage &&
            diff.hunks.every((h) => h.lines.length === 0) ? (
            <p className="py-16 text-center text-sm text-faint">This file is empty.</p>
          ) : diff ? (
            <DiffViewer
            diff={diff}
            scrollRef={scrollRef}
            search={highlight}
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
            hunkActions={
              isWorkingCopy && !fullFileDiff && !target.unchanged && !ignoreWhitespace
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
          <DropdownMenuContent align="start" side="bottom" onCloseAutoFocus={(e) => e.preventDefault()}>
            {isWorkingCopy && !ignoreWhitespace && lineMenu.info.line.kind !== 'context' && (
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
