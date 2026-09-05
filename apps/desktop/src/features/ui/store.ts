import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DiffViewMode = 'inline' | 'split';

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
  | null;

export interface CenterDiffTarget {
  path: string;
  staged?: boolean;
  oid?: string;
  oldPath?: string | null;
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

export type DialogContext =
  | string
  | InteractiveRebasePreset
  | CherryPickPreset
  | CreateWorktreePreset
  | null;

interface UiState {
  sidebarOpen: boolean;
  sidebarHiddenForDiff: boolean;
  terminalOpen: boolean;
  paletteOpen: boolean;
  dialog: DialogKind;
  dialogContext: DialogContext;
  diffView: DiffViewMode;
  wordDiff: boolean;
  fullFileDiff: boolean;
  wrapLines: boolean;
  selectedFile: { path: string; staged: boolean } | null;
  centerDiff: CenterDiffTarget | null;
  centerEditor: string | null;
  centerFileHistory: string | null;
  conflictFile: string | null;
  repoTabs: string[];
  worktreeTabs: string[];
  fileTree: boolean;
  sidebarSections: Record<string, boolean>;
  sidebarCollapseEpoch: number;
  commitBoxHeight: number | null;
  fileTreeFold: { epoch: number; mode: 'collapse' | 'expand' };

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (dialog: DialogKind, context?: DialogContext) => void;
  closeDialog: () => void;
  setDiffView: (mode: DiffViewMode) => void;
  setWordDiff: (on: boolean) => void;
  setFullFileDiff: (on: boolean) => void;
  setWrapLines: (on: boolean) => void;
  selectFile: (file: { path: string; staged: boolean } | null) => void;
  openCenterDiff: (target: CenterDiffTarget) => void;
  closeCenterDiff: () => void;
  openEditor: (file: string) => void;
  closeEditor: () => void;
  openFileHistory: (file: string) => void;
  closeFileHistory: () => void;
  openConflict: (file: string | null) => void;
  addRepoTab: (path: string) => void;
  closeRepoTab: (path: string) => void;
  moveRepoTab: (from: string, to: string) => void;
  markWorktreeTab: (path: string, isWorktree: boolean) => void;
  setSidebarSection: (id: string, open: boolean) => void;
  collapseSidebarSections: (ids: readonly string[]) => void;
  setCommitBoxHeight: (height: number | null) => void;
  foldFileTree: (mode: 'collapse' | 'expand') => void;
  setFileTree: (on: boolean) => void;
}

export const sidebarVisible = (s: UiState) => s.sidebarOpen && !s.sidebarHiddenForDiff;

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
  dialog: null,
  dialogContext: null,
  diffView: 'inline',
  wordDiff: true,
  fullFileDiff: false,
  wrapLines: false,
  selectedFile: null,
  centerDiff: null,
  centerEditor: null,
  centerFileHistory: null,
  conflictFile: null,
  repoTabs: [],
  worktreeTabs: [],
  fileTree: false,
  sidebarSections: {},
  sidebarCollapseEpoch: 0,
  commitBoxHeight: null,
  fileTreeFold: { epoch: 0, mode: 'expand' },

  toggleSidebar: () =>
    set((s) =>
      s.centerDiff
        ? { centerDiff: null, sidebarHiddenForDiff: false, sidebarOpen: true }
        : { sidebarOpen: !s.sidebarOpen },
    ),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog, context = null) => {
    captureDialogFocus();
    set({ dialog, dialogContext: context });
  },
  closeDialog: () => {
    set({ dialog: null, dialogContext: null });
    restoreDialogFocus();
  },
  setDiffView: (diffView) => set({ diffView }),
  setWordDiff: (wordDiff) => set({ wordDiff }),
  setFullFileDiff: (fullFileDiff) => set({ fullFileDiff }),
  setWrapLines: (wrapLines) => set({ wrapLines }),
  selectFile: (selectedFile) => set({ selectedFile }),
  openCenterDiff: (centerDiff) => set({ centerDiff, sidebarHiddenForDiff: true }),
  closeCenterDiff: () => set({ centerDiff: null, sidebarHiddenForDiff: false }),
  openEditor: (centerEditor) => set({ centerEditor }),
  closeEditor: () => set({ centerEditor: null }),
  openFileHistory: (centerFileHistory) =>
    set({ centerFileHistory, centerDiff: null, sidebarHiddenForDiff: false }),
  closeFileHistory: () => set({ centerFileHistory: null }),
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
  markWorktreeTab: (path, isWorktree) =>
    set((s) => {
      const has = s.worktreeTabs.includes(path);
      if (has === isWorktree) return s;
      return {
        worktreeTabs: isWorktree ? [...s.worktreeTabs, path] : s.worktreeTabs.filter((t) => t !== path),
      };
    }),
  setSidebarSection: (id, open) =>
    set((s) => (s.sidebarSections[id] === open ? s : { sidebarSections: { ...s.sidebarSections, [id]: open } })),
  collapseSidebarSections: (ids) =>
    set((s) => ({
      sidebarSections: { ...s.sidebarSections, ...Object.fromEntries(ids.map((id) => [id, false])) },
      sidebarCollapseEpoch: s.sidebarCollapseEpoch + 1,
    })),
  setCommitBoxHeight: (commitBoxHeight) => set({ commitBoxHeight }),
  foldFileTree: (mode) => set((s) => ({ fileTreeFold: { epoch: s.fileTreeFold.epoch + 1, mode } })),
  setFileTree: (fileTree) => set({ fileTree }),
    }),
    {
      name: 'angkorgit-ui',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        diffView: state.diffView,
        wordDiff: state.wordDiff,
        fullFileDiff: state.fullFileDiff,
        wrapLines: state.wrapLines,
        repoTabs: state.repoTabs,
        worktreeTabs: state.worktreeTabs,
        fileTree: state.fileTree,
        sidebarSections: state.sidebarSections,
        commitBoxHeight: state.commitBoxHeight,
      }),
    },
  ),
);
