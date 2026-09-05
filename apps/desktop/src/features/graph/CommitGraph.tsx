import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { toastOutcome } from '@/shared/toastOutcome';
import { ArrowDownToLine, ArrowUpFromLine, Check, Combine, Copy, Filter, FolderTree, GitBranchPlus, Settings2, GitMerge, ListOrdered, ListRestart, RotateCcw, Search, Tag as TagIcon, Trash2, Undo2, User, X } from 'lucide-react';
import type { CommitInfo, RefInfo } from '@angkorgit/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Input,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from './store';
import { useUi } from '@/features/ui/store';
import { useUndo, type UndoKind } from '@/features/history/undoStore';
import { AUTHOR_COL_WIDTH, CommitRow, FLAT_GUTTER_WIDTH, GUTTER_GAP, LANE_WIDTH, REF_COL_WIDTH, ROW_HEIGHT } from './GraphRow';
import { WipRow } from './WipRow';
import { confirmDialog } from '@/components/confirm';
import { useShortcuts } from '@/shared/useShortcuts';

const HASH_QUERY = /^[0-9a-f]{4,40}$/i;
const AMBIGUOUS_HASH_MAX = 6;

interface MenuState {
  x: number;
  y: number;
  commit: CommitInfo;
}

interface RefMenuState {
  x: number;
  y: number;
  ref: RefInfo;
}

