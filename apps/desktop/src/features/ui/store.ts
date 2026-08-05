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
  | null;

export interface CenterDiffTarget {
  path: string;
  staged?: boolean;
  oid?: string;
}

interface UiState {
  sidebarOpen: boolean;
  terminalOpen: boolean;
  paletteOpen: boolean;
  dialog: DialogKind;
  dialogContext: string | null;
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
  fileTree: boolean;

  toggleSidebar: () => void;
  toggleTerminal: () => void;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (dialog: DialogKind, context?: string | null) => void;
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
  setFileTree: (on: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
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
  fileTree: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog, context = null) => set({ dialog, dialogContext: context }),
  closeDialog: () => set({ dialog: null, dialogContext: null }),
  setDiffView: (diffView) => set({ diffView }),
  setWordDiff: (wordDiff) => set({ wordDiff }),
  setFullFileDiff: (fullFileDiff) => set({ fullFileDiff }),
  setWrapLines: (wrapLines) => set({ wrapLines }),
  selectFile: (selectedFile) => set({ selectedFile }),
  openCenterDiff: (centerDiff) => set({ centerDiff }),
  closeCenterDiff: () => set({ centerDiff: null }),
  openEditor: (centerEditor) => set({ centerEditor }),
  closeEditor: () => set({ centerEditor: null }),
  openFileHistory: (centerFileHistory) => set({ centerFileHistory, centerDiff: null }),
  closeFileHistory: () => set({ centerFileHistory: null }),
  openConflict: (conflictFile) => set({ conflictFile }),
  addRepoTab: (path) =>
    set((s) => (s.repoTabs.includes(path) ? s : { repoTabs: [...s.repoTabs, path] })),
  closeRepoTab: (path) => set((s) => ({ repoTabs: s.repoTabs.filter((t) => t !== path) })),
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
        fileTree: state.fileTree,
      }),
    },
  ),
);
