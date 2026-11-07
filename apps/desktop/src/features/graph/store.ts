import { create } from 'zustand';
import type { CommitInfo, HistoryPage, HistoryPosition } from '@angkorgit/core';
import { GraphLayout, type GraphRow } from '@angkorgit/core';
import { ipc } from '@/core/ipc';

const PAGE_SIZE = 200;

interface GraphFilters {
  branch: string;
}

export interface FindQuery {
  text: string;
  author: string;
}

export interface FindState extends FindQuery {
  matches: HistoryPosition[];
  truncated: boolean;
  active: number;
  loading: boolean;
}

interface GraphState {
  commits: CommitInfo[];
  rows: readonly GraphRow[];
  maxLane: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  filters: GraphFilters;
  find: FindState | null;
  onlyMatches: boolean;
  matchesOnly: MatchQuery | null;
  locatedOid: string | null;
  selectedOid: string | null;
  selectedOids: string[];
  layout: GraphLayout;
  lastPath: string | null;
  pendingScrollIndex: number | null;

  reload: (path: string) => Promise<void>;
  loadMore: (path: string) => Promise<void>;
  setFilters: (path: string, filters: Partial<GraphFilters>) => void;
  setOnlyMatches: (path: string, on: boolean) => Promise<void>;
  setFind: (path: string, query: FindQuery, since?: number) => Promise<string | null>;
  goToMatch: (path: string, index: number) => Promise<string | null>;
  selectionEpoch: () => number;
  stepFind: (path: string, direction: 1 | -1) => Promise<string | null>;
  revealCommit: (path: string, oid: string) => Promise<boolean>;
  select: (oid: string | null) => void;
  toggleSelect: (oid: string) => void;
  rangeSelect: (oid: string) => void;
  clearPendingScroll: () => void;
}

let requestSeq = 0;
let findSeq = 0;
let selectSeq = 0;

const errorText = (error: unknown) =>
  (error as { message?: string } | undefined)?.message ?? String(error);

const emptyFilters = (): GraphFilters => ({ branch: '' });

interface MatchQuery {
  search?: string;
  author?: string;
}

const matchQueryOf = (onlyMatches: boolean, find: FindState | null): MatchQuery | null =>
  onlyMatches && find ? { search: find.text || undefined, author: find.author || undefined } : null;

const layoutInput = (commits: CommitInfo[], matchesOnly: MatchQuery | null): CommitInfo[] =>
  matchesOnly ? commits.map((commit) => ({ ...commit, parents: [] })) : commits;

const rowsOf = (layout: GraphLayout, commits: CommitInfo[], matchesOnly: MatchQuery | null): readonly GraphRow[] =>
  matchesOnly
    ? layout.getRows().map((row, i) => ({
        ...row,
        node: { ...row.node, color: 0, isMerge: (commits[i]?.parents.length ?? 0) > 1 },
      }))
    : [...layout.getRows()];

const sameQuery = (a: FindQuery | null, b: FindQuery) => a !== null && a.text === b.text && a.author === b.author;

const withActiveMatch = (find: FindState | null, oid: string | null): FindState | null => {
  if (!find || !oid) return find;
  const index = find.matches.findIndex((m) => m.oid === oid);
  return index === -1 || index === find.active ? find : { ...find, active: index };
};

