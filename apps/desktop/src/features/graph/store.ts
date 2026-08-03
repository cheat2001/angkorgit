import { create } from 'zustand';
import type { CommitInfo } from '@angkorgit/core';
import { GraphLayout, type GraphRow } from '@angkorgit/core';
import { ipc } from '@/core/ipc';

const PAGE_SIZE = 200;

interface GraphFilters {
  search: string;
  author: string;
  branch: string;
}

interface GraphState {
  commits: CommitInfo[];
  rows: readonly GraphRow[];
  maxLane: number;
  hasMore: boolean;
  loading: boolean;
  filters: GraphFilters;
  selectedOid: string | null;
  /** internal layout engine, rebuilt when filters change */
  layout: GraphLayout;

  reload: (path: string) => Promise<void>;
  loadMore: (path: string) => Promise<void>;
  setFilters: (path: string, filters: Partial<GraphFilters>) => void;
  select: (oid: string | null) => void;
}

export const useGraph = create<GraphState>((set, get) => ({
  commits: [],
  rows: [],
  maxLane: 0,
  hasMore: true,
  loading: false,
  filters: { search: '', author: '', branch: '' },
  selectedOid: null,
  layout: new GraphLayout(),

  reload: async (path: string) => {
    const { filters } = get();
    set({ loading: true });
    try {
      const page = await ipc.history(path, {
        skip: 0,
        limit: PAGE_SIZE,
        search: filters.search || undefined,
        author: filters.author || undefined,
        branch: filters.branch || undefined,
      });
      const layout = new GraphLayout();
      layout.add(page.commits);
      set({
        commits: page.commits,
        rows: layout.getRows(),
        maxLane: layout.maxLane,
        hasMore: page.hasMore,
        layout,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  loadMore: async (path: string) => {
    const { commits, hasMore, loading, filters, layout } = get();
    if (!hasMore || loading) return;
    set({ loading: true });
    try {
      const page = await ipc.history(path, {
        skip: commits.length,
        limit: PAGE_SIZE,
        search: filters.search || undefined,
        author: filters.author || undefined,
        branch: filters.branch || undefined,
      });
      layout.add(page.commits);
      // getRows() returns the same (mutated) array — copy so zustand re-renders.
      set({
        commits: [...commits, ...page.commits],
        rows: [...layout.getRows()],
        maxLane: layout.maxLane,
        hasMore: page.hasMore,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  setFilters: (path, partial) => {
    set((s) => ({ filters: { ...s.filters, ...partial } }));
    void get().reload(path);
  },

  select: (oid) => set({ selectedOid: oid }),
}));
