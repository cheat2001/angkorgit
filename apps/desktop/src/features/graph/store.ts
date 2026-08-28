import { create } from 'zustand';
import type { CommitInfo } from '@angkorgit/core';
import { GraphLayout, flatGraphRows, type GraphRow } from '@angkorgit/core';
import { ipc } from '@/core/ipc';

const PAGE_SIZE = 200;

interface GraphFilters {
  search: string;
  author: string;
  branch: string;
}

const isFlat = (filters: GraphFilters) => Boolean(filters.search || filters.author);

interface GraphState {
  commits: CommitInfo[];
  rows: readonly GraphRow[];
  maxLane: number;
  hasMore: boolean;
  loading: boolean;
  filters: GraphFilters;
  selectedOid: string | null;
  selectedOids: string[];
  layout: GraphLayout;
  lastPath: string | null;
  pendingScrollIndex: number | null;

  reload: (path: string) => Promise<void>;
  loadMore: (path: string) => Promise<void>;
  setFilters: (path: string, filters: Partial<GraphFilters>) => void;
  select: (oid: string | null) => void;
  toggleSelect: (oid: string) => void;
  rangeSelect: (oid: string) => void;
  jumpTo: (path: string, rev: string) => Promise<string | null>;
  clearPendingScroll: () => void;
}

let requestSeq = 0;

export const useGraph = create<GraphState>((set, get) => ({
  commits: [],
  rows: [],
  maxLane: 0,
  hasMore: true,
  loading: false,
  filters: { search: '', author: '', branch: '' },
  selectedOid: null,
  selectedOids: [],
  layout: new GraphLayout(),
  lastPath: null,
  pendingScrollIndex: null,

  reload: async (path: string) => {
    if (get().lastPath !== path) {
      set({
        commits: [],
        rows: [],
        maxLane: 0,
        hasMore: true,
        selectedOid: null,
        selectedOids: [],
        filters: { search: '', author: '', branch: '' },
        layout: new GraphLayout(),
        lastPath: path,
        pendingScrollIndex: null,
      });
    }
    const { filters } = get();
    const seq = ++requestSeq;
    set({ loading: true });
    try {
      const page = await ipc.history(path, {
        skip: 0,
        limit: PAGE_SIZE,
        search: filters.search || undefined,
        author: filters.author || undefined,
        branch: filters.branch || undefined,
      });
      if (seq !== requestSeq || get().lastPath !== path) return;
      const layout = new GraphLayout();
      const flat = isFlat(filters);
      if (!flat) layout.add(page.commits);
      set({
        commits: page.commits,
        rows: flat ? flatGraphRows(page.commits) : layout.getRows(),
        maxLane: flat ? 0 : layout.maxLane,
        hasMore: page.hasMore,
        layout,
        loading: false,
      });
    } catch {
      if (seq === requestSeq) set({ loading: false });
    }
  },

  loadMore: async (path: string) => {
    const { commits, hasMore, loading, filters, layout } = get();
    if (!hasMore || loading) return;
    const seq = ++requestSeq;
    set({ loading: true });
    try {
      const page = await ipc.history(path, {
        skip: commits.length,
        limit: PAGE_SIZE,
        search: filters.search || undefined,
        author: filters.author || undefined,
        branch: filters.branch || undefined,
      });
      if (seq !== requestSeq || get().lastPath !== path || get().layout !== layout) return;
      const flat = isFlat(filters);
      if (!flat) layout.add(page.commits);
      set({
        commits: [...commits, ...page.commits],
        rows: flat
          ? [...get().rows, ...flatGraphRows(page.commits, commits.length)]
          : [...layout.getRows()],
        maxLane: flat ? 0 : layout.maxLane,
        hasMore: page.hasMore,
        loading: false,
      });
    } catch {
      if (seq === requestSeq) set({ loading: false });
    }
  },

  setFilters: (path, partial) => {
    set((s) => ({ filters: { ...s.filters, ...partial } }));
    void get().reload(path);
  },

  select: (oid) => set({ selectedOid: oid, selectedOids: oid ? [oid] : [] }),

  jumpTo: async (path, rev) => {
    const target = await ipc.historyPosition(path, rev);
    if (!target || get().lastPath !== path) return null;

    const { filters } = get();
    if (filters.search || filters.author || filters.branch) {
      set({ filters: { search: '', author: '', branch: '' } });
      await get().reload(path);
      if (get().lastPath !== path) return null;
    }

    while (get().lastPath === path && get().hasMore && get().commits.length <= target.index) {
      const before = get().commits.length;
      await get().loadMore(path);
      if (get().commits.length === before) {
        if (!get().loading) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (get().lastPath !== path) return null;

    const commits = get().commits;
    const index =
      commits[target.index]?.oid === target.oid
        ? target.index
        : commits.findIndex((c) => c.oid === target.oid);
    if (index === -1) return null;
    get().select(target.oid);
    set({ pendingScrollIndex: index });
    return target.oid;
  },

  clearPendingScroll: () => set({ pendingScrollIndex: null }),

  toggleSelect: (oid) =>
    set((s) => ({
      selectedOid: oid,
      selectedOids: s.selectedOids.includes(oid)
        ? s.selectedOids.filter((o) => o !== oid)
        : [...s.selectedOids, oid],
    })),

  rangeSelect: (oid) =>
    set((s) => {
      const anchorIdx = s.selectedOid ? s.commits.findIndex((c) => c.oid === s.selectedOid) : -1;
      const clickedIdx = s.commits.findIndex((c) => c.oid === oid);
      if (clickedIdx < 0) return s;
      if (anchorIdx < 0) return { selectedOid: oid, selectedOids: [oid] };
      const [lo, hi] = anchorIdx <= clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
      return { selectedOids: s.commits.slice(lo, hi + 1).map((c) => c.oid) };
    }),
}));
