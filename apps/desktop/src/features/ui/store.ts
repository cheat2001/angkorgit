import { create } from 'zustand';

export type DiffViewMode = 'inline' | 'split';

export type DialogKind =
  | 'clone'
  | 'createBranch'
  | 'createTag'
  | 'createStash'
  | 'settings'
  | 'rename'
  | null;

/** A diff opened full-width in the center area (GitKraken-style). */
export interface CenterDiffTarget {
  path: string;
  /** working-copy diffs: which side */
  staged?: boolean;
  /** commit diffs: the commit to diff against its parent */
  oid?: string;
}

interface UiState {
  terminalOpen: boolean;
  paletteOpen: boolean;
  dialog: DialogKind;
  /** context payload for dialogs (e.g. branch name being renamed) */
  dialogContext: string | null;
  diffView: DiffViewMode;
  wordDiff: boolean;
  /** file selected in the working-copy panel: [path, staged] */
  selectedFile: { path: string; staged: boolean } | null;
  /** diff shown full-width over the graph, null = graph visible */
  centerDiff: CenterDiffTarget | null;
  /** conflict resolver target */
  conflictFile: string | null;

  toggleTerminal: () => void;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (dialog: DialogKind, context?: string | null) => void;
  closeDialog: () => void;
  setDiffView: (mode: DiffViewMode) => void;
  setWordDiff: (on: boolean) => void;
  selectFile: (file: { path: string; staged: boolean } | null) => void;
  openCenterDiff: (target: CenterDiffTarget) => void;
  closeCenterDiff: () => void;
  openConflict: (file: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  terminalOpen: false,
  paletteOpen: false,
  dialog: null,
  dialogContext: null,
  diffView: 'inline',
  wordDiff: true,
  selectedFile: null,
  centerDiff: null,
  conflictFile: null,

  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog, context = null) => set({ dialog, dialogContext: context }),
  closeDialog: () => set({ dialog: null, dialogContext: null }),
  setDiffView: (diffView) => set({ diffView }),
  setWordDiff: (wordDiff) => set({ wordDiff }),
  selectFile: (selectedFile) => set({ selectedFile }),
  openCenterDiff: (centerDiff) => set({ centerDiff }),
  closeCenterDiff: () => set({ centerDiff: null }),
  openConflict: (conflictFile) => set({ conflictFile }),
}));
