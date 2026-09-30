import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Cloud,
  Code,
  Copy,
  ExternalLink,
  File as FileIcon,
  FileText,
  FolderOpen,
  History,
  Monitor,
  Pencil,
  SearchCheck,
  Sparkles,
  Tag as TagIcon,
  UserRoundSearch,
} from 'lucide-react';
import type { AllFilesEntry, CommitFileInfo, CommitInfo } from '@angkorgit/core';
import {
  aiCapabilities,
  allFiles,
  filterFiles,
  foldersWithChanges,
  joinCommitMessage,
  patchTextOfAll,
  PROJECT_REVIEW_FILE,
  splitCommitMessage,
} from '@angkorgit/core';
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
  PaneEmpty,
  Textarea,
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { FileFilterInput } from '@/components/FileFilterInput';
import { confirmDialog } from '@/components/confirm';
import { useGraph } from '@/features/graph/store';
import { useRepo } from '@/features/repository/store';
import { useUndo } from '@/features/history/undoStore';
import { focusRequests, useUi } from '@/features/ui/store';
import { stepOpenDiffChange } from '@/features/diff/changeNav';
import { useSettings } from '@/features/settings/store';
import { openInEditor, preferredEditor, useEditors } from '@/features/settings/editors';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { AiResultPanel } from '@/features/ai/AiResultPanel';
import { ChangeMark } from '@/components/ChangeMark';
import { DirName } from '@/components/DirName';
import { EXPLAIN_WAIT_MESSAGES, REVIEW_WAIT_MESSAGES } from '@/features/ai/waitMessages';
import { commitReviewKeyFor, explainKeyFor, useAiWork } from '@/features/ai/workStore';
import { Avatar } from '@/components/Avatar';
import {
  FileTree,
  FileTreeFoldButton,
  INITIAL_FOLD,
  nextFold,
  treeIndent,
  type FileTreeFold,
  type FileTreeFoldState,
} from '@/components/FileTree';
import { basename, formatDate, isMac, timeAgo } from '@/shared/utils';

const DESCRIPTION_MIN = 72;
const DESCRIPTION_MAX = 360;

const diffPath = (diff: CommitFileInfo) => diff.path;
const entryPath = (entry: AllFilesEntry<CommitFileInfo>) => entry.path;

type ChangeKind = CommitFileInfo['status'];

const VIRTUAL_FILE_THRESHOLD = 200;
const FILE_ROW_HEIGHT = 34;

const statusMeta: Record<
  CommitFileInfo['status'],
  { label: string; mark: string; className: string; tone: 'info' | 'success' | 'danger' | 'primary' }
> = {
  modified: { label: 'modified', mark: 'M', className: 'text-info', tone: 'info' },
  new: { label: 'added', mark: 'A', className: 'text-success', tone: 'success' },
  deleted: { label: 'deleted', mark: 'D', className: 'text-danger', tone: 'danger' },
  renamed: { label: 'renamed', mark: 'R', className: 'text-primary', tone: 'primary' },
};

function ChangeFilter({
  diffs,
  value,
  onChange,
}: {
  diffs: CommitFileInfo[];
  value: ChangeKind | null;
  onChange: (kind: ChangeKind | null) => void;
}) {
  if (diffs.length === 0) return <>No changes</>;
  const order: ChangeKind[] = ['modified', 'new', 'deleted', 'renamed'];
  const parts = order
    .map((status) => ({ status, count: diffs.filter((d) => d.status === status).length }))
    .filter((p) => p.count > 0);
  const token = 'flex h-5 items-center gap-1 rounded px-1 tabular-nums transition-colors hover:bg-surface-raised';
  return (
    <span className="flex items-center gap-0.5 whitespace-nowrap" role="group" aria-label="Filter files by kind of change">
      <button
        type="button"
        aria-pressed={value === null}
        title="Show every file"
        className={cn(token, value === null ? 'bg-surface-raised font-medium text-foreground' : 'text-muted')}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {parts.map(({ status, count }) => (
        <button
          key={status}
          type="button"
          aria-pressed={value === status}
          aria-label={`${count} ${statusMeta[status].label}`}
          title={value === status ? 'Show every file' : `Show only ${statusMeta[status].label} files`}
          className={cn(
            token,
            statusMeta[status].className,
            value === status && 'bg-surface-raised font-medium',
            value !== null && value !== status && 'opacity-60',
          )}
          onClick={() => onChange(value === status ? null : status)}
        >
          <span className="font-mono">{statusMeta[status].mark}</span>
          {count}
        </button>
      ))}
    </span>
  );
}

