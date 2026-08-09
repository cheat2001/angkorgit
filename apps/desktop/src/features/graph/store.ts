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
  layout: GraphLayout;
  lastPath: string | null;

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
  lastPath: null,

  reload: async (path: string) => {
    if (get().lastPath !== path) {
      set({
        commits: [],
        rows: [],
        maxLane: 0,
        hasMore: true,
        selectedOid: null,
        filters: { search: '', author: '', branch: '' },
        layout: new GraphLayout(),
        lastPath: path,
      });
    }
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
      set({ loading: false });
    }
  },

  setFilters: (path, partial) => {
    set((s) => ({ filters: { ...s.filters, ...partial } }));
    void get().reload(path);
  },

  select: (oid) => set({ selectedOid: oid }),
}));
