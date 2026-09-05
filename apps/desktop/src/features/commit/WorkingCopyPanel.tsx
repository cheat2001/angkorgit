import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { AlertTriangle, Copy, ExternalLink, FolderOpen, History, Maximize2, Minus, Pencil, Plus, SearchCheck, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { FileStatus } from '@angkorgit/core';
import { aiCapabilities, buildStagedReviewSignature, hashText, PROJECT_REVIEW_FILE, joinCommitMessage, splitCommitMessage } from '@angkorgit/core';
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Logo,
  Spinner,
  Textarea,
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { AiText } from '@/features/ai/AiText';
import { AiResultDialog } from '@/features/ai/AiResultDialog';
import { useAiWork } from '@/features/ai/workStore';
import { useSettings } from '@/features/settings/store';
import { ensureRepoProfile } from '@/features/settings/profiles';
import { useUndo } from '@/features/history/undoStore';
import { abortMergeFlow } from '@/features/repository/merge';
import { useCommitDraft } from './draftStore';
import { confirmDialog } from '@/components/confirm';
import { FileTree, treeIndent as sharedTreeIndent, FileTreeFoldButton, INITIAL_FOLD, nextFold, type FileTreeFold, type FileTreeFoldState } from '@/components/FileTree';
import { basename, dirname } from '@/shared/utils';

function statusBadge(kind: string | null) {
  switch (kind) {
    case 'new':
    case 'untracked':
      return <Badge tone="success">A</Badge>;
    case 'modified':
      return <Badge tone="info">M</Badge>;
    case 'deleted':
      return <Badge tone="danger">D</Badge>;
    case 'renamed':
      return <Badge tone="primary">R</Badge>;
    case 'conflicted':
      return <Badge tone="danger">!</Badge>;
    default:
      return null;
  }
}

const FileRow = memo(function FileRow({
  file,
  staged,
  selected,
  onClick,
  onPrimary,
  onDiscard,
  onContextMenu,
  indent,
  treeMode,
}: {
  file: FileStatus;
  staged: boolean;
  selected: boolean;
  onClick: (file: FileStatus, staged: boolean) => void;
  onPrimary: (file: FileStatus, staged: boolean) => void;
  onDiscard?: (file: FileStatus) => void;
  onContextMenu?: (event: React.MouseEvent, file: FileStatus, staged: boolean) => void;
  indent?: number;
  treeMode?: boolean;
}) {
  const kind = staged ? file.staged : file.unstaged;
  const conflicted = file.unstaged === 'conflicted';
  const row = (
      <div
        data-selected-file-row={selected || undefined}
        title={treeMode ? file.path : undefined}
        className={cn(
          'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
          selected ? 'bg-primary/10' : 'hover:bg-surface-raised',
        )}
        style={indent !== undefined ? { paddingLeft: indent } : undefined}
        onClick={() => onClick(file, staged)}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, file, staged) : undefined}
      >
        <Checkbox
          checked={staged}
          aria-label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
          onCheckedChange={() => onPrimary(file, staged)}
          onClick={(e) => e.stopPropagation()}
        />
        {statusBadge(conflicted && !staged ? 'conflicted' : kind)}
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground">{basename(file.path)}</span>
          {!treeMode && dirname(file.path) && (
            <span className="ml-1.5 text-faint">{dirname(file.path)}</span>
          )}
        </span>
        {!staged && onDiscard && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Discard ${file.path}`}
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard(file);
            }}
          >
            <Trash2 className="size-3 text-danger" />
          </Button>
        )}
      </div>
  );
  if (treeMode) return row;
  return (
    <Hint label={file.path} side="left" className="max-w-[34rem] font-mono">
      {row}
    </Hint>
  );
});

const fileStatusPath = (file: FileStatus) => file.path;

export const commitShortcut = { current: null as (() => void) | null };
const COMMIT_BOX_MIN = 72;
const COMMIT_BOX_AUTO_MAX = 260;
const COMMIT_BOX_MAX = 600;

const REVIEW_WAIT_MESSAGES = [
  'Reading your staged changes…',
  'Thinking through edge cases…',
  'Hunting for bugs…',
  'Checking your conventions…',
  'Looking for missing tests…',
  'Polishing the feedback…',
];

const UNSTAGED_ROW_HEIGHT = 36;
const STAGED_ROW_HEIGHT = 30;
const CONFLICT_ROW_HEIGHT = 24;

function VirtualFileList({
  files,
  scrollRef,
  rowHeight,
  renderRow,
}: {
  files: FileStatus[];
  scrollRef: React.RefObject<HTMLDivElement>;
  rowHeight: (file: FileStatus) => number;
  renderRow: (file: FileStatus) => React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setScrollMargin((prev) => (prev === el.offsetTop ? prev : el.offsetTop));
  });
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rowHeight(files[index]),
    getItemKey: (index) => files[index].path,
    overscan: 12,
    scrollMargin,
  });
  const sizeSignature = useMemo(
    () => files.map((file) => rowHeight(file)).join(','),
    [files, rowHeight],
  );
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, sizeSignature]);
  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          className="absolute left-0 w-full"
          style={{ top: 0, height: item.size, transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          {renderRow(files[item.index])}
        </div>
      ))}
    </div>
  );
}

export function WorkingCopyPanel() {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const conflicts = useRepo((s) => s.conflicts);
  const submodules = useRepo((s) => s.submodules);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const reloadGraph = useGraph((s) => s.reload);
  const selectedFile = useUi((s) => s.selectedFile);
  const selectFile = useUi((s) => s.selectFile);
  const openCenterDiff = useUi((s) => s.openCenterDiff);
  const openEditor = useUi((s) => s.openEditor);
  const openConflict = useUi((s) => s.openConflict);
  const fileTree = useUi((s) => s.fileTree);
  const path = repo?.path ?? '';
  const message = useCommitDraft((s) => (path ? (s.drafts[path] ?? '') : ''));
  const amend = useCommitDraft((s) => !!path && s.amendFor === path);
  const setMessage = (text: string) => useCommitDraft.getState().setDraft(path, text);
  const { summary, body } = splitCommitMessage(message);
  const setSummary = (text: string) => setMessage(joinCommitMessage(text, body));
  const setBody = (text: string) => setMessage(joinCommitMessage(summary, text));
  const summaryRef = useRef<HTMLInputElement>(null);
  const [unstagedFold, setUnstagedFold] = useState<FileTreeFold>(INITIAL_FOLD);
  const [unstagedFoldState, setUnstagedFoldState] = useState<FileTreeFoldState | null>(null);
  const [stagedFold, setStagedFold] = useState<FileTreeFold>(INITIAL_FOLD);
  const [stagedFoldState, setStagedFoldState] = useState<FileTreeFoldState | null>(null);
  const commitBoxHeight = useUi((s) => s.commitBoxHeight);
  const [resizing, setResizing] = useState(false);
  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const el = messageRef.current;
    if (!el) return;
    const startY = event.clientY;
    const startHeight = el.getBoundingClientRect().height;
    setResizing(true);
    const onMove = (e: MouseEvent) => {
      const next = Math.round(Math.min(COMMIT_BOX_MAX, Math.max(COMMIT_BOX_MIN, startHeight + (startY - e.clientY))));
      useUi.getState().setCommitBoxHeight(next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const setAmend = (value: boolean) => useCommitDraft.getState().setAmend(path, value);
  const [committing, setCommitting] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const aiRunRef = useRef(0);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [waitIndex, setWaitIndex] = useState(0);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; file: FileStatus; staged: boolean } | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = messageRef.current;
    if (!el) return;
    if (commitBoxHeight !== null) {
      el.style.height = `${commitBoxHeight}px`;
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.max(COMMIT_BOX_MIN, Math.min(el.scrollHeight, COMMIT_BOX_AUTO_MAX))}px`;
  }, [body, commitBoxHeight]);

  useEffect(() => {
    if (!path || useCommitDraft.getState().drafts[path]) return;
    let cancelled = false;
    void ipc
      .mergeMessage(path)
      .then((mergeMsg) => {
        if (cancelled || !mergeMsg) return;
        if (useCommitDraft.getState().drafts[path]) return;
        useCommitDraft.getState().setDraft(path, mergeMsg);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, status]);

  const files = useMemo(() => status?.files ?? [], [status]);
  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((f) => f.unstaged), [files]);
  const stagedSignature = useMemo(() => buildStagedReviewSignature(files), [files]);
  const review = useAiWork((s) => (path ? (s.reviews[path] ?? null) : null));
  const reviewBusy = useAiWork((s) => (path ? !!s.reviewBusy[path] : false));
  const reviewCurrent = review !== null && review.stagedSignature === stagedSignature;

  useEffect(() => {
    if (path && review && review.stagedSignature !== stagedSignature) {
      useAiWork.getState().setReview(path, null);
    }
  }, [review, path, stagedSignature]);

  useEffect(() => {
    if (!reviewCurrent) setReviewExpanded(false);
  }, [reviewCurrent]);

  useEffect(() => {
    if (!reviewBusy) return;
    setWaitIndex(Math.floor(Math.random() * REVIEW_WAIT_MESSAGES.length));
    const timer = setInterval(() => setWaitIndex((i) => i + 1), 6000);
    return () => clearInterval(timer);
  }, [reviewBusy]);

  useEffect(() => {
    if (!reviewCurrent || !review) return;
    let cancelled = false;
    void ipc
      .stagedPatch(path)
      .then((patch) => {
        if (cancelled || useRepo.getState().repo?.path !== path) return;
        if (hashText(patch) !== review.patchHash) useAiWork.getState().setReview(path, null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reviewCurrent, review, path, status]);

  const showDiff = useCallback(
    (file: FileStatus, staged: boolean) => {
      selectFile({ path: file.path, staged });
      openCenterDiff({ path: file.path, staged });
    },
    [selectFile, openCenterDiff],
  );

  const isSubmodule = (file: string) => submodules.some((s) => s.path === file);

  const discardOne = useCallback(
    async (file: string) => {
      try {
        const clean = await ipc.discardFile(path, file);
        await refreshStatus();
        if (!clean) {
          toast.error(
            useRepo.getState().submodules.some((s) => s.path === file)
              ? `"${file}" is a submodule — open it as its own repository to discard the changes inside it.`
              : `Could not discard "${file}" — the change is still present.`,
          );
        }
      } catch (error) {
        toast.error(`Discard failed: ${(error as { message?: string }).message ?? error}`);
      }
    },
    [path, refreshStatus],
  );

  const discardEverything = async () => {
    const before = unstagedFiles.length;
    try {
      const remaining = await ipc.discardAll(path);
      await refreshStatus();
      if (remaining.length > 0) {
        const submoduleCount = remaining.filter(isSubmodule).length;
        const listed = remaining.slice(0, 3).join(', ') + (remaining.length > 3 ? ` +${remaining.length - 3} more` : '');
        toast.error(
          submoduleCount > 0
            ? `${remaining.length} change${remaining.length === 1 ? '' : 's'} could not be discarded (${listed}). Submodule changes must be discarded inside the submodule repository.`
            : `${remaining.length} change${remaining.length === 1 ? '' : 's'} could not be discarded: ${listed}`,
        );
      } else if (before > 0) {
        toast.success(`Discarded ${before} change${before === 1 ? '' : 's'}`);
      }
    } catch (error) {
      toast.error(`Discard all failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const run = useCallback(
    async (op: () => Promise<unknown>, errorLabel: string) => {
      try {
        await op();
        await refreshStatus();
      } catch (error) {
        toast.error(`${errorLabel}: ${(error as { message?: string }).message ?? error}`);
      }
    },
    [refreshStatus],
  );

  const toggleStage = useCallback(
    (file: FileStatus, staged: boolean) => {
      void run(
        () => (staged ? ipc.unstageFile(path, file.path) : ipc.stageFile(path, file.path)),
        staged ? 'Unstage failed' : 'Stage failed',
      );
    },
    [run, path],
  );

  const openFileMenu = useCallback((event: React.MouseEvent, file: FileStatus, staged: boolean) => {
    event.preventDefault();
    setFileMenu({ x: event.clientX, y: event.clientY, file, staged });
  }, []);

  const requestDiscard = useCallback(
    (file: FileStatus) => {
      void confirmDialog({
        title: 'Discard changes?',
        description:
          file.unstaged === 'untracked'
            ? 'This file is new — discarding reverts it and deletes the file. This cannot be undone.'
            : 'All changes in this file will be reverted. This cannot be undone.',
        path: file.path,
        confirmLabel: 'Discard',
        destructive: true,
      }).then((ok) => {
        if (ok) void discardOne(file.path);
      });
    },
    [discardOne],
  );

  const generateMessage = async () => {
    if (aiBusy) {
      aiRunRef.current += 1;
      setAiBusy(false);
      return;
    }
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    if (stagedFiles.length === 0) {
      toast.info('Stage some changes first');
      return;
    }
    const run = ++aiRunRef.current;
    const stillRunning = () => aiRunRef.current === run;
    setAiBusy(true);
    try {
      const patch = await ipc.stagedPatch(path);
      if (!stillRunning()) return;
      const generated = await aiCapabilities.generateCommitMessage(getAiProvider(), patch, {
        style: useSettings.getState().aiStyle.commit,
        branch: status?.branch ?? null,
      });
      if (!stillRunning()) return;
      setMessage(generated);
    } catch (error) {
      if (stillRunning()) {
        toast.error(`AI request failed: ${(error as { message?: string } | null)?.message ?? String(error)}`);
      }
    } finally {
      if (stillRunning()) setAiBusy(false);
    }
  };

  const reviewStaged = async () => {
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    if (stagedFiles.length === 0) {
      toast.info('Stage some changes first');
      return;
    }
    const target = path;
    const signature = stagedSignature;
    const run = useAiWork.getState().startReview(target);
    const stillRunning = () => useAiWork.getState().isReviewRun(target, run);
    try {
      const patch = await ipc.stagedPatch(target);
      if (!stillRunning()) return;
      if (!patch.trim()) {
        toast.info('The staged changes have no reviewable text diff');
        return;
      }
      const projectInstructions = await ipc.readFile(target, PROJECT_REVIEW_FILE).catch((error) => {
        if (stillRunning() && (error as { code?: string } | null)?.code !== 'not_found') {
          toast.warning(`Could not read ${PROJECT_REVIEW_FILE} — reviewing without project conventions`);
        }
        return '';
      });
      const text = await aiCapabilities.reviewStagedChanges(getAiProvider(), patch, {
        instructions: useSettings.getState().aiStyle.review.instructions,
        projectInstructions,
      });
      if (!stillRunning()) return;
      if (!text) {
        toast.error('The AI provider returned an empty review — try again or check the model in Settings');
        return;
      }
      const state = useRepo.getState();
      if (state.repo?.path !== target) return;
      if (buildStagedReviewSignature(state.status?.files ?? []) !== signature) {
        toast.info('The staged changes changed during the review — run it again');
        return;
      }
      useAiWork
        .getState()
        .setReview(target, { stagedSignature: signature, patchHash: hashText(patch), text });
    } catch (error) {
      if (stillRunning()) {
        toast.error(`AI request failed: ${(error as { message?: string } | null)?.message ?? String(error)}`);
      }
    } finally {
      useAiWork.getState().endReview(target, run);
    }
  };

  const stopReview = () => {
    if (path) useAiWork.getState().stopReview(path);
  };

  const committingRef = useRef(false);

  const commit = async () => {
    if (!summary.trim() && !amend) return;
    if (committingRef.current) return;
    committingRef.current = true;
    setCommitting(true);
    try {
      await ensureRepoProfile(path);
      if (amend) {
        await ipc.amend(path, message.trim() ? message.trim() : null);
        toast.success('Commit amended');
      } else {
        const summary = message.trim().split('\n')[0].slice(0, 50);
        await useUndo.getState().tracked({
          path,
          kind: 'commit',
          label: `commit "${summary}"`,
          action: () => ipc.commit(path, message.trim()),
        });
        toast.success('Committed');
      }
      setMessage('');
      setAmend(false);
      useAiWork.getState().setReview(path, null);
      await refreshStatus();
      await reloadGraph(path);
    } catch (error) {
      toast.error(`Commit failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      committingRef.current = false;
      setCommitting(false);
    }
  };

  useEffect(() => {
    commitShortcut.current = () => void commit();
    return () => {
      commitShortcut.current = null;
    };
  });

  const conflictedPaths = useMemo(() => new Set(conflicts), [conflicts]);

  const unstagedRowHeight = useCallback(
    (file: FileStatus) =>
      conflictedPaths.has(file.path) ? CONFLICT_ROW_HEIGHT : UNSTAGED_ROW_HEIGHT,
    [conflictedPaths],
  );
  const stagedRowHeight = useCallback(() => STAGED_ROW_HEIGHT, []);

  const visibleOrder = useMemo(
    () => [
      ...unstagedFiles.map((file) => ({ file, staged: false })),
      ...stagedFiles.map((file) => ({ file, staged: true })),
    ],
    [unstagedFiles, stagedFiles],
  );

  const moveFileSelection = (direction: 1 | -1) => {
    if (visibleOrder.length === 0) return;
    const current = useUi.getState().selectedFile;
    const index = current
      ? visibleOrder.findIndex((e) => e.file.path === current.path && e.staged === current.staged)
      : -1;
    const nextIndex =
      index < 0 ? (direction === 1 ? 0 : visibleOrder.length - 1) : index + direction;
    const next = visibleOrder[nextIndex];
    if (!next) return;
    selectFile({ path: next.file.path, staged: next.staged });
    requestAnimationFrame(() => {
      listScrollRef.current
        ?.querySelector('[data-selected-file-row]')
        ?.scrollIntoView({ block: 'nearest' });
    });
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFileSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFileSelection(-1);
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const current = useUi.getState().selectedFile;
    if (!current) return;
    const entry = visibleOrder.find(
      (x) => x.file.path === current.path && x.staged === current.staged,
    );
    if (!entry) return;
    e.preventDefault();
    if (e.key === 'Enter') {
      if (conflictedPaths.has(entry.file.path) && !entry.staged) openConflict(entry.file.path);
      else showDiff(entry.file, entry.staged);
    } else {
      toggleStage(entry.file, entry.staged);
    }
  };

  const treeIndent = (depth?: number) =>
    fileTree && depth !== undefined ? sharedTreeIndent(depth) : undefined;

  const renderUnstaged = (file: FileStatus, depth?: number) =>
    conflictedPaths.has(file.path) ? (
      <div
        key={`u-${file.path}`}
        data-selected-file-row={
          selectedFile?.path === file.path && !selectedFile.staged ? true : undefined
        }
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10',
          selectedFile?.path === file.path && !selectedFile.staged && 'bg-danger/10',
        )}
        style={treeIndent(depth) !== undefined ? { paddingLeft: treeIndent(depth) } : undefined}
        onClick={() => openConflict(file.path)}
      >
        <AlertTriangle className="size-3.5" />
        <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
        <span className="text-[10px]">resolve…</span>
      </div>
    ) : (
      <FileRow
        key={`u-${file.path}`}
        file={file}
        staged={false}
        treeMode={fileTree}
        indent={treeIndent(depth)}
        selected={selectedFile?.path === file.path && !selectedFile.staged}
        onClick={showDiff}
        onPrimary={toggleStage}
        onContextMenu={openFileMenu}
        onDiscard={requestDiscard}
      />
    );

  const renderStaged = (file: FileStatus, depth?: number) => (
    <FileRow
      key={`s-${file.path}`}
      file={file}
      staged
      treeMode={fileTree}
      indent={treeIndent(depth)}
      selected={selectedFile?.path === file.path && selectedFile.staged}
      onClick={showDiff}
      onPrimary={toggleStage}
      onContextMenu={openFileMenu}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {conflicts.length > 0 && (
        <div className="m-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle className="size-3.5" />
            {conflicts.length} conflicted file{conflicts.length === 1 ? '' : 's'}
          </p>
          {conflicts.map((file) => (
            <button
              key={file}
              className="mt-1 block w-full truncate rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-danger/10"
              onClick={() => openConflict(file)}
            >
              {file}
            </button>
          ))}
        </div>
      )}

      <div
        ref={listScrollRef}
        tabIndex={0}
        aria-label="Changed files"
        onKeyDown={onListKeyDown}
        className="relative min-h-0 flex-1 overflow-y-auto p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        {status === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : (
        <>
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Changes <span className="text-faint">{unstagedFiles.length}</span>
          </span>
          {unstagedFiles.length > 0 && (
            <span className="flex items-center">
              {fileTree && (
                <FileTreeFoldButton
                  state={unstagedFoldState}
                  onFold={(mode) => setUnstagedFold((f) => nextFold(f, mode))}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                onClick={() => {
                  void confirmDialog({
                    title: `Discard all ${unstagedFiles.length} change${unstagedFiles.length === 1 ? '' : 's'}?`,
                    description:
                      'Every unstaged change will be reverted and untracked files will be deleted. This cannot be undone — not even with ⌘Z.',
                    confirmLabel: 'Discard all',
                    destructive: true,
                  }).then((ok) => {
                    if (ok) void discardEverything();
                  });
                }}
              >
                <Trash2 className="size-3" /> Discard all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void run(() => ipc.stageAll(path), 'Stage all failed')}>
                <Plus className="size-3" /> Stage all
              </Button>
            </span>
          )}
        </div>
        {unstagedFiles.length === 0 && <p className="px-2 pb-2 text-xs text-faint">Working tree clean.</p>}
        {fileTree ? (
          <FileTree
            items={unstagedFiles}
            pathOf={fileStatusPath}
            renderFile={renderUnstaged}
            fold={unstagedFold}
            onFoldState={setUnstagedFoldState}
          />
        ) : (
          <VirtualFileList
            files={unstagedFiles}
            scrollRef={listScrollRef}
            rowHeight={unstagedRowHeight}
            renderRow={renderUnstaged}
          />
        )}
        <div className="mb-1 mt-3 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Staged <span className="text-faint">{stagedFiles.length}</span>
          </span>
          {stagedFiles.length > 0 && (
            <span className="flex items-center">
              {fileTree && (
                <FileTreeFoldButton
                  state={stagedFoldState}
                  onFold={(mode) => setStagedFold((f) => nextFold(f, mode))}
                />
              )}
              <Button variant="ghost" size="sm" onClick={() => void run(() => ipc.unstageAll(path), 'Unstage all failed')}>
                <Minus className="size-3" /> Unstage all
              </Button>
            </span>
          )}
        </div>
        {stagedFiles.length === 0 && <p className="px-2 pb-2 text-xs text-faint">Nothing staged yet.</p>}
        {fileTree ? (
          <FileTree
            items={stagedFiles}
            pathOf={fileStatusPath}
            renderFile={renderStaged}
            fold={stagedFold}
            onFoldState={setStagedFoldState}
          />
        ) : (
          <VirtualFileList
            files={stagedFiles}
            scrollRef={listScrollRef}
            rowHeight={stagedRowHeight}
            renderRow={renderStaged}
          />
        )}
        </>
        )}
      </div>

      {fileMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setFileMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: fileMenu.x, top: fileMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{fileMenu.file.path}</DropdownMenuLabel>
            {fileMenu.staged ? (
              <DropdownMenuItem
                onClick={() => void run(() => ipc.unstageFile(path, fileMenu.file.path), 'Unstage failed')}
              >
                <Minus /> Unstage file
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => void run(() => ipc.stageFile(path, fileMenu.file.path), 'Stage failed')}
                >
                  <Plus /> Stage file
                </DropdownMenuItem>
                <DropdownMenuItem destructive onClick={() => requestDiscard(fileMenu.file)}>
                  <Trash2 /> Discard changes…
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openEditor(fileMenu.file.path)}>
              <Pencil /> Edit file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => useUi.getState().openFileHistory(fileMenu.file.path)}>
              <History /> File history
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void ipc
                  .openPath(`${path}/${fileMenu.file.path}`)
                  .catch((error) =>
                    toast.error(
                      `Could not open the file: ${(error as { message?: string }).message ?? error}`,
                    ),
                  )
              }
            >
              <ExternalLink /> Open in external app
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void ipc
                  .revealPath(`${path}/${fileMenu.file.path}`)
                  .catch((error) =>
                    toast.error(
                      `Could not reveal the file: ${(error as { message?: string }).message ?? error}`,
                    ),
                  )
              }
            >
              <FolderOpen /> Show in Finder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(fileMenu.file.path);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onClick={() => {
                const file = fileMenu.file;
                void confirmDialog({
                  title: 'Delete file?',
                  description:
                    file.unstaged === 'untracked'
                      ? 'The file is untracked — deleting it cannot be undone.'
                      : 'The file will be removed from your working tree. It can be restored with Discard (the deletion shows as a change).',
                  path: file.path,
                  confirmLabel: 'Delete',
                  destructive: true,
                }).then((ok) => {
                  if (ok) void run(() => ipc.deleteFile(path, file.path), 'Delete failed');
                });
              }}
            >
              <Trash2 /> Delete file…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {status === null ? null : files.length === 0 && !amend && repo?.state !== 'merge' ? (
        <div className="shrink-0 border-t border-border-subtle px-3 py-2">
          <Button variant="ghost" size="sm" className="text-muted" onClick={() => setAmend(true)}>
            <Undo2 className="size-3" /> Amend last commit…
          </Button>
        </div>
      ) : (
        <div className="relative shrink-0 border-t border-border-subtle p-3">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize commit box"
            title="Drag to resize · double-click to reset"
            onMouseDown={startResize}
            onDoubleClick={() => useUi.getState().setCommitBoxHeight(null)}
            className={cn(
              'group/handle absolute -top-1 left-0 right-0 z-10 flex h-2 cursor-row-resize items-center justify-center',
            )}
          >
            <span
              className={cn(
                'h-0.5 w-10 rounded-full transition-colors',
                resizing ? 'bg-primary' : 'bg-transparent group-hover/handle:bg-primary/60',
              )}
            />
          </div>
          {reviewBusy && (
            <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 text-xs leading-relaxed">
              <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
                <span className="flex items-center gap-1.5 font-medium text-primary">
                  <SearchCheck className="size-3.5" /> AI review
                </span>
                <Hint label="Stop the review">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stop the AI review"
                    onClick={stopReview}
                  >
                    <X className="size-3" />
                  </Button>
                </Hint>
              </div>
              <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-1.5 text-muted">
                <Logo size={18} animated="loop" className="logo-draw-loop shrink-0" />
                <span key={waitIndex} className="animate-fade-in">
                  {REVIEW_WAIT_MESSAGES[waitIndex % REVIEW_WAIT_MESSAGES.length]}
                </span>
              </div>
            </div>
          )}
          {!reviewBusy && review && reviewCurrent && (
            <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 text-xs leading-relaxed">
              <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
                <span className="flex items-center gap-1.5 font-medium text-primary">
                  <SearchCheck className="size-3.5" /> AI review
                </span>
                <span className="flex items-center">
                  <Hint label="Open review in full view">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Open AI review in full view"
                      onClick={() => setReviewExpanded(true)}
                    >
                      <Maximize2 className="size-3" />
                    </Button>
                  </Hint>
                  <Hint label="Dismiss review">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Dismiss AI review"
                      onClick={() => useAiWork.getState().setReview(path, null)}
                    >
                      <X className="size-3" />
                    </Button>
                  </Hint>
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto px-3 pb-2.5 pt-1">
                <AiText text={review.text} />
              </div>
            </div>
          )}
          <div
            className={cn(
              'rounded-md border border-border bg-surface shadow-sm transition-colors',
              'focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/60',
            )}
          >
            <div className="relative flex items-center">
              <input
                ref={summaryRef}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    messageRef.current?.focus();
                  }
                }}
                placeholder={amend ? 'New summary (leave empty to keep current)' : 'Summary'}
                aria-label="Commit summary"
                spellCheck
                className={cn(
                  'h-9 min-w-0 flex-1 bg-transparent pl-3 text-sm font-medium text-foreground outline-none',
                  'placeholder:font-normal placeholder:text-faint',
                  summary.length > 50 ? 'pr-24' : 'pr-9',
                )}
              />
              {summary.length > 50 && (
                <span
                  className={cn(
                    'pointer-events-none absolute right-9 font-mono text-[10px] tabular-nums',
                    summary.length > 72 ? 'text-danger' : 'text-faint',
                  )}
                  title="Summary length (50 recommended, 72 max)"
                >
                  {summary.length}/72
                </span>
              )}
              <Hint label={aiBusy ? 'Stop generating' : 'Generate message with AI'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={aiBusy ? 'Stop generating the commit message' : 'Generate commit message with AI'}
                  className="absolute right-1.5"
                  disabled={reviewBusy}
                  onClick={() => void generateMessage()}
                >
                  {aiBusy ? (
                    <Logo size={14} animated="loop" className="logo-draw-loop" />
                  ) : (
                    <Sparkles className="size-3.5 text-primary" />
                  )}
                </Button>
              </Hint>
            </div>
            <div className="mx-3 h-px bg-border-subtle" />
            <Textarea
              ref={messageRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && body.length === 0) {
                  e.preventDefault();
                  summaryRef.current?.focus();
                }
              }}
              placeholder="Description — what changed and why  ·  ⌘⏎ to commit"
              aria-label="Commit description"
              className={cn(
                'min-h-[72px] resize-none rounded-none border-0 bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground shadow-none focus-visible:ring-0 focus-visible:border-0',
                commitBoxHeight === null ? 'max-h-[260px]' : 'max-h-[600px] overflow-y-auto',
              )}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted">
              <Checkbox checked={amend} onCheckedChange={(v) => setAmend(v === true)} />
              <Undo2 className="size-3" /> Amend
            </label>
            <Hint label="Review staged changes with AI before committing">
              <Button
                variant="outline"
                size="sm"
                disabled={reviewBusy || committing || aiBusy}
                onClick={() => void reviewStaged()}
              >
                {reviewBusy ? (
                  <Logo size={14} animated="loop" className="logo-draw-loop" />
                ) : (
                  <SearchCheck className="size-3 text-primary" />
                )}
                Review
              </Button>
            </Hint>
            {repo?.state === 'merge' && (
              <Hint label="Reset the working copy to the state before the merge started">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => void abortMergeFlow(path)}
                >
                  Abort merge
                </Button>
              </Hint>
            )}
            <Button
              size="sm"
              disabled={
                committing ||
                (!summary.trim() && !amend) ||
                (stagedFiles.length === 0 && !amend && repo?.state !== 'merge')
              }
              onClick={() => void commit()}
            >
              {committing && <Spinner className="text-primary-foreground" />}
              {amend ? 'Amend commit' : `Commit${stagedFiles.length > 0 ? ` ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}` : ''}`}
            </Button>
          </div>
        </div>
      )}

      <AiResultDialog
        open={reviewExpanded && !!review && reviewCurrent}
        onOpenChange={(open) => !open && setReviewExpanded(false)}
        title="AI review"
        icon={<SearchCheck className="size-4 text-primary" />}
        text={review?.text ?? ''}
      />
    </div>
  );
}