export function CommitGraph() {
  const repo = useRepo((s) => s.repo);
  const refresh = useRepo((s) => s.refresh);
  const worktrees = useRepo((s) => s.worktrees);
  const { rows, commits, maxLane, hasMore, loading, error, filters, selectedOid, selectedOids, pendingScrollIndex, loadMore, reload, setFilters, select, toggleSelect, rangeSelect, jumpTo, clearPendingScroll } =
    useGraph();
  const openDialog = useUi((s) => s.openDialog);
  const graphColumns = useUi((s) => s.graphColumns);
  const setGraphColumn = useUi((s) => s.setGraphColumn);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [refMenu, setRefMenu] = useState<RefMenuState | null>(null);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [authorDraft, setAuthorDraft] = useState(filters.author);
  const [jumpedOid, setJumpedOid] = useState<string | null>(null);
  const [jumpMiss, setJumpMiss] = useState(false);
  const jumpedRef = useRef('');
  const draftsRef = useRef({ search: '', author: '' });
  draftsRef.current = { search: searchDraft, author: authorDraft };
  const searchInputRef = useRef<HTMLInputElement>(null);

  const path = repo?.path ?? '';

  const worktreeBranches = useMemo(() => {
    const map = new Map<string, string>();
    for (const wt of worktrees) if (wt.branch && !wt.isCurrent) map.set(wt.branch, wt.name);
    return map;
  }, [worktrees]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows.length - 40 && hasMore && !loading && !error && path) {
      void loadMore(path);
    }
  }, [items, rows.length, hasMore, loading, error, path, loadMore]);

  const runJump = useCallback(
    (rev: string) => {
      void jumpTo(path, rev).then((oid) => {
        if (useGraph.getState().lastPath !== path) return;
        if (draftsRef.current.search.trim() !== rev || draftsRef.current.author) return;
        if (oid) {
          jumpedRef.current = rev;
          setJumpedOid(oid);
          setJumpMiss(false);
          return;
        }
        if (rev.length <= AMBIGUOUS_HASH_MAX) {
          jumpedRef.current = rev;
          setJumpedOid(null);
          setJumpMiss(false);
          setFilters(path, { search: rev, author: '' });
          return;
        }
        setJumpMiss(true);
      });
    },
    [jumpTo, path, setFilters],
  );

  useEffect(() => {
    const trimmed = searchDraft.trim();
    const hashLike = HASH_QUERY.test(trimmed);
    if (jumpedRef.current && jumpedRef.current !== trimmed) {
      jumpedRef.current = '';
      setJumpMiss(false);
    }
    const timer = setTimeout(() => {
      if (hashLike && !authorDraft) {
        if (jumpedRef.current !== trimmed) runJump(trimmed);
        return;
      }
      if (searchDraft !== filters.search || authorDraft !== filters.author) {
        setJumpedOid(null);
        setJumpMiss(false);
        setFilters(path, { search: searchDraft, author: authorDraft });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, authorDraft, filters.search, filters.author, path, setFilters, runJump]);

  useEffect(() => {
    if (!jumpedOid || selectedOid === jumpedOid) return;
    setJumpedOid(null);
    setJumpMiss(false);
    jumpedRef.current = '';
    setSearchDraft('');
  }, [selectedOid, jumpedOid]);

  useEffect(() => {
    if (pendingScrollIndex === null || pendingScrollIndex >= rows.length) return;
    virtualizer.scrollToIndex(pendingScrollIndex, { align: 'center' });
    clearPendingScroll();
  }, [pendingScrollIndex, rows.length, virtualizer, clearPendingScroll]);

  const flat = Boolean(filters.search || filters.author);
  const gutterWidth = flat ? FLAT_GUTTER_WIDTH : Math.min(16 + (maxLane + 1) * LANE_WIDTH, 280);
  const filtersActive = Boolean(filters.search || filters.author || filters.branch);

  const moveSelection = useCallback(
    (step: 1 | -1 | 'home' | 'end') => {
      const ui = useUi.getState();
      if (ui.centerDiff || ui.centerEditor || ui.centerFileHistory || ui.paletteOpen || ui.dialog || ui.conflictFile) return;
      if (commits.length === 0) return;
      const current = commits.findIndex((c) => c.oid === selectedOid);
      const next =
        step === 'home'
          ? 0
          : step === 'end'
            ? commits.length - 1
            : current === -1
              ? step === 1
                ? 0
                : commits.length - 1
              : Math.min(commits.length - 1, Math.max(0, current + step));
      select(commits[next].oid);
      virtualizer.scrollToIndex(next, { align: 'auto' });
    },
    [commits, selectedOid, select, virtualizer],
  );

  const keyNav = useMemo(
    () => [
      { combo: 'arrowdown', handler: () => moveSelection(1) },
      { combo: 'arrowup', handler: () => moveSelection(-1) },
      { combo: 'home', handler: () => moveSelection('home') },
      { combo: 'end', handler: () => moveSelection('end') },
      {
        combo: 'mod+f',
        handler: () => {
          const ui = useUi.getState();
          if (ui.centerDiff || ui.centerEditor || ui.centerFileHistory || ui.paletteOpen || ui.dialog || ui.conflictFile) return;
          searchInputRef.current?.select();
        },
      },
    ],
    [moveSelection],
  );
  useShortcuts(keyNav);

  const act = useCallback(
    async (
      label: string,
      op: () => Promise<unknown>,
      undoable?: { kind: UndoKind; extra?: Record<string, string> },
    ) => {
      try {
        const run = undoable
          ? () =>
              useUndo.getState().tracked({
                path,
                kind: undoable.kind,
                label,
                extra: undoable.extra,
                action: op,
                shouldRecord: (r) => {
                  const status = (r as { status?: string } | undefined)?.status;
                  return status === undefined || status === 'ok' || status === 'fast_forward';
                },
              })
          : op;
        const result = (await run()) as { status?: string; message?: string } | undefined;
        toastOutcome(result, `${label} done`);
        await refresh();
        await reload(path);
      } catch (error) {
        toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
      }
    },
    [refresh, reload, path],
  );

  const onContextMenu = useCallback((event: React.MouseEvent, commit: CommitInfo) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, commit });
  }, []);

  const onRowSelect = useCallback(
    (oid: string, event: React.MouseEvent) => {
      if (event.shiftKey) rangeSelect(oid);
      else if (event.metaKey || event.ctrlKey) toggleSelect(oid);
      else select(oid);
    },
    [select, toggleSelect, rangeSelect],
  );

  const multiSelection = useMemo(() => {
    if (!menu || selectedOids.length < 2 || !selectedOids.includes(menu.commit.oid)) return null;
    const indices = selectedOids.map((oid) => commits.findIndex((c) => c.oid === oid));
    if (indices.some((i) => i < 0)) return null;
    if (indices.some((i) => commits[i].parents.length > 1)) return null;
    const min = Math.min(...indices);
    const max = Math.max(...indices);
    const baseOid = commits[max].parents[0];
    if (!baseOid) return null;
    return {
      baseOid,
      count: selectedOids.length,
      contiguous: max - min === selectedOids.length - 1,
    };
  }, [menu, selectedOids, commits]);

  const pickSelection = useMemo(() => {
    if (!menu || selectedOids.length < 2 || !selectedOids.includes(menu.commit.oid)) return null;
    const indices = selectedOids.map((oid) => commits.findIndex((c) => c.oid === oid));
    if (indices.some((i) => i < 0)) return null;
    if (indices.some((i) => commits[i].parents.length > 1)) return null;
    return [...indices].sort((a, b) => b - a).map((i) => commits[i].oid);
  }, [menu, selectedOids, commits]);

  const checkoutRef = useCallback(
    (ref: RefInfo) => {
      const held = ref.kind === 'localBranch' ? worktrees.find((w) => w.branch === ref.shorthand && !w.isCurrent) : undefined;
      if (held && !held.isMissing) {
        void useRepo
          .getState()
          .open(held.path)
          .catch((error) =>
            toast.error(`Could not open ${held.name}: ${(error as { message?: string }).message ?? error}`),
          );
        return;
      }
      void act(`Checkout ${ref.shorthand}`, () => ipc.checkout(path, ref.shorthand), {
        kind: 'checkout',
      });
    },
    [act, path, worktrees],
  );

  const onRefMenu = useCallback((event: React.MouseEvent, ref: RefInfo) => {
    setRefMenu({ x: event.clientX, y: event.clientY, ref });
  }, []);

  return (
    <section className="flex h-full flex-col bg-background" aria-label="Commit history">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3 py-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            ref={searchInputRef}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const trimmed = searchDraft.trim();
              if (HASH_QUERY.test(trimmed) && !authorDraft) {
                jumpedRef.current = '';
                runJump(trimmed);
              }
            }}
            placeholder="Search commits…"
            className="h-7 pl-8 text-xs"
          />
        </div>
        {jumpMiss && <span className="text-xs text-danger">Commit not found</span>}
        <div className="relative w-44">
          <User className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={authorDraft}
            onChange={(e) => setAuthorDraft(e.target.value)}
            placeholder="Filter author…"
            className="h-7 pl-8 text-xs"
          />
        </div>
        {filters.branch && (
          <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
            <Filter className="size-3" />
            {filters.branch}
            <button aria-label="Clear branch filter" onClick={() => setFilters(path, { branch: '' })}>
              <X className="size-3" />
            </button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-faint">
          {loading && <Spinner className="size-3.5" />}
          <span>
            {commits.length.toLocaleString()}
            {hasMore ? '+' : ''} commit{commits.length === 1 && !hasMore ? '' : 's'}
          </span>
          <DropdownMenu>
            <Hint label="Graph display">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Graph display options">
                  <Settings2 className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show in graph</DropdownMenuLabel>
              {(
                [
                  ['refs', 'Branches and tags'],
                  ['message', 'Commit message'],
                  ['author', 'Author'],
                  ['hash', 'Hash'],
                  ['date', 'Date'],
                ] as const
              ).map(([key, label]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={graphColumns[key]}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) => setGraphColumn(key, checked === true)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        className={cn(
          'flex h-6 shrink-0 select-none items-center gap-2 border-b border-border-subtle bg-surface pr-2 text-[10px] font-semibold uppercase tracking-wide text-faint',
          graphColumns.refs || flat ? 'pl-1' : 'pl-4',
        )}
        aria-hidden
      >
        {!flat && graphColumns.refs && (
          <span className="-mr-2 shrink-0 truncate" style={{ width: REF_COL_WIDTH }}>
            Branch / tag
          </span>
        )}
        <span className="shrink-0 truncate" style={{ width: gutterWidth, marginRight: flat ? 0 : GUTTER_GAP }}>
          {flat ? '' : 'Graph'}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {flat && graphColumns.refs ? 'Branch / tag · message' : graphColumns.message ? 'Message' : ''}
        </span>
        {graphColumns.author && (
          <span className="shrink-0 truncate" style={{ width: AUTHOR_COL_WIDTH }}>
            Author
          </span>
        )}
        {graphColumns.hash && <span className="w-14 shrink-0 text-right">Hash</span>}
        {graphColumns.date && <span className="w-[4.5rem] shrink-0 text-right">Date</span>}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="table" aria-label="Commits">
        <WipRow gutterWidth={gutterWidth} flat={flat} showRefs={graphColumns.refs} />
        {rows.length === 0 && !loading ? (
          error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-danger">
              <span className="[overflow-wrap:anywhere]">Could not load the history: {error}</span>
              <Button variant="ghost" size="sm" onClick={() => void reload(path)}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-faint">
              <span>{filtersActive ? 'No commits match these filters' : 'No commits yet'}</span>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchDraft('');
                    setAuthorDraft('');
                    setFilters(path, { search: '', author: '', branch: '' });
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = rows[item.index];
              const commit = commits[item.index];
              if (!row || !commit) return null;
              return (
                <div
                  key={commit.oid}
                  className={
                    jumpedOid === commit.oid
                      ? 'rounded-md ring-1 ring-inset ring-primary/60'
                      : undefined
                  }
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <CommitRow
                    commit={commit}
                    row={row}
                    gutterWidth={gutterWidth}
                    flat={flat}
                    selected={selectedOid === commit.oid || selectedOids.includes(commit.oid)}
                    columns={graphColumns}
                    worktrees={worktreeBranches}
                    onSelect={onRowSelect}
                    onContextMenu={onContextMenu}
                    onCheckoutRef={checkoutRef}
                    onRefMenu={onRefMenu}
                  />
                </div>
              );
            })}
          </div>
        )}
        {error && rows.length > 0 && !loading && (
          <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-danger">
            <span className="[overflow-wrap:anywhere]">Could not load more commits: {error}</span>
            <button className="shrink-0 underline underline-offset-2" onClick={() => void reload(path)}>
              Retry
            </button>
          </div>
        )}
      </div>

      {refMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setRefMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: refMenu.x, top: refMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{refMenu.ref.shorthand}</DropdownMenuLabel>
            {refMenu.ref.kind !== 'tag' && (
              <>
                <DropdownMenuItem onClick={() => checkoutRef(refMenu.ref)}>
                  <Check /> Checkout {refMenu.ref.shorthand}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void act(`Merge ${refMenu.ref.shorthand}`, () => ipc.merge(path, refMenu.ref.shorthand, true), {
                      kind: 'merge',
                      extra: { branch: refMenu.ref.shorthand },
                    })
                  }
                >
                  <GitMerge /> Merge into current branch
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void act(`Rebase onto ${refMenu.ref.shorthand}`, () => ipc.rebase(path, refMenu.ref.shorthand), {
                      kind: 'rebase',
                    })
                  }
                >
                  <ListRestart /> Rebase current branch onto this
                </DropdownMenuItem>
                {refMenu.ref.kind === 'localBranch' && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        void act(`Pull ${refMenu.ref.shorthand}`, () =>
                          ipc.pullBranch(path, refMenu.ref.shorthand),
                        )
                      }
                    >
                      <ArrowDownToLine /> Pull
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        void act(`Push ${refMenu.ref.shorthand}`, () =>
                          ipc.push(path, 'origin', false, false, true, refMenu.ref.shorthand),
                        )
                      }
                    >
                      <ArrowUpFromLine /> Push
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(refMenu.ref.shorthand);
                toast.success('Name copied');
              }}
            >
              <Copy /> Copy name
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {menu && (
        <DropdownMenu open onOpenChange={(o) => !o && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="font-mono">{menu.commit.shortOid}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => void act(`Checkout ${menu.commit.shortOid}`, () => ipc.checkoutDetached(path, menu.commit.oid), { kind: 'checkout' })}
            >
              Checkout commit (detached)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog('createBranch', menu.commit.oid)}>
              <GitBranchPlus /> Create branch here…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog('createTag', menu.commit.oid)}>
              <TagIcon /> Create tag here…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog('createWorktree', { oid: menu.commit.oid })}>
              <FolderTree /> New worktree from here…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {pickSelection ? (
              <DropdownMenuItem onClick={() => openDialog('cherryPick', { oids: pickSelection })}>
                <ListRestart /> Cherry-pick {pickSelection.length} commits onto current branch…
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => openDialog('cherryPick', menu.commit.oid)}>
                <ListRestart /> Cherry-pick onto current branch…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                void act(`Revert ${menu.commit.shortOid}`, () => ipc.revert(path, menu.commit.oid), {
                  kind: 'revert',
                })
              }
            >
              <Undo2 /> Revert commit
            </DropdownMenuItem>
            {multiSelection?.contiguous && (
              <DropdownMenuItem
                onClick={() =>
                  openDialog('interactiveRebase', {
                    baseOid: multiSelection.baseOid,
                    squashOids: selectedOids,
                  })
                }
              >
                <Combine /> Squash {multiSelection.count} commits
              </DropdownMenuItem>
            )}
            {multiSelection && (
              <DropdownMenuItem
                destructive
                onClick={() =>
                  openDialog('interactiveRebase', {
                    baseOid: multiSelection.baseOid,
                    dropOids: selectedOids,
                  })
                }
              >
                <Trash2 /> Drop {multiSelection.count} commits
              </DropdownMenuItem>
            )}
            {!menu.commit.isHead && (
              <DropdownMenuItem onClick={() => openDialog('interactiveRebase', menu.commit.oid)}>
                <ListOrdered /> Interactively rebase onto here…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void act(`Soft reset to ${menu.commit.shortOid}`, () => ipc.reset(path, menu.commit.oid, 'soft'), { kind: 'reset' })}>
              <RotateCcw /> Reset here (soft)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void act(`Mixed reset to ${menu.commit.shortOid}`, () => ipc.reset(path, menu.commit.oid, 'mixed'), { kind: 'reset' })}>
              <RotateCcw /> Reset here (mixed)
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onClick={() => {
                void confirmDialog({
                  title: `Hard reset to ${menu.commit.shortOid}?`,
                  description:
                    'HEAD, the index and your working tree will all move to this commit. Uncommitted work is discarded and cannot be recovered.',
                  confirmLabel: 'Hard reset',
                  destructive: true,
                }).then((ok) => {
                  if (ok)
                    void act(`Hard reset to ${menu.commit.shortOid}`, () => ipc.reset(path, menu.commit.oid, 'hard'), {
                      kind: 'reset',
                    });
                });
              }}
            >
              <RotateCcw /> Reset here (hard)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  );
}
