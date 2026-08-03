import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Filter, GitBranchPlus, ListRestart, RotateCcw, Search, Tag as TagIcon, User, X } from 'lucide-react';
import type { CommitInfo } from '@angkorgit/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Spinner,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from './store';
import { useUi } from '@/features/ui/store';
import { CommitRow, ROW_HEIGHT } from './GraphRow';
import { WipRow } from './WipRow';

interface MenuState {
  x: number;
  y: number;
  commit: CommitInfo;
}

export function CommitGraph() {
  const repo = useRepo((s) => s.repo);
  const refresh = useRepo((s) => s.refresh);
  const { rows, commits, maxLane, hasMore, loading, filters, selectedOid, loadMore, reload, setFilters, select } =
    useGraph();
  const openDialog = useUi((s) => s.openDialog);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [authorDraft, setAuthorDraft] = useState(filters.author);

  const path = repo?.path ?? '';

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Infinite scroll: request the next page as the tail approaches.
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows.length - 40 && hasMore && !loading && path) {
      void loadMore(path);
    }
  }, [items, rows.length, hasMore, loading, path, loadMore]);

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchDraft !== filters.search || authorDraft !== filters.author) {
        setFilters(path, { search: searchDraft, author: authorDraft });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, authorDraft, filters.search, filters.author, path, setFilters]);

  const gutterWidth = Math.min(16 + (maxLane + 1) * 14, 200);

  const act = useCallback(
    async (label: string, op: () => Promise<unknown>) => {
      try {
        const result = (await op()) as { status?: string; message?: string } | undefined;
        if (result?.status === 'conflicts') toast.warning(result.message);
        else toast.success(result?.message ?? `${label} done`);
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

  return (
    <section className="flex h-full flex-col bg-background" aria-label="Commit history">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3 py-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search commits…"
            className="h-7 pl-8 text-xs"
          />
        </div>
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
            {commits.length.toLocaleString()} commit{commits.length === 1 ? '' : 's'}
            {hasMore ? '+' : ''}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="table" aria-label="Commits">
        <WipRow gutterWidth={gutterWidth} />
        {rows.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            No commits found
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = rows[item.index];
              const commit = commits[item.index];
              if (!row || !commit) return null;
              return (
                <motion.div
                  key={commit.oid}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
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
                    selected={selectedOid === commit.oid}
                    onSelect={select}
                    onContextMenu={onContextMenu}
                  />
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {menu && (
        <DropdownMenu open onOpenChange={(o) => !o && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="font-mono">{menu.commit.shortOid}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => void act('Checkout', () => ipc.checkoutDetached(path, menu.commit.oid))}
            >
              Checkout commit (detached)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog('createBranch', menu.commit.oid)}>
              <GitBranchPlus /> Create branch here…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog('createTag', menu.commit.oid)}>
              <TagIcon /> Create tag here…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void act('Cherry-pick', () => ipc.cherryPick(path, menu.commit.oid))}>
              <ListRestart /> Cherry-pick onto current branch
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void act('Soft reset', () => ipc.reset(path, menu.commit.oid, 'soft'))}>
              <RotateCcw /> Reset here (soft)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void act('Mixed reset', () => ipc.reset(path, menu.commit.oid, 'mixed'))}>
              <RotateCcw /> Reset here (mixed)
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onClick={() => {
                if (window.confirm('Hard reset discards all uncommitted work. Continue?')) {
                  void act('Hard reset', () => ipc.reset(path, menu.commit.oid, 'hard'));
                }
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
