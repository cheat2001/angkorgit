import { create } from 'zustand';
import { toast } from 'sonner';
import { ipc } from '@/core/ipc';

/**
 * GitKraken-style undo/redo for git operations.
 *
 * Every tracked operation stores a before/after snapshot of HEAD (plus op
 * details). Undo applies the inverse; redo re-applies the original. Both
 * validate that the repository still looks like the recorded "after"/"before"
 * state — if history moved in the meantime the entry is discarded instead of
 * corrupting the repo. Hard-reset style undos additionally refuse to run over
 * uncommitted changes.
 */

export type UndoKind =
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'cherryPick'
  | 'rebase'
  | 'reset'
  | 'revert'
  | 'branchCreate'
  | 'branchDelete'
  | 'branchRename';

interface Snapshot {
  headRef: string | null;
  headOid: string | null;
  detached: boolean;
}

export interface UndoEntry {
  repoPath: string;
  kind: UndoKind;
  label: string;
  before: Snapshot;
  after: Snapshot;
  /** op-specific payload (branch names, oids) */
  extra: Record<string, string>;
}

/** Ops whose undo/redo moves HEAD with a hard reset (need a clean tree). */
const HARD_KINDS: ReadonlySet<UndoKind> = new Set(['merge', 'cherryPick', 'rebase', 'reset', 'revert']);
/** Ops that move HEAD (validated against HEAD position). */
const HEAD_KINDS: ReadonlySet<UndoKind> = new Set([
  'commit',
  'checkout',
  'merge',
  'cherryPick',
  'rebase',
  'reset',
  'revert',
]);

async function snapshot(path: string): Promise<Snapshot> {
  const info = await ipc.repoInfo(path);
  return { headRef: info.headBranch ?? null, headOid: info.headOid ?? null, detached: info.isDetached };
}

async function headMatches(path: string, expected: Snapshot): Promise<boolean> {
  const current = await snapshot(path);
  return current.headOid === expected.headOid && current.headRef === expected.headRef;
}

async function treeIsClean(path: string): Promise<boolean> {
  const status = await ipc.status(path);
  return status.files.length === 0;
}

/** Move the repo from one snapshot to another (the core of undo/redo). */
async function applyTransition(
  entry: UndoEntry,
  from: Snapshot,
  to: Snapshot,
  direction: 'undo' | 'redo',
): Promise<void> {
  const path = entry.repoPath;
  switch (entry.kind) {
    case 'commit': {
      // soft reset keeps the committed changes staged
      if (!to.headOid) throw new Error('nothing to reset to');
      await ipc.reset(path, to.headOid, 'soft');
      return;
    }
    case 'merge':
    case 'cherryPick':
    case 'rebase':
    case 'reset':
    case 'revert': {
      if (!to.headOid) throw new Error('nothing to reset to');
      if (!(await treeIsClean(path))) {
        throw new Error('working tree has uncommitted changes — commit or stash them first');
      }
      await ipc.reset(path, to.headOid, 'hard');
      return;
    }
    case 'checkout': {
      if (to.headRef && !to.detached) await ipc.checkout(path, to.headRef);
      else if (to.headOid) await ipc.checkoutDetached(path, to.headOid);
      return;
    }
    case 'branchCreate': {
      const branch = entry.extra.branch;
      if (direction === 'undo') await ipc.deleteBranch(path, branch, false);
      else await ipc.createBranch(path, branch, entry.extra.oid || null, false);
      return;
    }
    case 'branchDelete': {
      const branch = entry.extra.branch;
      if (direction === 'undo') await ipc.createBranch(path, branch, entry.extra.oid || null, false);
      else await ipc.deleteBranch(path, branch, false);
      return;
    }
    case 'branchRename': {
      if (direction === 'undo') await ipc.renameBranch(path, entry.extra.to, entry.extra.from);
      else await ipc.renameBranch(path, entry.extra.from, entry.extra.to);
      return;
    }
  }
  void from;
}

interface UndoState {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  /** Run a mutating op and record it for undo (when shouldRecord passes). */
  tracked: <T>(options: {
    path: string;
    kind: UndoKind;
    label: string;
    extra?: Record<string, string>;
    action: () => Promise<T>;
    shouldRecord?: (result: T) => boolean;
  }) => Promise<T>;

  undo: (path: string) => Promise<boolean>;
  redo: (path: string) => Promise<boolean>;
  peekUndo: (path: string) => UndoEntry | undefined;
  peekRedo: (path: string) => UndoEntry | undefined;
  clear: (path: string) => void;
}

const MAX_ENTRIES = 50;

export const useUndo = create<UndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],

  tracked: async ({ path, kind, label, extra = {}, action, shouldRecord }) => {
    const before = await snapshot(path);
    const result = await action();
    if (shouldRecord && !shouldRecord(result)) return result;
    const after = await snapshot(path);
    set((s) => ({
      undoStack: [
        ...s.undoStack.slice(-(MAX_ENTRIES - 1)),
        { repoPath: path, kind, label, before, after, extra },
      ],
      // a new operation invalidates the redo timeline for this repo
      redoStack: s.redoStack.filter((e) => e.repoPath !== path),
    }));
    return result;
  },

  undo: async (path) => {
    const entry = get().peekUndo(path);
    if (!entry) return false;
    const pop = () =>
      set((s) => ({ undoStack: s.undoStack.filter((e) => e !== entry) }));

    try {
      if (HEAD_KINDS.has(entry.kind) && !(await headMatches(path, entry.after))) {
        pop();
        toast.warning(`Can't undo "${entry.label}" — the repository has changed since`);
        return false;
      }
      await applyTransition(entry, entry.after, entry.before, 'undo');
      pop();
      set((s) => ({ redoStack: [...s.redoStack, entry] }));
      toast.success(`Undid: ${entry.label}`);
      return true;
    } catch (error) {
      toast.error(`Undo failed: ${(error as { message?: string }).message ?? error}`);
      return false;
    }
  },

  redo: async (path) => {
    const entry = get().peekRedo(path);
    if (!entry) return false;
    const pop = () =>
      set((s) => ({ redoStack: s.redoStack.filter((e) => e !== entry) }));

    try {
      if (HEAD_KINDS.has(entry.kind) && !(await headMatches(path, entry.before))) {
        pop();
        toast.warning(`Can't redo "${entry.label}" — the repository has changed since`);
        return false;
      }
      await applyTransition(entry, entry.before, entry.after, 'redo');
      pop();
      set((s) => ({ undoStack: [...s.undoStack, entry] }));
      toast.success(`Redid: ${entry.label}`);
      return true;
    } catch (error) {
      toast.error(`Redo failed: ${(error as { message?: string }).message ?? error}`);
      return false;
    }
  },

  peekUndo: (path) => [...get().undoStack].reverse().find((e) => e.repoPath === path),
  peekRedo: (path) => [...get().redoStack].reverse().find((e) => e.repoPath === path),

  clear: (path) =>
    set((s) => ({
      undoStack: s.undoStack.filter((e) => e.repoPath !== path),
      redoStack: s.redoStack.filter((e) => e.repoPath !== path),
    })),
}));

/** True when a hard-style undo would need a clean tree (for tooltips). */
export function isHardKind(kind: UndoKind): boolean {
  return HARD_KINDS.has(kind);
}