export const useGraph = create<GraphState>((set, get) => {
  const appendPage = (page: HistoryPage, layout: GraphLayout) => {
    const { commits, matchesOnly } = get();
    layout.add(layoutInput(page.commits, matchesOnly));
    const all = [...commits, ...page.commits];
    set({
      commits: all,
      rows: rowsOf(layout, all, matchesOnly),
      maxLane: layout.maxLane,
      hasMore: page.hasMore,
      loading: false,
      error: null,
    });
  };

  const fetchMore = async (path: string, limit: number): Promise<boolean> => {
    const { commits, filters, layout, matchesOnly } = get();
    const seq = ++requestSeq;
    set({ loading: true });
    try {
      const page = await ipc.history(path, {
        skip: commits.length,
        limit,
        branch: filters.branch || undefined,
        ...matchesOnly,
      });
      if (seq !== requestSeq || get().lastPath !== path || get().layout !== layout) return false;
      appendPage(page, layout);
      return true;
    } catch (error) {
      if (seq === requestSeq) set({ loading: false, error: errorText(error) });
      return false;
    }
  };

  const ensureLoaded = async (path: string, index: number): Promise<boolean> => {
    const loaded = get().commits.length;
    if (!get().hasMore || loaded > index) return true;
    return fetchMore(path, index - loaded + PAGE_SIZE);
  };

  return {
    commits: [],
    rows: [],
    maxLane: 0,
    hasMore: true,
    loading: false,
    error: null,
    filters: emptyFilters(),
    find: null,
    onlyMatches: false,
    matchesOnly: null,
    locatedOid: null,
    selectedOid: null,
    selectedOids: [],
    layout: new GraphLayout(),
    lastPath: null,
    pendingScrollIndex: null,

    reload: async (path: string) => {
      const samePath = get().lastPath === path;
      if (!samePath) {
        findSeq += 1;
        set({
          commits: [],
          rows: [],
          maxLane: 0,
          hasMore: true,
          error: null,
          selectedOid: null,
          selectedOids: [],
          filters: emptyFilters(),
          find: null,
          onlyMatches: false,
          matchesOnly: null,
          locatedOid: null,
          layout: new GraphLayout(),
          lastPath: path,
          pendingScrollIndex: null,
        });
      }
      const { filters, onlyMatches, find } = get();
      const matchesOnly = matchQueryOf(onlyMatches, find);
      const sameList = samePath && !filters.branch && !matchesOnly && !get().matchesOnly;
      const loadedCount = sameList ? get().commits.length : 0;
      const seq = ++requestSeq;
      set({ loading: true });
      try {
        const page = await ipc.history(path, {
          skip: 0,
          limit: loadedCount > PAGE_SIZE ? Math.max(PAGE_SIZE, loadedCount) : PAGE_SIZE,
          branch: filters.branch || undefined,
          ...matchesOnly,
        });
        if (seq !== requestSeq || get().lastPath !== path) return;
        const layout = new GraphLayout();
        layout.add(layoutInput(page.commits, matchesOnly));
        set({
          matchesOnly,
          commits: page.commits,
          rows: rowsOf(layout, page.commits, matchesOnly),
          maxLane: layout.maxLane,
          hasMore: page.hasMore,
          layout,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (seq === requestSeq) set({ loading: false, error: errorText(error) });
      }
    },

    loadMore: async (path: string) => {
      const { hasMore, loading } = get();
      if (!hasMore || loading) return;
      await fetchMore(path, PAGE_SIZE);
    },

    setFilters: (path, partial) => {
      set((s) => ({ filters: { ...s.filters, ...partial } }));
      void get()
        .reload(path)
        .then(() => {
          const find = get().find;
          if (find && get().lastPath === path) void get().setFind(path, { text: find.text, author: find.author });
        });
    },

    setFind: async (path, query, since) => {
      const text = query.text.trim();
      const author = query.author.trim();
      findSeq += 1;
      if (!text && !author) {
        set({ find: null, locatedOid: null });
        if (get().matchesOnly) await get().reload(path);
        return null;
      }
      const seq = findSeq;
      const selectedAt = since ?? selectSeq;
      const { filters } = get();
      const wanted = { text, author };
      set((s) => ({
        find: {
          ...wanted,
          matches: sameQuery(s.find, wanted) && s.find ? s.find.matches : [],
          truncated: sameQuery(s.find, wanted) && s.find ? s.find.truncated : false,
          active: sameQuery(s.find, wanted) && s.find ? s.find.active : 0,
          loading: true,
        },
      }));
      try {
        const result = await ipc.historySearch(path, {
          search: text,
          author: author || undefined,
          branch: filters.branch || undefined,
        });
        if (seq !== findSeq || get().lastPath !== path) return null;
        const landed: FindState = { ...wanted, matches: result.matches, truncated: result.truncated, active: 0, loading: false };
        const relist = get().onlyMatches && !sameQuery(get().matchesOnly && { text: get().matchesOnly?.search ?? '', author: get().matchesOnly?.author ?? '' }, wanted);
        if (selectSeq !== selectedAt) {
          set({ find: withActiveMatch(landed, get().selectedOid) });
          if (relist) await get().reload(path);
          return null;
        }
        set({ find: landed });
        if (relist) {
          await get().reload(path);
          if (seq !== findSeq || get().lastPath !== path) return null;
        }
        if (result.matches.length === 0) return null;
        return get().goToMatch(path, 0);
      } catch {
        if (seq === findSeq) set((s) => (s.find ? { find: { ...s.find, loading: false } } : {}));
        return null;
      }
    },

    goToMatch: async (path, index) => {
      const find = get().find;
      const target = find?.matches[index];
      if (!find || !target) return null;
      set({ find: { ...find, active: index } });
      const listIndex = get().matchesOnly ? index : target.index;
      const ok = await ensureLoaded(path, listIndex);
      if (!ok || get().lastPath !== path) return null;
      const commits = get().commits;
      const at =
        commits[listIndex]?.oid === target.oid
          ? listIndex
          : commits.findIndex((c) => c.oid === target.oid);
      if (at === -1) return null;
      set({ selectedOid: target.oid, selectedOids: [target.oid], locatedOid: target.oid, pendingScrollIndex: at });
      return target.oid;
    },

    setOnlyMatches: async (path, on) => {
      if (get().onlyMatches === on) return;
      const selected = get().selectedOid;
      set({ onlyMatches: on });
      await get().reload(path);
      if (get().lastPath !== path || get().onlyMatches !== on) return;
      if (!selected) return;
      if (on) {
        const find = get().find;
        const index = find?.matches.findIndex((m) => m.oid === selected) ?? -1;
        if (index >= 0) await get().goToMatch(path, index);
        else if (find && find.matches.length > 0) await get().goToMatch(path, 0);
        return;
      }
      await get().revealCommit(path, selected);
    },

    revealCommit: async (path, oid) => {
      const target = await ipc.historyPosition(path, oid);
      if (!target || get().lastPath !== path) return false;
      const ok = await ensureLoaded(path, target.index);
      if (!ok || get().lastPath !== path) return false;
      const commits = get().commits;
      const at =
        commits[target.index]?.oid === target.oid
          ? target.index
          : commits.findIndex((c) => c.oid === target.oid);
      if (at === -1) return false;
      get().select(target.oid);
      set({ pendingScrollIndex: at, locatedOid: target.oid });
      return true;
    },

    stepFind: async (path, direction) => {
      const find = get().find;
      if (!find || find.matches.length === 0) return null;
      return get().goToMatch(path, (find.active + direction + find.matches.length) % find.matches.length);
    },

    select: (oid) => {
      selectSeq += 1;
      set((s) => ({
        selectedOid: oid,
        selectedOids: oid ? [oid] : [],
        locatedOid: null,
        find: withActiveMatch(s.find, oid),
      }));
    },

    clearPendingScroll: () => set({ pendingScrollIndex: null }),

    selectionEpoch: () => selectSeq,

    toggleSelect: (oid) => {
      selectSeq += 1;
      set((s) => ({
        selectedOid: oid,
        locatedOid: null,
        find: withActiveMatch(s.find, oid),
        selectedOids: s.selectedOids.includes(oid)
          ? s.selectedOids.filter((o) => o !== oid)
          : [...s.selectedOids, oid],
      }));
    },

    rangeSelect: (oid) => {
      selectSeq += 1;
      set((s) => {
        const anchorIdx = s.selectedOid ? s.commits.findIndex((c) => c.oid === s.selectedOid) : -1;
        const clickedIdx = s.commits.findIndex((c) => c.oid === oid);
        if (clickedIdx < 0) return s;
        if (anchorIdx < 0) return { selectedOid: oid, selectedOids: [oid] };
        const [lo, hi] = anchorIdx <= clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        return { selectedOids: s.commits.slice(lo, hi + 1).map((c) => c.oid) };
      });
    },
  };
});
