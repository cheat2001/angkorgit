import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DiffViewMode = 'inline' | 'split';
export type DiffLayout = 'file' | 'all';

export type FileView = 'list' | 'tree' | 'all';

export interface GraphColumns {
  refs: boolean;
  author: boolean;
  message: boolean;
  hash: boolean;
  date: boolean;
}

export const DEFAULT_GRAPH_COLUMNS: GraphColumns = {
  refs: true,
  author: true,
  message: true,
  hash: true,
  date: true,
};

export type DialogKind =
  | 'clone'
  | 'createBranch'
  | 'createTag'
  | 'createStash'
  | 'settings'
  | 'rename'
  | 'interactiveRebase'
  | 'createPullRequest'
  | 'cherryPick'
  | 'createWorktree'
  | 'repoShortcut'
  | 'repoGroup'
  | 'scanRepositories'
  | null;

export interface CenterDiffTarget {
  path: string;
  staged?: boolean;
  oid?: string;
  oldPath?: string | null;
  unchanged?: boolean;
}

export interface InteractiveRebasePreset {
  baseOid: string;
  squashOids?: string[];
  dropOids?: string[];
}

export interface CherryPickPreset {
  oids: string[];
}

export interface CreateWorktreePreset {
  branch?: string;
  oid?: string;
}

export interface StashPreset {
  paths: string[];
}

export interface FileHistoryPreset {
  pane: 'blame';
  rev: string | null;
}

export interface ClonePreset {
  url: string;
  into: string;
  branch?: string;
}

export interface ScanRepositoriesPreset {
  scanRoot: string;
}

export interface RepoShortcutPreset {
  repoPath: string;
}

export interface RepoGroupPreset {
  groupId: string | null;
  repoPath: string | null;
}

export interface SettingsPreset {
  section: 'appearance' | 'git' | 'accounts' | 'ai' | 'shortcuts';
}

export type DialogContext =
  | string
  | SettingsPreset
  | InteractiveRebasePreset
  | CherryPickPreset
  | CreateWorktreePreset
  | StashPreset
  | ClonePreset
  | RepoShortcutPreset
  | RepoGroupPreset
  | ScanRepositoriesPreset
  | null;

interface UiState {
  sidebarOpen: boolean;
  sidebarHiddenForDiff: boolean;
  terminalOpen: boolean;
  paletteOpen: boolean;
  repoSwitcherOpen: boolean;
  dialog: DialogKind;
  dialogContext: DialogContext;
  diffView: DiffViewMode;
  diffLayout: DiffLayout;
  wordDiff: boolean;
  ignoreWhitespace: boolean;
  fullFileDiff: boolean;
  wrapLines: boolean;
  selectedFile: { path: string; staged: boolean } | null;
  centerDiff: CenterDiffTarget | null;
  centerEditor: string | null;
  centerFileHistory: string | null;
  fileHistoryPreset: FileHistoryPreset | null;
  conflictFile: string | null;
  repoTabs: string[];
  worktreeTabs: string[];
  worktreeMains: Record<string, string>;
  repoGroupsCollapsed: Record<string, boolean>;
  tabGroupsCollapsed: Record<string, boolean>;
  fileView: FileView;
  fileFilterOpen: boolean;
  fileFilterFocusSeq: number;
  inspectorFocusSeq: number;
  graphFocusSeq: number;
  editMessageRequest: { seq: number; oid: string } | null;
  sidebarSections: Record<string, boolean>;
  sidebarCollapseEpoch: number;
  commitBoxHeight: number | null;
  graphColumns: GraphColumns;
  graphTail: boolean;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setPaletteOpen: (open: boolean) => void;
  setRepoSwitcherOpen: (open: boolean) => void;
  openDialog: (dialog: DialogKind, context?: DialogContext) => void;
  closeDialog: () => void;
  setDiffView: (mode: DiffViewMode) => void;
  setDiffLayout: (layout: DiffLayout) => void;
  setWordDiff: (on: boolean) => void;
  setIgnoreWhitespace: (on: boolean) => void;
  setFullFileDiff: (on: boolean) => void;
  setWrapLines: (on: boolean) => void;
  selectFile: (file: { path: string; staged: boolean } | null) => void;
  openCenterDiff: (target: CenterDiffTarget) => void;
  closeCenterDiff: () => void;
  openEditor: (file: string) => void;
  closeEditor: () => void;
  openFileHistory: (file: string) => void;
  closeFileHistory: () => void;
  openBlame: (file: string, rev?: string | null) => void;
  clearFileHistoryPreset: () => void;
  openConflict: (file: string | null) => void;
  addRepoTab: (path: string) => void;
  closeRepoTab: (path: string) => void;
  moveRepoTab: (from: string, to: string) => void;
  markWorktreeTab: (path: string, isWorktree: boolean, mainPath?: string | null) => void;
  toggleRepoGroupCollapsed: (id: string) => void;
  toggleTabGroupCollapsed: (id: string) => void;
  setTabGroupsCollapsed: (patch: Record<string, boolean>) => void;
  setSidebarSection: (id: string, open: boolean) => void;
  collapseSidebarSections: (ids: readonly string[]) => void;
  setCommitBoxHeight: (height: number | null) => void;
  setGraphColumn: (column: keyof GraphColumns, on: boolean) => void;
  setGraphTail: (on: boolean) => void;
  setFileView: (view: FileView) => void;
  setFileFilterOpen: (on: boolean) => void;
  focusInspector: () => void;
  requestEditMessage: (oid: string) => void;
  focusGraph: () => void;
}