function VirtualFileRows({
  diffs,
  scrollRef,
  renderRow,
}: {
  diffs: CommitFileInfo[];
  scrollRef: React.RefObject<HTMLDivElement>;
  renderRow: (diff: CommitFileInfo) => React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setScrollMargin((prev) => (prev === el.offsetTop ? prev : el.offsetTop));
  });
  const virtualizer = useVirtualizer({
    count: diffs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    getItemKey: (index) => diffs[index].path,
    overscan: 12,
    scrollMargin,
  });
  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          className="absolute left-0 w-full"
          style={{
            top: 0,
            height: item.size,
            transform: `translateY(${item.start - scrollMargin}px)`,
          }}
        >
          {renderRow(diffs[item.index])}
        </div>
      ))}
    </div>
  );
}

export function CommitDetails({
  commit,
  diffs,
  loading,
  error,
  onRetry,
}: {
  commit: CommitInfo;
  diffs: CommitFileInfo[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const select = useGraph((s) => s.select);
  const openCenterDiff = useUi((s) => s.openCenterDiff);
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);
  const centerDiff = useUi((s) => s.centerDiff);
  const fileView = useUi((s) => s.fileView);
  const fileTree = fileView !== 'list';
  const allMode = fileView === 'all';
  const repoPath = useRepo((s) => s.repo?.path ?? '');
  const editorId = useSettings((s) => s.editorId);
  const { editors } = useEditors();
  const editor = preferredEditor(editors, editorId);
  const stash = useRepo((s) => s.stashes.find((entry) => entry.oid === commit.oid) ?? null);
  const refreshStatus = useRepo((s) => s.refreshStatus);
  const explainKey = explainKeyFor(repoPath, commit.oid);
  const reviewKey = commitReviewKeyFor(repoPath, commit.oid);
  const aiText = useAiWork((s) => s.explains[explainKey] ?? null);
  const aiBusy = useAiWork((s) => !!s.explainBusy[explainKey]);
  const reviewText = useAiWork((s) => s.explains[reviewKey] ?? null);
  const reviewBusy = useAiWork((s) => !!s.explainBusy[reviewKey]);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [fold, setFold] = useState<FileTreeFold>(INITIAL_FOLD);
  const [foldState, setFoldState] = useState<FileTreeFoldState | null>(null);
  const [fileQuery, setFileQuery] = useState('');
  const fileFilterOpen = useUi((s) => s.fileFilterOpen);
  const fileFilterFocusSeq = useUi((s) => s.fileFilterFocusSeq);
  useEffect(() => {
    if (!fileFilterOpen) setFileQuery('');
  }, [fileFilterOpen]);
  const [kindFilter, setKindFilter] = useState<ChangeKind | null>(null);
  const filtering = fileQuery.trim().length > 0 || kindFilter !== null;
  const shownDiffs = useMemo(() => {
    const byQuery = filterFiles(diffs, diffPath, fileQuery);
    return kindFilter ? byQuery.filter((d) => d.status === kindFilter) : byQuery;
  }, [diffs, fileQuery, kindFilter]);
  const [tree, setTree] = useState<string[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeSeq, setTreeSeq] = useState(0);
  useEffect(() => {
    if (!allMode || !repoPath) return;
    let cancelled = false;
    setTree(null);
    setTreeError(null);
    void ipc
      .treeFiles(repoPath, commit.oid)
      .then((paths) => {
        if (!cancelled) setTree(paths);
      })
      .catch((error) => {
        if (!cancelled) setTreeError(String((error as { message?: string }).message ?? error));
      });
    return () => {
      cancelled = true;
    };
  }, [allMode, repoPath, commit.oid, treeSeq]);
  const allEntries = useMemo(
    () => (allMode && tree ? allFiles(tree, diffs, diffPath) : []),
    [allMode, tree, diffs],
  );
  const changedFolders = useMemo(() => foldersWithChanges(allEntries), [allEntries]);
  const shownEntries = useMemo(() => {
    const byQuery = filterFiles(allEntries, entryPath, fileQuery);
    return kindFilter ? byQuery.filter((e) => e.change?.status === kindFilter) : byQuery;
  }, [allEntries, fileQuery, kindFilter]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pickAnchor = useRef<string | null>(null);
  useEffect(() => {
    setFileQuery('');
    setKindFilter(null);
    setPicked(new Set());
    pickAnchor.current = null;
  }, [commit.oid]);
  useEffect(() => {
    if (picked.size === 0) return;
    const present = new Set(diffs.map((d) => d.path));
    if ([...picked].every((p) => present.has(p))) return;
    setPicked(new Set([...picked].filter((p) => present.has(p))));
  }, [diffs, picked]);

  const togglePick = (file: string, range: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (range && pickAnchor.current) {
        const order = shownDiffs.map((d) => d.path);
        const from = order.indexOf(pickAnchor.current);
        const to = order.indexOf(file);
        if (from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          for (const p of order.slice(a, b + 1)) next.add(p);
          return next;
        }
      }
      if (next.has(file)) next.delete(file);
      else next.add(file);
      pickAnchor.current = file;
      return next;
    });
  };
  const longBody = commit.body.split('\n').length > 8 || commit.body.length > 600;
  const unpushed = useRepo((s) => s.unpushed);
  const refresh = useRepo((s) => s.refresh);
  const reloadGraph = useGraph((s) => s.reload);
  const pushed = !unpushed.includes(commit.oid);
  const canReword = !stash;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const draftSummaryRef = useRef<HTMLTextAreaElement>(null);
  const draftBodyRef = useRef<HTMLTextAreaElement>(null);
  const [descHeight, setDescHeight] = useState<number | null>(null);
  const [descResizing, setDescResizing] = useState(false);
  const startDescResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const el = draftBodyRef.current;
    if (!el) return;
    const startY = event.clientY;
    const startHeight = el.getBoundingClientRect().height;
    setDescResizing(true);
    const onMove = (e: MouseEvent) => {
      setDescHeight(Math.round(Math.min(DESCRIPTION_MAX, Math.max(DESCRIPTION_MIN, startHeight + (e.clientY - startY)))));
    };
    const onUp = () => {
      setDescResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const originalMessage = joinCommitMessage(commit.summary, commit.body);
  const startEditing = useCallback(() => {
    if (!canReword) return;
    setDraft(joinCommitMessage(commit.summary, commit.body));
    setEditing(true);
  }, [canReword, commit.summary, commit.body]);
  useEffect(() => {
    setEditing(false);
    setSaving(false);
    setDescHeight(null);
  }, [commit.oid]);
  useEffect(() => {
    if (editing) draftSummaryRef.current?.focus();
  }, [editing]);
  const draftParts = splitCommitMessage(draft);
  useLayoutEffect(() => {
    const el = draftSummaryRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draftParts.summary]);
  const editMessageRequest = useUi((s) => s.editMessageRequest);
  useEffect(() => {
    if (!editMessageRequest || editMessageRequest.seq === focusRequests.editMessageConsumed) return;
    if (editMessageRequest.oid !== commit.oid) return;
    focusRequests.editMessageConsumed = editMessageRequest.seq;
    startEditing();
  }, [editMessageRequest, commit.oid, startEditing]);
  const canSave = draftParts.summary.trim().length > 0 && draft.trim() !== originalMessage.trim() && !saving;
  const cancelEditing = () => {
    setEditing(false);
    setDraft('');
  };
  const saveMessage = async () => {
    if (!canSave) return;
    if (pushed) {
      const ok = await confirmDialog({
        title: 'Rewrite a pushed commit?',
        description:
          'This commit is already on a remote. Saving rewrites it and every commit after it on this branch, so the next push has to be a force push, and anyone who pulled the branch will need to reset to the new history.',
        confirmLabel: 'Rewrite commit',
        destructive: true,
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const newOid = await useUndo.getState().tracked({
        path: repoPath,
        kind: 'reword',
        label: 'edit commit message',
        action: () => ipc.reword(repoPath, commit.oid, draft),
      });
      setEditing(false);
      toast.success('Commit message updated');
      await refresh();
      await reloadGraph(repoPath);
      select(newOid);
    } catch (error) {
      toast.error(`Could not update the message: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setSaving(false);
    }
  };
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEditing();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void saveMessage();
    }
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const activeIndex = shownDiffs.findIndex(
    (d) => centerDiff?.path === d.path && centerDiff.oid === (d.sourceOid ?? commit.oid),
  );
  const openFileAt = useCallback(
    (index: number) => {
      const d = shownDiffs[index];
      if (!d) return;
      openCenterDiff({ path: d.path, oid: d.sourceOid ?? commit.oid, oldPath: d.oldPath });
      requestAnimationFrame(() => {
        filesRef.current?.querySelector('[data-active-file]')?.scrollIntoView({ block: 'nearest' });
      });
    },
    [shownDiffs, openCenterDiff, commit.oid],
  );
  const inspectorFocusSeq = useUi((s) => s.inspectorFocusSeq);
  const wantFirstFile = useRef(false);
  useEffect(() => {
    if (inspectorFocusSeq === focusRequests.inspectorConsumed) return;
    focusRequests.inspectorConsumed = inspectorFocusSeq;
    filesRef.current?.focus();
    if (activeIndex >= 0) return;
    if (!loading && shownDiffs.length > 0) openFileAt(0);
    else wantFirstFile.current = true;
  }, [inspectorFocusSeq, activeIndex, loading, shownDiffs, openFileAt]);
  useEffect(() => {
    if (!wantFirstFile.current || loading || shownDiffs.length === 0) return;
    wantFirstFile.current = false;
    openFileAt(0);
  }, [loading, shownDiffs, openFileAt]);
  useEffect(() => {
    wantFirstFile.current = false;
  }, [commit.oid]);
  const onFilesKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (shownDiffs.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next =
        activeIndex < 0
          ? step === 1
            ? 0
            : shownDiffs.length - 1
          : Math.min(shownDiffs.length - 1, Math.max(0, activeIndex + step));
      openFileAt(next);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (shownDiffs.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowRight' && activeIndex >= 0 && stepOpenDiffChange(1) !== 'none') return;
      openFileAt(activeIndex < 0 ? 0 : activeIndex);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      closeCenterDiff();
      useUi.getState().focusGraph();
    }
  };

  const [fileMenu, setFileMenu] = useState<{
    x: number;
    y: number;
    path: string;
    oid: string;
    deleted: boolean;
    changed: boolean;
  } | null>(null);
  const restoreFromStash = async (files: string[]) => {
    if (!stash || files.length === 0) return;
    try {
      await ipc.stashRestoreFiles(repoPath, stash.index, files);
      await refreshStatus();
      toast.success(
        files.length === 1
          ? `Applied ${basename(files[0])} from the stash`
          : `Applied ${files.length} files from the stash`,
        { description: 'The stash itself is unchanged.' },
      );
      setPicked(new Set());
    } catch (error) {
      toast.error(`Apply failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const renderDiffRow = (diff: CommitFileInfo, depth?: number) => {
    const diffOid = diff.sourceOid ?? commit.oid;
    const active = centerDiff?.path === diff.path && centerDiff.oid === diffOid;
    const meta = statusMeta[diff.status];
    return (
      <Hint key={diff.path} label={diff.path} side="left" className="max-w-[34rem] font-mono">
        <div
          data-active-file={active || undefined}
          className={cn(
            'group flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-3 text-left text-xs transition-colors',
            active ? 'bg-primary/10 text-foreground' : 'hover:bg-surface-raised',
            stash && picked.has(diff.path) && !active && 'bg-primary/5',
          )}
          style={fileTree && depth !== undefined ? { paddingLeft: treeIndent(depth) } : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            setFileMenu({
              x: e.clientX,
              y: e.clientY,
              path: diff.path,
              oid: diffOid,
              deleted: diff.status === 'deleted',
              changed: true,
            });
          }}
        >
        {stash && (
          <Checkbox
            checked={picked.has(diff.path)}
            aria-label={`Select ${diff.path} to apply`}
            onCheckedChange={() => togglePick(diff.path, false)}
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey) {
                e.preventDefault();
                togglePick(diff.path, true);
              }
            }}
          />
        )}
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={(e) => {
            if (stash && (e.shiftKey || e.metaKey || e.ctrlKey)) {
              togglePick(diff.path, e.shiftKey);
              return;
            }
            if (active) closeCenterDiff();
            else openCenterDiff({ path: diff.path, oid: diffOid, oldPath: diff.oldPath });
          }}
        >
          <ChangeMark tone={meta?.tone ?? 'neutral'} title={meta?.label}>
            {meta?.mark ?? '?'}
          </ChangeMark>
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="max-w-full shrink-0 truncate">{basename(diff.path)}</span>
            {!fileTree && <DirName path={diff.path} className="text-[11px]" />}
          </span>
          {diff.additions > 0 && <span className="shrink-0 font-mono text-[11px] text-success">+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="shrink-0 font-mono text-[11px] text-danger">−{diff.deletions}</span>}
        </button>
        {stash && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Apply ${diff.path} from the stash`}
            className="-my-1 -mr-1 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => void restoreFromStash([diff.path])}
          >
            <ArchiveRestore className="size-3.5 text-primary" />
          </Button>
        )}
        </div>
      </Hint>
    );
  };

  const renderPlainRow = (file: string, depth?: number) => {
    const active = centerDiff?.path === file && centerDiff.oid === commit.oid && !!centerDiff.unchanged;
    return (
      <Hint key={`plain-${file}`} label={file} side="left" className="max-w-[34rem] font-mono">
        <div
          data-active-file={active || undefined}
          data-unchanged-file
          className={cn(
            'group flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-3 text-left text-xs transition-colors',
            active ? 'bg-primary/10 text-foreground' : 'text-muted hover:bg-surface-raised',
          )}
          style={fileTree && depth !== undefined ? { paddingLeft: treeIndent(depth) } : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            setFileMenu({ x: e.clientX, y: e.clientY, path: file, oid: commit.oid, deleted: false, changed: false });
          }}
        >
          {stash && <span className="size-4 shrink-0" />}
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => {
              if (active) closeCenterDiff();
              else openCenterDiff({ path: file, oid: commit.oid, unchanged: true });
            }}
          >
            <span className="flex w-4 shrink-0 justify-center">
              <FileIcon className="size-3.5 text-faint" />
            </span>
            <span className="min-w-0 flex-1 truncate">{basename(file)}</span>
          </button>
        </div>
      </Hint>
    );
  };

  const renderEntry = (entry: AllFilesEntry<CommitFileInfo>, depth?: number) =>
    entry.change ? renderDiffRow(entry.change, depth) : renderPlainRow(entry.path, depth);

  const runCommitAi = async (kind: 'explain' | 'review') => {
    const key = kind === 'review' ? reviewKey : explainKey;
    if (kind === 'review' ? reviewBusy : aiBusy) {
      useAiWork.getState().stopExplain(key);
      return;
    }
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    const run = useAiWork.getState().startExplain(key);
    const stillRunning = () => useAiWork.getState().isExplainRun(key, run);
    try {
      const fullDiffs = await ipc.diffCommit(repoPath, commit.oid);
      if (!stillRunning()) return;
      const patch = patchTextOfAll(fullDiffs);
      if (!patch.trim()) {
        toast.info('This commit has no text changes to send');
        return;
      }
      const context = { oid: commit.oid, summary: commit.summary, files: fullDiffs.map((d) => d.path) };
      let text: string;
      if (kind === 'review') {
        const projectInstructions = await ipc.readFile(repoPath, PROJECT_REVIEW_FILE).catch((error) => {
          if (stillRunning() && (error as { code?: string } | null)?.code !== 'not_found') {
            toast.warning(`Could not read ${PROJECT_REVIEW_FILE} — reviewing without project conventions`);
          }
          return '';
        });
        text = await aiCapabilities.reviewCommitChanges(getAiProvider(), patch, {
          ...context,
          instructions: useSettings.getState().aiStyle.review.instructions,
          projectInstructions,
        });
      } else {
        text = await aiCapabilities.explainCommitChanges(getAiProvider(), patch, context);
      }
      if (!stillRunning()) return;
      if (!text) {
        toast.error('The AI provider returned an empty answer — try again or check the model in Settings');
        return;
      }
      useAiWork.getState().setExplain(key, text);
    } catch (error) {
      if (stillRunning()) {
        toast.error(`AI request failed: ${(error as { message?: string } | null)?.message ?? String(error)}`);
      }
    } finally {
      useAiWork.getState().endExplain(key, run);
    }
  };

  return (
    <div ref={scrollRef} className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border-subtle px-4 pb-4 pt-3">
        {editing ? (
          <div
            data-message-editor
            className={cn(
              'rounded-md border border-border bg-surface shadow-sm transition-colors',
              'focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/60',
            )}
            onKeyDown={onEditorKeyDown}
          >
            <Textarea
              ref={draftSummaryRef}
              value={draftParts.summary}
              onChange={(e) => setDraft(joinCommitMessage(e.target.value, draftParts.body))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  draftBodyRef.current?.focus();
                }
              }}
              placeholder="Summary"
              aria-label="Commit summary"
              rows={1}
              spellCheck
              className="min-h-9 resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2 text-sm font-medium leading-snug text-foreground shadow-none placeholder:font-normal placeholder:text-faint focus-visible:border-0 focus-visible:ring-0"
            />
            <div className="mx-3 h-px bg-border-subtle" />
            <Textarea
              ref={draftBodyRef}
              value={draftParts.body}
              onChange={(e) => setDraft(joinCommitMessage(draftParts.summary, e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && draftParts.body.length === 0) {
                  e.preventDefault();
                  draftSummaryRef.current?.focus();
                }
              }}
              placeholder="Description"
              aria-label="Commit description"
              rows={Math.min(12, Math.max(3, draftParts.body.split('\n').length + 1))}
              style={descHeight === null ? undefined : { height: descHeight }}
              className="min-h-[72px] resize-none rounded-none border-0 bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-2 py-1.5">
              <span className="text-[11px] text-faint">{isMac ? '⌘⏎' : 'Ctrl+⏎'} to save · Esc to cancel</span>
              <span className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void saveMessage()} disabled={!canSave}>
                  {saving ? 'Saving…' : 'Save message'}
                </Button>
              </span>
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize description"
              title="Drag to resize · double-click to reset"
              onMouseDown={startDescResize}
              onDoubleClick={() => setDescHeight(null)}
              className="group/handle flex h-3 cursor-row-resize items-center justify-center"
            >
              <span
                className={cn(
                  'h-0.5 w-10 rounded-full transition-colors',
                  descResizing ? 'bg-primary' : 'bg-border group-hover/handle:bg-primary/60',
                )}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <h2
              className={cn(
                'min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]',
                canReword && 'cursor-text',
              )}
              title={canReword ? 'Double-click to edit the message' : undefined}
              onDoubleClick={startEditing}
            >
              {commit.summary}
            </h2>
            {!stash && (
              <Hint label={pushed ? 'Edit the commit message (already pushed, the next push must be forced)' : 'Edit the commit message'}>
                <span className="-mt-1 inline-flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted"
                    aria-label="Edit commit message"
                    disabled={!canReword}
                    onClick={startEditing}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </span>
              </Hint>
            )}
          </div>
        )}
        {commit.body && !editing && (
          <div className="mt-2">
            <pre
              className={cn(
                'whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted',
                longBody && !bodyExpanded && 'line-clamp-[8]',
                canReword && 'cursor-text',
              )}
              onDoubleClick={startEditing}
            >
              {commit.body}
            </pre>
            {longBody && (
              <button
                type="button"
                className="mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                onClick={() => setBodyExpanded((v) => !v)}
              >
                {bodyExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {bodyExpanded ? 'Show less' : 'Show full message'}
              </button>
            )}
          </div>
        )}

        <div className="mt-3 rounded-md border border-border-subtle bg-surface-raised/50 p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={commit.author.name} email={commit.author.email} oid={commit.oid} size={28} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-medium text-foreground">{commit.author.name}</span>
              <span className="truncate text-[11px] text-faint" title={formatDate(commit.author.time)}>
                {timeAgo(commit.author.time)} · {formatDate(commit.author.time)}
                {commit.committer.email !== commit.author.email && ` · committed by ${commit.committer.name}`}
              </span>
            </span>
            <Hint label="Copy full hash">
              <button
                className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 font-mono text-[11px] text-muted hover:text-foreground"
                aria-label="Copy commit hash"
                onClick={() => {
                  void navigator.clipboard.writeText(commit.oid);
                  toast.success('Commit hash copied');
                }}
              >
                {commit.shortOid} <Copy className="size-2.5" />
              </button>
            </Hint>
          </div>
          {(commit.parents.length > 0 || commit.refs.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2">
              {commit.parents.length > 0 && (
                <span className="text-[11px] text-faint">{commit.parents.length > 1 ? 'Parents' : 'Parent'}</span>
              )}
              {commit.parents.map((parent) => (
                <button
                  key={parent}
                  className="flex h-5 items-center rounded border border-border-subtle bg-surface px-1.5 font-mono text-[10px] text-muted hover:text-foreground"
                  onClick={() => select(parent)}
                  title="Show this commit"
                >
                  {parent.slice(0, 7)}
                </button>
              ))}
              {commit.refs.length > 0 && commit.parents.length > 0 && (
                <span className="mx-0.5 h-3 w-px bg-border-subtle" />
              )}
              {commit.refs.map((ref) => (
                <Badge
                  key={ref.name}
                  tone={ref.kind === 'tag' ? 'primary' : ref.kind === 'remoteBranch' ? 'info' : 'success'}
                  className="max-w-48"
                >
                  {ref.kind === 'tag' && <TagIcon className="size-2.5 shrink-0" />}
                  {ref.kind === 'remoteBranch' && <Cloud className="size-2.5 shrink-0" />}
                  {(ref.kind === 'localBranch' || ref.kind === 'head') && <Monitor className="size-2.5 shrink-0" />}
                  <span className="truncate">{ref.shorthand}</span>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted"
              onClick={() => void runCommitAi('explain')}
              disabled={loading}
            >
              {aiBusy ? (
                <>
                  <Logo size={14} animated="loop" className="logo-draw-loop" />
                  Stop explaining
                </>
              ) : (
                <>
                  <Sparkles className="text-primary" />
                  Explain with AI
                </>
              )}
            </Button>
            {!stash && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted"
                onClick={() => void runCommitAi('review')}
                disabled={loading}
              >
                {reviewBusy ? (
                  <>
                    <Logo size={14} animated="loop" className="logo-draw-loop" />
                    Stop reviewing
                  </>
                ) : (
                  <>
                    <SearchCheck className="text-primary" />
                    Review with AI
                  </>
                )}
              </Button>
            )}
        </div>
        <AiResultPanel
          title="AI explanation"
          icon={<Sparkles className="size-3.5" />}
          busy={aiBusy}
          waitMessages={EXPLAIN_WAIT_MESSAGES}
          text={aiText}
          onStop={() => useAiWork.getState().stopExplain(explainKey)}
          onDismiss={() => useAiWork.getState().setExplain(explainKey, null)}
          className="mt-1"
          bodyClassName="max-h-72"
        />
        <AiResultPanel
          title="AI review"
          icon={<SearchCheck className="size-3.5" />}
          busy={reviewBusy}
          waitMessages={REVIEW_WAIT_MESSAGES}
          text={reviewText}
          onStop={() => useAiWork.getState().stopExplain(reviewKey)}
          onDismiss={() => useAiWork.getState().setExplain(reviewKey, null)}
          className="mt-1"
          bodyClassName="max-h-72"
        />
      </div>

      <div
        ref={filesRef}
        tabIndex={0}
        aria-label="Commit files"
        onKeyDown={onFilesKeyDown}
        className="rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <p className="mb-1 flex items-center justify-between gap-2 border-b border-border-subtle px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
          <span className="shrink-0">
            Files
            {!loading && !error && (
              <span className="ml-1 text-faint">
                {allMode && tree ? (
                  filtering ? (
                    <>
                      {shownEntries.length} <span className="font-normal normal-case tracking-normal">of {allEntries.length}</span>
                    </>
                  ) : (
                    <>
                      {allEntries.length}{' '}
                      <span className="font-normal normal-case tracking-normal">· {diffs.length} changed</span>
                    </>
                  )
                ) : filtering ? (
                  <>
                    {shownDiffs.length} <span className="font-normal normal-case tracking-normal">of {diffs.length}</span>
                  </>
                ) : (
                  diffs.length
                )}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[11px] font-normal normal-case tracking-normal">
            {loading ? 'Loading…' : error ? '' : <ChangeFilter diffs={diffs} value={kindFilter} onChange={setKindFilter} />}
            {fileTree && !loading && !error && (
              <FileTreeFoldButton state={foldState} onFold={(mode) => setFold((f) => nextFold(f, mode))} />
            )}
          </span>
        </p>
        {stash && !loading && !error && diffs.length > 0 && (
          <div className="mb-1.5 flex min-h-7 items-center gap-2 rounded-md border border-border-subtle bg-surface-raised/50 px-2 py-1 text-[11px]">
            {picked.size === 0 ? (
              <>
                <span className="min-w-0 flex-1 text-faint">
                  This is a stash. Tick files to apply only those to the working copy.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[11px]"
                  onClick={() => setPicked(new Set(shownDiffs.map((d) => d.path)))}
                >
                  Select all
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-muted">
                  {picked.size} of {diffs.length} selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[11px]"
                  onClick={() => setPicked(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[11px]"
                  onClick={() => void restoreFromStash([...picked])}
                >
                  <ArchiveRestore className="size-3" /> Apply {picked.size} {picked.size === 1 ? 'file' : 'files'}
                </Button>
              </>
            )}
          </div>
        )}
        {!loading && !error && fileFilterOpen && (
          <div className="mb-1 px-0.5">
            <FileFilterInput
              value={fileQuery}
              onChange={setFileQuery}
              onClose={() => useUi.getState().setFileFilterOpen(false)}
            focusSeq={fileFilterFocusSeq}
              placeholder="Filter files…"
            />
          </div>
        )}
        {loading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-surface-raised" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 text-xs text-danger [overflow-wrap:anywhere]">
              Could not load changes: {error}
            </span>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : allMode ? (
          treeError ? (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 text-xs text-danger [overflow-wrap:anywhere]">
                Could not list the files: {treeError}
              </span>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setTreeSeq((n) => n + 1)}>
                Retry
              </Button>
            </div>
          ) : tree === null ? (
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-7 animate-pulse rounded-md bg-surface-raised" />
              ))}
            </div>
          ) : shownEntries.length === 0 ? (
            filtering ? (
              <p className="px-2 py-1.5 text-xs text-faint">No files match the filter.</p>
            ) : (
              <PaneEmpty
                icon={<FileText />}
                title="No files"
                description="This commit did not change any files."
              />
            )
          ) : (
            <FileTree
              items={shownEntries}
              pathOf={entryPath}
              renderFile={renderEntry}
              fold={fold}
              onFoldState={setFoldState}
              defaultCollapsed={(folder) => !changedFolders.has(folder)}
            />
          )
        ) : shownDiffs.length === 0 && filtering ? (
          <p className="px-2 py-1.5 text-xs text-faint">No files match the filter.</p>
        ) : fileTree ? (
          <FileTree items={shownDiffs} pathOf={diffPath} renderFile={renderDiffRow} fold={fold} onFoldState={setFoldState} />
        ) : shownDiffs.length > VIRTUAL_FILE_THRESHOLD ? (
          <VirtualFileRows diffs={shownDiffs} scrollRef={scrollRef} renderRow={renderDiffRow} />
        ) : (
          shownDiffs.map((diff) => renderDiffRow(diff))
        )}
      </div>
      {fileMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setFileMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: fileMenu.x, top: fileMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{fileMenu.path}</DropdownMenuLabel>
            {stash && fileMenu.changed && (
              <>
                <DropdownMenuItem onClick={() => void restoreFromStash([fileMenu.path])}>
                  <ArchiveRestore /> Apply this file to the working copy
                </DropdownMenuItem>
                {picked.size > 1 && picked.has(fileMenu.path) && (
                  <DropdownMenuItem onClick={() => void restoreFromStash([...picked])}>
                    <ArchiveRestore /> Apply {picked.size} selected files
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              disabled={fileMenu.deleted}
              onClick={() => useUi.getState().openEditor(fileMenu.path)}
            >
              <Pencil /> Edit file
            </DropdownMenuItem>
            {editor && (
              <DropdownMenuItem
                disabled={fileMenu.deleted}
                onClick={() => void openInEditor(editor.id, `${repoPath}/${fileMenu.path}`)}
              >
                <Code /> Open in {editor.label}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => useUi.getState().openFileHistory(fileMenu.path)}>
              <History /> File history
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={fileMenu.deleted}
              onClick={() => useUi.getState().openBlame(fileMenu.path, fileMenu.oid)}
            >
              <UserRoundSearch /> Blame at this commit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={fileMenu.deleted}
              onClick={() =>
                void ipc
                  .openPath(`${repoPath}/${fileMenu.path}`)
                  .catch((error) =>
                    toast.error(`Could not open the file: ${(error as { message?: string }).message ?? error}`),
                  )
              }
            >
              <ExternalLink /> Open in external app
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={fileMenu.deleted}
              onClick={() =>
                void ipc
                  .revealPath(`${repoPath}/${fileMenu.path}`)
                  .catch((error) =>
                    toast.error(`Could not reveal the file: ${(error as { message?: string }).message ?? error}`),
                  )
              }
            >
              <FolderOpen /> {isMac ? 'Show in Finder' : 'Show in file manager'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(fileMenu.path);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(`${repoPath}/${fileMenu.path}`);
                toast.success('Absolute path copied');
              }}
            >
              <Copy /> Copy absolute path
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