export const sidebarVisible = (s: UiState) => s.sidebarOpen && !s.sidebarHiddenForDiff;

export const focusRequests = { inspectorConsumed: 0, editMessageConsumed: 0 };

let dialogReturnFocus: HTMLElement | null = null;

const captureDialogFocus = () => {
  const active = document.activeElement;
  dialogReturnFocus = active instanceof HTMLElement ? active : null;
};

const restoreDialogFocus = () => {
  const target = dialogReturnFocus;
  dialogReturnFocus = null;
  if (target && document.contains(target)) {
    requestAnimationFrame(() => target.focus());
  }
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
  sidebarHiddenForDiff: false,
  terminalOpen: false,
  paletteOpen: false,
  repoSwitcherOpen: false,
  dialog: null,
  dialogContext: null,
  diffView: 'inline',
  diffLayout: 'file',
  wordDiff: true,
  ignoreWhitespace: false,
  fullFileDiff: false,
  wrapLines: false,
  selectedFile: null,
  centerDiff: null,
  centerEditor: null,
  centerFileHistory: null,
  fileHistoryPreset: null,
  conflictFile: null,
  repoTabs: [],
  worktreeTabs: [],
  worktreeMains: {},
  repoGroupsCollapsed: {},
  tabGroupsCollapsed: {},
  fileView: 'list',
  fileFilterOpen: false,
  fileFilterFocusSeq: 0,
  inspectorFocusSeq: 0,
  graphFocusSeq: 0,
  editMessageRequest: null,
  sidebarSections: {},
  sidebarCollapseEpoch: 0,
  commitBoxHeight: null,
  graphColumns: DEFAULT_GRAPH_COLUMNS,
  graphTail: true,

  toggleSidebar: () =>
    set((s) =>
      s.centerDiff
        ? { centerDiff: null, sidebarHiddenForDiff: false, sidebarOpen: true }
        : { sidebarOpen: !s.sidebarOpen },
    ),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setPaletteOpen: (paletteOpen) =>
    set((s) => ({ paletteOpen, repoSwitcherOpen: paletteOpen ? false : s.repoSwitcherOpen })),
  setRepoSwitcherOpen: (repoSwitcherOpen) =>
    set((s) => ({ repoSwitcherOpen, paletteOpen: repoSwitcherOpen ? false : s.paletteOpen })),
  openDialog: (dialog, context = null) => {
    captureDialogFocus();
    set({ dialog, dialogContext: context });
  },
  closeDialog: () => {
    set({ dialog: null, dialogContext: null });
    restoreDialogFocus();
  },
  setDiffView: (diffView) => set({ diffView }),
  setDiffLayout: (diffLayout) => set({ diffLayout }),
  setWordDiff: (wordDiff) => set({ wordDiff }),
  setIgnoreWhitespace: (ignoreWhitespace) => set({ ignoreWhitespace }),
  setFullFileDiff: (fullFileDiff) => set({ fullFileDiff }),
  setWrapLines: (wrapLines) => set({ wrapLines }),
  selectFile: (selectedFile) => set({ selectedFile }),
  openCenterDiff: (centerDiff) => set({ centerDiff, sidebarHiddenForDiff: true }),
  closeCenterDiff: () => set({ centerDiff: null, sidebarHiddenForDiff: false }),
  openEditor: (centerEditor) => set({ centerEditor }),
  closeEditor: () => set({ centerEditor: null }),
  openFileHistory: (centerFileHistory) =>
    set({ centerFileHistory, fileHistoryPreset: null, centerDiff: null, sidebarHiddenForDiff: false }),
  closeFileHistory: () => set({ centerFileHistory: null, fileHistoryPreset: null }),
  openBlame: (file, rev = null) =>
    set({
      centerFileHistory: file,
      fileHistoryPreset: { pane: 'blame', rev },
      centerDiff: null,
      sidebarHiddenForDiff: false,
    }),
  clearFileHistoryPreset: () => set({ fileHistoryPreset: null }),
  openConflict: (conflictFile) => set({ conflictFile }),
  addRepoTab: (path) =>
    set((s) => (s.repoTabs.includes(path) ? s : { repoTabs: [...s.repoTabs, path] })),
  closeRepoTab: (path) =>
    set((s) => ({
      repoTabs: s.repoTabs.filter((t) => t !== path),
      worktreeTabs: s.worktreeTabs.filter((t) => t !== path),
    })),
  moveRepoTab: (from, to) =>
    set((s) => {
      const fromIdx = s.repoTabs.indexOf(from);
      const toIdx = s.repoTabs.indexOf(to);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return s;
      const repoTabs = [...s.repoTabs];
      repoTabs.splice(fromIdx, 1);
      repoTabs.splice(toIdx, 0, from);
      return { repoTabs };
    }),
  markWorktreeTab: (path, isWorktree, mainPath = null) =>
    set((s) => {
      const has = s.worktreeTabs.includes(path);
      const main = isWorktree && mainPath && mainPath !== path ? mainPath : null;
      if (has === isWorktree && (s.worktreeMains[path] ?? null) === main) return s;
      const worktreeMains = { ...s.worktreeMains };
      if (main) worktreeMains[path] = main;
      else delete worktreeMains[path];
      return {
        worktreeTabs: isWorktree
          ? has
            ? s.worktreeTabs
            : [...s.worktreeTabs, path]
          : s.worktreeTabs.filter((t) => t !== path),
        worktreeMains,
      };
    }),
  toggleRepoGroupCollapsed: (id) =>
    set((s) => ({ repoGroupsCollapsed: { ...s.repoGroupsCollapsed, [id]: !s.repoGroupsCollapsed[id] } })),
  toggleTabGroupCollapsed: (id) =>
    set((s) => ({ tabGroupsCollapsed: { ...s.tabGroupsCollapsed, [id]: !s.tabGroupsCollapsed[id] } })),
  setTabGroupsCollapsed: (patch) => set((s) => ({ tabGroupsCollapsed: { ...s.tabGroupsCollapsed, ...patch } })),
  setSidebarSection: (id, open) =>
    set((s) => (s.sidebarSections[id] === open ? s : { sidebarSections: { ...s.sidebarSections, [id]: open } })),
  collapseSidebarSections: (ids) =>
    set((s) => ({
      sidebarSections: { ...s.sidebarSections, ...Object.fromEntries(ids.map((id) => [id, false])) },
      sidebarCollapseEpoch: s.sidebarCollapseEpoch + 1,
    })),
  setCommitBoxHeight: (commitBoxHeight) => set({ commitBoxHeight }),
  setGraphColumn: (column, on) =>
    set((s) => ({ graphColumns: { ...s.graphColumns, [column]: on } })),
  setGraphTail: (graphTail) => set({ graphTail }),
  setFileView: (fileView) => set({ fileView }),
  focusInspector: () => set((s) => ({ inspectorFocusSeq: s.inspectorFocusSeq + 1 })),
  focusGraph: () => set((s) => ({ graphFocusSeq: s.graphFocusSeq + 1 })),
  requestEditMessage: (oid) =>
    set((s) => ({ editMessageRequest: { seq: (s.editMessageRequest?.seq ?? 0) + 1, oid } })),
  setFileFilterOpen: (fileFilterOpen) =>
    set((s) => ({ fileFilterOpen, fileFilterFocusSeq: fileFilterOpen ? s.fileFilterFocusSeq + 1 : s.fileFilterFocusSeq })),
    }),
    {
      name: 'angkorgit-ui',
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState> & { fileTree?: boolean };
        const { fileTree: legacyFileTree, ...rest } = saved;
        return {
          ...current,
          ...rest,
          fileView: saved.fileView ?? (legacyFileTree ? 'tree' : current.fileView),
          graphColumns: { ...DEFAULT_GRAPH_COLUMNS, ...(saved.graphColumns ?? {}) },
        };
      },
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        diffView: state.diffView,
        diffLayout: state.diffLayout,
        wordDiff: state.wordDiff,
        ignoreWhitespace: state.ignoreWhitespace,
        fullFileDiff: state.fullFileDiff,
        wrapLines: state.wrapLines,
        repoTabs: state.repoTabs,
        worktreeTabs: state.worktreeTabs,
        worktreeMains: state.worktreeMains,
        repoGroupsCollapsed: state.repoGroupsCollapsed,
        tabGroupsCollapsed: state.tabGroupsCollapsed,
        fileView: state.fileView,
        sidebarSections: state.sidebarSections,
        commitBoxHeight: state.commitBoxHeight,
        graphColumns: state.graphColumns,
        graphTail: state.graphTail,
      }),
    },
  ),
);
